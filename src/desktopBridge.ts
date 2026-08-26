import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import WebSocket from 'ws';
import {
  cleanDesktopEnvironment, desktopBuildFingerprint, readSharedInstall,
  DESKTOP_CODEX, SHARED_RUNTIME_STATE, type DesktopSharedInstall,
} from './sharedRuntime.js';

/** Only intercept Desktop's local server, never CLI tools, code-mode hosts or subcommands. */
export function sharedServerArguments(args: string[], endpoint: string): string[] | null {
  const command = args.indexOf('app-server');
  if (command < 0 || args.some((arg) => ['--help', '-h', '--version', '-V'].includes(arg))) return null;
  // Recognize only the launch contract inspected and tested with this Desktop build.
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'app-server' || arg === '--analytics-default-enabled') continue;
    if (arg === '-c' || arg === '--config' || arg === '--enable' || arg === '--disable') {
      if (!args[++i]) return null;
      continue;
    }
    // A future Desktop may select its own transport or add flags. Leave it alone.
    return null;
  }
  if (!args.some((arg) => arg.startsWith('mcp_servers.codex_app='))) return null;
  return [...args, '--listen', endpoint];
}

export interface DesktopBridgeOptions {
  args: string[];
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
  env?: NodeJS.ProcessEnv;
  install?: DesktopSharedInstall | null;
  binary?: string;
  fingerprint?: () => Promise<string>;
  record?: (value: Record<string, unknown>) => void;
  startupTimeoutMs?: number;
  launch?: (binary: string, args: string[], env: NodeJS.ProcessEnv, shared: boolean) => ChildProcess;
  signal?: AbortSignal;
}

/**
 * Transport-only adapter. Desktop supplies ALL args/config/env and retains its
 * own RPC identity. Never retries/replays a request after sending it upstream.
 */
