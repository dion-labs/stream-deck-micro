import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { RpcConnection } from './harness/codex-app-server/rpc.js';

const RPC_MS = 5000;
const START_MS = 10_000;
const ALLOWED_METHODS = new Set(['initialize', 'thread/start', 'thread/resume', 'mcpServerStatus/list']);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

interface OwnedChild {
  child: ChildProcessWithoutNullStreams;
  exited: Promise<void>;
  output(): string;
  ended(): boolean;
  error(): Error | null;
}

export interface DesktopProbeClient {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  close(): Promise<void>;
  readonly methods: string[];
}

export interface DesktopProbeThread {
  id: string;
  path?: string | null;
  createdAt?: number;
  turns?: unknown[];
}

/**
 * Low-level isolated harness, also used by the missing-base regression test.
 * Call dispose() in finally. Never connects to a configured/production endpoint.
 */
export class IsolatedDesktopProbe {
  readonly root = mkdtempSync(join(tmpdir(), 'sdm-desktop-mcp-'));
  readonly cwd = join(this.root, 'work');
  readonly trace = join(this.root, 'fixture-trace.jsonl');
  readonly env: NodeJS.ProcessEnv;
  private readonly cleanups: (() => Promise<void>)[] = [];
  readonly token = randomBytes(32).toString('hex');
  private server: OwnedChild | null = null;
  private endpoint: string | null = null;
  private disposed = false;

  constructor() {
    const paths = {
      HOME: join(this.root, 'home'), CODEX_HOME: join(this.root, 'codex'),
      XDG_CONFIG_HOME: join(this.root, 'xdg-config'), XDG_DATA_HOME: join(this.root, 'xdg-data'),
      XDG_CACHE_HOME: join(this.root, 'xdg-cache'), XDG_STATE_HOME: join(this.root, 'xdg-state'),
      XDG_RUNTIME_DIR: join(this.root, 'xdg-runtime'), TMPDIR: join(this.root, 'tmp'),
    };
    try {
      for (const path of [...Object.values(paths), this.cwd]) mkdirSync(path, { mode: 0o700 });
    } catch (error) { rmSync(this.root, { recursive: true, force: true }); throw error; }
    // An allowlist, NOT a copy of process.env. In particular: no auth tokens,
    // real HOME/CODEX_HOME, Desktop pipes/redirects, shim overrides, NODE_OPTIONS.
    this.env = {
      ...paths, TMP: paths.TMPDIR, TEMP: paths.TMPDIR,
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'en_US.UTF-8',
      SDM_MCP_FIXTURE_TRACE: this.trace, OTEL_SDK_DISABLED: 'true',
      HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
      ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost,::1',
    };
  }

  fixtureArguments(): string[] {
    const compiled = fileURLToPath(new URL('./testing/desktopMcpFixture.js', import.meta.url));
    if (existsSync(compiled)) return [compiled];
    // Development/tests only; production's compiled fixture needs no tsx.
    const source = fileURLToPath(new URL('./testing/desktopMcpFixture.ts', import.meta.url));
    const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
    if (!existsSync(source) || !existsSync(tsx)) throw new Error('Desktop MCP compatibility fixture is missing; rebuild the package');
    return [tsx, source];
  }

  spawnFixture(): ChildProcessWithoutNullStreams {
    return this.spawn(process.execPath, this.fixtureArguments()).child;
  }

  /** Test injection for the real bridge: retain exact child handles and temp cwd. */
  spawnChild(command: string, args: string[]): ChildProcessWithoutNullStreams {
    return this.spawn(command, args).child;
  }