export async function runDesktopBridge(options: DesktopBridgeOptions): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostics = options.diagnostics ?? process.stderr;
  const env = cleanDesktopEnvironment(options.env ?? process.env);
  const install = options.install === undefined ? readSharedInstall() : options.install;
  const binary = options.binary ?? DESKTOP_CODEX;
  const launch = options.launch ?? ((command, args, environment, shared) => spawn(command, args, {
    env: environment, stdio: [shared ? 'ignore' : 'pipe', shared ? 'ignore' : 'pipe', 'pipe'],
  }));
  const record = options.record ?? ((value) => {
    try {
      writeFileSync(SHARED_RUNTIME_STATE, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      chmodSync(SHARED_RUNTIME_STATE, 0o600);
    } catch { /* Diagnostics must never prevent private fallback. */ }
  });
  const sharedArgs = install ? sharedServerArguments(options.args, install.url) : null;
  let child: ChildProcess | null = null;
  let socket: WebSocket | null = null;
  let forwarded = false;
  let shutdownRequested = options.signal?.aborted ?? false;
  let fingerprint = '';
  // Per-launch credentials prevent a second Desktop backend/port collision
  // from accidentally attaching to an older instance of this installation.
  const token = randomBytes(32).toString('hex');
  input.pause();

  async function stopChild(): Promise<void> {
    socket?.terminate();
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const stopped = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child?.kill('SIGKILL'), 1500);
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([stopped, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Owned server did not exit; refusing to start another backend')), 3500);
      })]);
    } finally { clearTimeout(timer); clearTimeout(deadline); }
  }

  function mark(mode: 'shared' | 'private' | 'blocked', reason?: string): void {
    record({ mode, bridgePid: process.pid, serverPid: child?.pid,
      url: install?.url ?? '', fingerprint, ...(mode === 'shared' ? { token } : {}), ...(reason ? { reason } : {}) });
  }

  async function privateServer(reason: string): Promise<number> {
    if (shutdownRequested) return 0;
    const desktopLaunch = options.args.some((arg) => arg.startsWith('mcp_servers.codex_app='));
    if (desktopLaunch) diagnostics.write(`[micro] Shared control disabled: ${reason}. Using Desktop's private server.\n`);
    child = launch(binary, options.args, env, false);
    // Tool CLI invocations must not overwrite the main Desktop runtime marker.
    if (desktopLaunch) mark('private', reason);
    child.stdout!.pipe(output, { end: false });
    child.stderr!.pipe(diagnostics, { end: false });
    input.pipe(child.stdin!);
    child.stdin!.on('error', () => {});
    return waitForExit(child);
  }

  const terminate = () => { shutdownRequested = true; void stopChild().catch(() => {}); };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  options.signal?.addEventListener('abort', terminate, { once: true });
  try {
    if (shutdownRequested) return 0;
    if (!install || !sharedArgs) return await privateServer('not installed or unrecognized launch arguments');
    fingerprint = await (options.fingerprint ?? desktopBuildFingerprint)();
    if (shutdownRequested) return 0;
    if (fingerprint !== install.fingerprint) return await privateServer('Desktop build changed; compatibility verification required');
    // A known bad launch stays private until an explicit reinstall clears it.
    if (!options.record) {
      try {
        const prior = JSON.parse(readFileSync(SHARED_RUNTIME_STATE, 'utf8'));
        if (prior.fingerprint === fingerprint && prior.mode !== 'shared') {
          return await privateServer('previous shared startup failed; run shared install to retry');
        }
      } catch { /* First launch. */ }
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    child = launch(binary, [...sharedArgs, '--ws-auth', 'capability-token', '--ws-token-sha256', tokenHash], env, true);
    // Keep diagnostics on stderr; stdout is exclusively Desktop's RPC stream.
    child.stderr!.pipe(diagnostics, { end: false });
    let startupError: Error | null = null;
    child.on('error', (error) => { startupError = error; });
    const deadline = Date.now() + (options.startupTimeoutMs ?? 8000);
    while (!socket) {
      if (shutdownRequested) throw new Error('Desktop closed during shared startup');
      if (startupError || child.exitCode !== null || child.signalCode !== null) throw startupError ?? new Error('shared server exited during startup');
      if (Date.now() >= deadline) throw new Error('shared startup timed out');
      try { socket = await connectSocket(install.url, token); }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    // Authentication ensures we cannot connect Desktop to an unrelated listener.
    // Do not mark connected until Desktop's own initialize response succeeds.
    let initializeId: unknown;
    let initialized = false;
    let finishing = false;
    const lines = createInterface({ input, crlfDelay: Infinity });
    let protocolFailure: Error | null = null;
    const done = new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { if (!finishing) { protocolFailure = error; reject(error); } };
      socket!.on('message', (data) => {
        const text = data.toString();
        try {
          const message = JSON.parse(text);
          if (message.error && /invalid transport|failed to load configuration/i.test(String(message.error.message))) {
            mark('blocked', 'Backend configuration failed. Quit and reopen Codex normally for private mode; verify shared setup before retrying.');
          }
          if (initializeId !== undefined && message.id === initializeId && !message.error && message.result) {
            initialized = true;
            mark('shared');
          }
          if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('RPC frame limit exceeded');
          if (!output.write(`${text}\n`)) socket!.pause();
        } catch { fail(new Error('invalid shared-server RPC frame')); }
      });
      output.on('drain', () => socket?.resume());
      socket!.on('error', (error) => fail(error));
      socket!.on('close', () => fail(new Error('shared server disconnected')));
      child!.once('exit', () => fail(new Error('shared server exited')));
      lines.on('line', (line) => {
        if (!line.trim()) return;
        if (Buffer.byteLength(line) > 32 * 1024 * 1024) { fail(new Error('RPC line limit exceeded')); return; }
        try {
          const message = JSON.parse(line);
          if (message.method === 'initialize') initializeId = message.id;
          forwarded = true;
          socket!.send(line, (error) => { if (error) fail(error); });
          if (socket!.bufferedAmount > 8 * 1024 * 1024) input.pause();
        } catch { fail(new Error('invalid Desktop RPC request')); }
      });
      lines.once('close', resolve);
      input.once('error', fail);
      output.once('error', fail);
    });
    const flow = setInterval(() => {
      if (socket && socket.bufferedAmount < 1024 * 1024) input.resume();
    }, 20);
    const handshake = setTimeout(() => {
      if (!initialized) socket?.terminate();
    }, options.startupTimeoutMs ?? 8000);
    try { input.resume(); await done; }
    finally { finishing = true; clearInterval(flow); clearTimeout(handshake); lines.close(); await stopChild(); }
    if (protocolFailure) throw protocolFailure;
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await stopChild();
    if (shutdownRequested) return 0;
    mark(forwarded ? 'blocked' : 'private', reason);
    if (forwarded) {
      // Replaying a turn could execute it twice. Stop; next launch is native.
      diagnostics.write(`[micro] ${reason}; no requests were replayed. Relaunch Desktop for private mode.\n`);
      return 1;
    }
    return await privateServer(reason);
  } finally {
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', terminate);
    options.signal?.removeEventListener('abort', terminate);
    input.unpipe();
    input.pause();
  }
}

function connectSocket(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 750, maxPayload: 32 * 1024 * 1024 });
    // Cover the handoff between open resolving and the relay attaching handlers.
    socket.on('error', () => {});
    socket.once('open', () => { socket.removeListener('error', reject); resolve(socket); });
    socket.once('error', reject);
  });
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