  private spawn(command: string, args: string[]): OwnedChild {
    if (this.disposed) throw new Error('Probe already disposed');
    const child = spawn(command, args, { cwd: this.cwd, env: this.env, stdio: 'pipe' });
    let output = '';
    let ended = false;
    let error: Error | null = null;
    const exited = new Promise<void>((resolve) => {
      child.once('error', (value) => { error = value; ended = true; resolve(); });
      child.once('exit', () => { ended = true; resolve(); });
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_768); });
    }
    this.cleanups.push(async () => {
      if (ended) return;
      // Only this exact spawned child. No process-group/name-based termination.
      child.kill('SIGTERM');
      try { await bounded(exited, 1500, 'Probe child exit'); }
      catch {
        child.kill('SIGKILL');
        await bounded(exited, 1500, `Reaping probe child ${child.pid}`);
      }
    });
    return { child, exited, output: () => output, ended: () => ended, error: () => error };
  }

  async version(binary: string): Promise<string> {
    if (!isAbsolute(binary)) throw new Error('Codex probe requires an absolute executable path');
    const child = this.spawn(binary, ['--version']);
    await bounded(child.exited, RPC_MS, 'Codex version probe');
    if (child.error() || child.child.exitCode !== 0) throw new Error(`Codex version probe failed: ${child.error() ?? child.output()}`);
    const version = child.output().match(/^codex-cli (\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)/m)?.[1];
    if (!version) throw new Error(`Unrecognized Codex version: ${child.output()}`);
    return version;
  }

  launchArguments(withMcp: boolean): string[] {
    writeFileSync(join(this.env.CODEX_HOME!, 'config.toml'), [
      'model = "sdm-no-model-turns"', 'model_provider = "sdm_fixture"',
      'cli_auth_credentials_store = "file"', 'mcp_oauth_credentials_store = "file"',
      '[model_providers.sdm_fixture]', 'name = "Isolated fixture; no model requests"',
      'base_url = "http://127.0.0.1:9/v1"', 'wire_api = "responses"', 'requires_openai_auth = false',
      '[analytics]', 'enabled = false', '[feedback]', 'enabled = false', '',
    ].join('\n'), { mode: 0o600 });
    const overrides: string[] = [];
    if (withMcp) {
      const env = Object.entries(this.env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',');
      // The complete MCP base config is a startup override, just as in Desktop.
      overrides.push('-c', `mcp_servers.codex_app={command=${JSON.stringify(process.execPath)},args=${JSON.stringify(this.fixtureArguments())},env={${env}},startup_timeout_sec=8}`);
    }
    return [...overrides, 'app-server'];
  }

  async start(binary: string, withMcp: boolean): Promise<void> {
    if (!isAbsolute(binary)) throw new Error('Codex probe requires an absolute executable path');
    if (this.server) throw new Error('Each probe owns exactly one App Server');
    const hash = createHash('sha256').update(this.token).digest('hex');
    this.server = this.spawn(binary, [...this.launchArguments(withMcp), '--listen', 'ws://127.0.0.1:0',
      '--ws-auth', 'capability-token', '--ws-token-sha256', hash]);
    const deadline = Date.now() + START_MS;
    while (Date.now() < deadline) {
      if (this.server.ended()) throw new Error(`Isolated App Server exited: ${this.server.error() ?? this.server.output()}`);
      const matches = [...this.server.output().matchAll(/ws:\/\/127\.0\.0\.1:(\d+)/g)];
      const port = matches.map((match) => Number(match[1])).find((value) => value > 0);
      if (port) {
        if (port === 17532) throw new Error('Refusing the production App Server port');
        this.endpoint = `ws://127.0.0.1:${port}`;
        return;
      }
      await pause(50);
    }
    throw new Error(`No ephemeral listener announced within ${START_MS}ms: ${this.server.output()}`);
  }

  async rejectsAuthentication(token?: string): Promise<boolean> {
    if (!this.endpoint) throw new Error('Probe server is not started');
    const socket = new WebSocket(this.endpoint, {
      handshakeTimeout: 2000, headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    });
    const status = new Promise<boolean>((resolve) => {
      socket.on('error', () => resolve(false));
      socket.once('open', () => resolve(false));
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode === 401 || response.statusCode === 403);
      });
    });
    try { return await bounded(status, 2500, 'Unauthenticated WS rejection'); }
    finally { socket.terminate(); }
  }

  async client(name: string, endpoint = this.endpoint, token = this.token): Promise<DesktopProbeClient> {
    if (!endpoint || new URL(endpoint).hostname !== '127.0.0.1' || new URL(endpoint).port === '17532') {
      throw new Error('Probe requires a non-production loopback endpoint');
    }
    const socket = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 2500,
      maxPayload: 4 * 1024 * 1024,
    });
    // Supply the factory explicitly: never consult production shared-install state.
    const rpc = RpcConnection.webSocket(endpoint, () => socket);
    let closed = false;
    const closeEvent = new Promise<void>((resolve) => socket.once('close', () => { closed = true; resolve(); }));
    const close = async () => {
      rpc.close();
      if (closed) return;
      socket.close();
      try { await bounded(closeEvent, 500, 'Probe WebSocket close'); }
      catch { socket.terminate(); await bounded(closeEvent, 500, 'Probe WebSocket terminate'); }
    };
    this.cleanups.push(close);
    rpc.on('serverRequest', (id) => rpc.rejectServer(id, 'Interactive requests disabled in isolated compatibility probe'));
    const methods: string[] = [];
    const client: DesktopProbeClient = {
      methods, close,
      request: <T>(method: string, params?: unknown) => {
        if (!ALLOWED_METHODS.has(method)) throw new Error(`Forbidden compatibility probe method: ${method}`);
        methods.push(method);
        return rpc.request(method, params, RPC_MS) as Promise<T>;
      },
    };
    await client.request('initialize', { clientInfo: { name, version: '0.1.0' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized');
    return client;
  }

  threadParameters(): Record<string, unknown> {
    return { cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      config: { 'mcp_servers.codex_app.enabled_tools': ['echo'] } };
  }

  async tools(client: DesktopProbeClient, threadId: string): Promise<void> {
    const deadline = Date.now() + START_MS;
    let last: unknown;
    while (Date.now() < deadline) {
      last = await client.request('mcpServerStatus/list', { limit: 100, threadId });
      const fixture = (last as { data?: { name: string; tools?: Record<string, { name?: string }> }[] }).data
        ?.find((entry) => entry.name === 'codex_app');
      if (Object.values(fixture?.tools ?? {}).some((tool) => tool.name === 'echo')) return;
      await pause(100);
    }
    throw new Error(`codex_app.echo discovery failed: ${JSON.stringify(last)}`);
  }

  fixtureMethods(): string[] {
    if (!existsSync(this.trace)) return [];
    return readFileSync(this.trace, 'utf8').trim().split('\n')
      .map((line) => (JSON.parse(line) as { method: string }).method);
  }

  /** Synthetic durable fixture, distinct from the ephemeral thread/start probe. */
  durableFixture(version: string, completedTurnText?: string): DesktopProbeThread {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const directory = join(realpathSync(this.env.CODEX_HOME!), 'sessions', ...timestamp.slice(0, 10).split('-'));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `rollout-${timestamp.slice(0, 19).replaceAll(':', '-')}-${id}.jsonl`);
    const entries = [
      { timestamp, type: 'session_meta', payload: {
        id, timestamp, cwd: this.cwd, originator: 'sdm-isolated-fixture',
        cli_version: version, source: 'vscode', model_provider: 'sdm_fixture',
      } },
      { timestamp, type: 'response_item', payload: {
        type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'Isolated durable compatibility fixture.' }],
      } },
      // Optional synthetic UI turn: a bare response_item is not rendered as
      // conversation history, so it cannot prove excludeTurns takes effect.
      ...(completedTurnText === undefined ? [] : [
        { type: 'task_started', turn_id: id, model_context_window: 128000 },
        { type: 'user_message', message: 'Synthetic fixture only', images: [], local_images: [], text_elements: [] },
        { type: 'agent_message', message: completedTurnText, phase: 'final_answer' },
        { type: 'task_complete', turn_id: id, last_agent_message: null },
      ].map((payload) => ({ timestamp, type: 'event_msg', payload }))),
    ];
    writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, { mode: 0o600, flag: 'wx' });
    return { id, path };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    // Only this invocation's mkdtemp result; never HOME, a glob, or a workspace.
    rmSync(this.root, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'Compatibility probe cleanup failed');
  }
}

/**
 * Explicit, isolated install-time probe; importing this module does nothing.
 * Does not launch Desktop, use real auth/state, call a tool, or send a model turn.
 * Checks describe evidence, not an assertion of complete Desktop compatibility.
 */
export async function verifyDesktopServer(binary: string): Promise<{ version: string; checks: string[] }> {
  const probe = new IsolatedDesktopProbe();
  try {
    const version = await probe.version(binary);
    await probe.start(binary, true);
    if (!await probe.rejectsAuthentication()) throw new Error('App Server did not reject an unauthenticated WebSocket');
    if (!await probe.rejectsAuthentication('wrong-token')) throw new Error('App Server did not reject an incorrect WebSocket token');
    const first = await probe.client('sdm-desktop-compatibility');
    const second = await probe.client('sdm-micro-compatibility');
    const checks = ['isolated HOME/CODEX_HOME/XDG; no inherited auth', 'ephemeral loopback port; capability-token auth rejects missing and wrong tokens'];
    const started = await first.request<{ thread: DesktopProbeThread }>('thread/start', probe.threadParameters());
    if (!started.thread?.id) throw new Error('thread/start returned no thread ID');
    checks.push('thread/start(ephemeral) with startup MCP base + per-thread enabled_tools override');
    await probe.tools(first, started.thread.id);
    await probe.tools(second, started.thread.id);
    checks.push('codex_app.echo discovered by both WS clients for the same live thread');
    // A separate generated durable rollout verifies real disk resume. No fake
    // history request or alternate ID is accepted as a weaker success gate.
    const fixture = probe.durableFixture(version, 'Generated completed turn; no model request was sent.');
    const firstResume = await first.request<{ thread: DesktopProbeThread }>('thread/resume', {
      ...probe.threadParameters(), threadId: fixture.id, path: fixture.path,
    });
    if (firstResume.thread?.id !== fixture.id || firstResume.thread.path !== fixture.path) {
      throw new Error('Durable fixture resume changed the thread ID or rollout path');
    }
    if (!firstResume.thread.turns?.length) {
      throw new Error('Generated fixture has no rendered history; cannot verify metadata-only resume');
    }
    const secondResume = await second.request<{ thread: DesktopProbeThread }>('thread/resume', {
      ...probe.threadParameters(), threadId: fixture.id, excludeTurns: true,
    });
    if (secondResume.thread?.id !== fixture.id || secondResume.thread.path !== fixture.path) {
      throw new Error('Second-client durable resume changed the thread ID or rollout path');
    }
    if (secondResume.thread.turns?.length !== 0) {
      throw new Error('Metadata-only resume did not omit conversation history');
    }
    await probe.tools(first, fixture.id);
    await probe.tools(second, fixture.id);
    checks.push('generated durable JSONL fixture resumed by path and then exact same ID on two live connections',
      'metadata-only resume preserves the same thread without returning conversation history',
      'codex_app.echo discovered on the same resumed durable fixture by both clients',
      'LIMITATION: durable history is generated test data; persistence of a newly started no-turn task is not proven');
    const methods = probe.fixtureMethods();
    if (!methods.includes('initialize') || !methods.includes('tools/list') || methods.includes('tools/call')) {
      throw new Error(`Unexpected fixture activity: ${methods.join(', ')}`);
    }
    checks.push('fixture MCP initialize/tools/list observed; no tools/call or turn/start',
      'LIMITATION: fixture substitutes for real Desktop app-tool peer; its authentication and interactive callbacks are not verified');
    return { version, checks };
  } finally { await probe.dispose(); }
}
