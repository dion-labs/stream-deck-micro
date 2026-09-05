import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { runDesktopBridge, sharedServerArguments } from './desktopBridge.js';
import {
  cleanDesktopEnvironment, desktopBuildFingerprint, validateSharedEndpoint,
  type DesktopSharedInstall,
} from './sharedRuntime.js';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const args = ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled',
  '-c', 'mcp_servers.codex_app={command="/path with spaces/mcp",env={CODEX_APP_TOOLS_PIPE_PATH="/tmp/per-launch.sock"}}'];
const install: DesktopSharedInstall = {
  mode: 'desktop-launch', url: 'ws://127.0.0.1:17532', codexPath: '/bundle/codex',
  configPath: '/micro/config.json', launcherPath: '/micro/launcher',
  fingerprint: 'a'.repeat(64), version: 'test', token: 'b'.repeat(64),
};

describe('Desktop-owned shared startup', () => {
  it('preserves every Desktop override, quoting and dynamic pipe verbatim', () => {
    expect(sharedServerArguments(args, install.url)).toEqual([...args, '--listen', install.url]);
    expect(args).toHaveLength(6);
  });

  it.each([
    ['--version'], ['app-server', 'generate-ts'], ['app-server', 'proxy'],
    ['app-server', '--listen', 'stdio://'], [...args, '--future-option'],
    ['app-server'], ['app-server', '-c'], ['exec', 'hello'], [...args, '--help'],
  ])('does not intercept an unknown command/contract: %j', (...values) => {
    expect(sharedServerArguments(values, install.url)).toBeNull();
  });

  it('cleans routing inheritance without losing actual MCP or tool settings', () => {
    const env = { PATH: '/bin', CODEX_CLI_PATH: '/shim', CODEX_APP_SERVER_WS_URL: install.url,
      CODEX_APP_SERVER_FORCE_CLI: '1', CODEX_APP_SERVER_USE_LOCAL_DAEMON: '1',
      CODEX_APP_TOOLS_PIPE_PATH: '/tmp/current.sock', OTHER_SETTING: 'preserved' };
    expect(cleanDesktopEnvironment(env)).toEqual({ PATH: '/bin',
      CODEX_APP_TOOLS_PIPE_PATH: '/tmp/current.sock', OTHER_SETTING: 'preserved' });
    expect(env.CODEX_CLI_PATH).toBe('/shim');
  });

  it('fingerprints the Desktop and server artifacts, including same-version changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'micro-fingerprint-')); temporary.push(dir);
    const files = [join(dir, 'codex'), join(dir, 'app.asar')];
    files.forEach((file) => writeFileSync(file, 'first'));
    const first = await desktopBuildFingerprint(files);
    writeFileSync(files[1], 'other');
    expect(await desktopBuildFingerprint(files)).not.toBe(first);
  });

  it.each(['ws://example.com:17532', 'ws://127.0.0.1', 'http://127.0.0.1:17532',
    'ws://127.0.0.1:17532/path', 'ws://127.0.0.1:17532/?query=1', 'ws://127.0.0.1:17532/#hash'])('rejects unsafe managed endpoint %s', (url) => {
    expect(() => validateSharedEndpoint(url)).toThrow();
  });

  it('uses native stdio on an unverified Desktop build; forwards queued input exactly once', async () => {
    const input = new PassThrough(); const output = new PassThrough(); const diagnostics = new PassThrough();
    const frames: string[] = []; output.on('data', (chunk) => frames.push(chunk.toString()));
    const launches: unknown[] = []; const records: unknown[] = [];
    input.end('{"id":1,"method":"initialize"}\n');
    const result = await runDesktopBridge({ args, input, output, diagnostics, install,
      fingerprint: async () => 'changed', env: { CODEX_APP_SERVER_WS_URL: install.url, KEEP: 'yes' },
      record: (value) => records.push(value),
      launch: (binary, actualArgs, env, shared) => {
        launches.push({ binary, actualArgs, env, shared });
        return spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)']);
      },
    });
    expect(result).toBe(0);
    expect(launches).toEqual([{ binary: '/Applications/ChatGPT.app/Contents/Resources/codex', actualArgs: args,
      env: { KEEP: 'yes' }, shared: false }]);
    expect(frames.join('')).toBe('{"id":1,"method":"initialize"}\n');
    expect(records.at(-1)).toMatchObject({ mode: 'private', reason: expect.stringContaining('build changed') });
  });

  it('falls back before forwarding requests when the shared child cannot start', async () => {
    const input = new PassThrough(); input.end('{"method":"initialize","id":1}\n');
    const output = new PassThrough(); const chunks: string[] = [];
    output.on('data', (chunk) => chunks.push(chunk.toString()));
    const launches: boolean[] = [];
    const code = await runDesktopBridge({ args, input, output, diagnostics: new PassThrough(), install,
      fingerprint: async () => install.fingerprint, record: () => {}, startupTimeoutMs: 500,
      launch: (_binary, _args, _env, shared) => {
        launches.push(shared);
        return spawn(process.execPath, ['-e', shared ? 'process.exit(2)' : 'process.stdin.pipe(process.stdout)']);
      },
    });
    expect(code).toBe(0);
    expect(launches).toEqual([true, false]);
    expect(chunks.join('')).toBe('{"method":"initialize","id":1}\n');
  });

  it.each(['EOF', 'signal'])('relays both RPC directions unchanged and shuts down cleanly on %s', async (shutdown) => {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const endpoint = `ws://127.0.0.1:${port}`;
    const controller = new AbortController();
    const input = new PassThrough(); const output = new PassThrough();
    const records: Record<string, any>[] = []; const frames: any[] = []; const launches: boolean[] = [];
    const lines = createInterface({ input: output });
    lines.on('line', (line) => {
      const frame = JSON.parse(line); frames.push(frame);
      if (frame.method === 'test/server-request') input.write(JSON.stringify({ id: frame.id, result: { received: true } }) + '\n');
    });
    const script = `
      const {WebSocketServer} = require('ws');
      const {createHash} = require('node:crypto');
      const args = process.argv.slice(1);
      const url = new URL(args[args.indexOf('--listen')+1]);
      const expected = args[args.indexOf('--ws-token-sha256')+1];
      const server = new WebSocketServer({host:url.hostname, port:Number(url.port),
        verifyClient: ({req}) => createHash('sha256').update((req.headers.authorization||'').replace(/^Bearer /,'')).digest('hex') === expected});
      server.on('connection', socket => socket.on('message', data => {
        const m = JSON.parse(data.toString());
        if(m.method === 'initialize') {
          socket.send(JSON.stringify({id:m.id,result:{userAgent:'fixture'}}));
          socket.send(JSON.stringify({id:'callback-7',method:'test/server-request',params:{value:3}}));
        } else if(m.id === 'callback-7') socket.send(JSON.stringify({method:'test/completed',params:m.result}));
      }));
    `;
    const running = runDesktopBridge({ args, input, output, diagnostics: new PassThrough(),
      install: { ...install, url: endpoint }, fingerprint: async () => install.fingerprint,
      signal: controller.signal,
      record: (record) => records.push(record), startupTimeoutMs: 3000,
      launch: (_binary, actualArgs, _env, shared) => {
        launches.push(shared);
        return spawn(process.execPath, ['-e', script, '--', ...actualArgs], { stdio: 'pipe' });
      },
    });
    input.write('{"id":42,"method":"initialize","params":{"clientInfo":{"name":"desktop"}}}\n');
    let micro: WebSocket | undefined;
    try {
      await expect.poll(() => frames.some((frame) => frame.method === 'test/completed'), { timeout: 3500 }).toBe(true);
      expect(frames).toEqual(expect.arrayContaining([
        { id: 42, result: { userAgent: 'fixture' } },
        { id: 'callback-7', method: 'test/server-request', params: { value: 3 } },
        { method: 'test/completed', params: { received: true } },
      ]));
      const runtime = records.find((record) => record.mode === 'shared')!;
      expect(runtime.token).toMatch(/^[a-f0-9]{64}$/);
      expect(runtime.token).not.toBe(install.token);
      micro = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${runtime.token}` } });
      await new Promise<void>((resolve, reject) => { micro!.once('open', resolve); micro!.once('error', reject); });
      expect(launches).toEqual([true]);
    } finally {
      micro?.terminate();
      if (shutdown === 'signal') controller.abort();
      else input.end();
      expect(await running).toBe(0);
      lines.close();
    }
    expect(records.some((record) => record.mode === 'blocked')).toBe(false);
  }, 8000);

  it.each(['fingerprint', 'startup'])('does not launch a fallback child or trip the circuit when closed during %s', async (phase) => {
    const controller = new AbortController();
    const launches: boolean[] = []; const records: unknown[] = [];
    const result = await runDesktopBridge({ args, install, input: new PassThrough(), output: new PassThrough(),
      diagnostics: new PassThrough(), signal: controller.signal, record: (value) => records.push(value),
      fingerprint: async () => {
        if (phase === 'fingerprint') controller.abort();
        return install.fingerprint;
      },
      launch: (_binary, _args, _env, shared) => {
        launches.push(shared);
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
        setTimeout(() => controller.abort(), 10);
        return child;
      },
    });
    expect(result).toBe(0);
    expect(launches).toEqual(phase === 'fingerprint' ? [] : [true]);
    expect(records).toEqual([]);
  });
});

describe('automatic verification recovery', () => {
  it.each(['private', 'startup-exit', 'blocked', 'reverified'])('only retries a previous transient failure before requests were forwarded (%s)', async (mode) => {
    const input = new PassThrough(); const output = new PassThrough();
    const chunks: string[] = []; output.on('data', (chunk) => chunks.push(String(chunk)));
    input.end('{"method":"initialize","id":1}\n');
    const launches: boolean[] = []; const records: Record<string, unknown>[] = [];
    let verifications = 0;
    const result = await runDesktopBridge({
      args, input, output, diagnostics: new PassThrough(), install: { ...install, autoConnect: true, verificationGeneration: mode === 'reverified' ? 'new-verification' : undefined },
      fingerprint: async () => install.fingerprint,
      priorRuntime: { fingerprint: install.fingerprint, mode: mode === 'reverified' ? 'blocked' : mode === 'startup-exit' ? 'private' : mode, reason: mode === 'startup-exit' ? 'shared server exited during startup' : 'ECONNRESET' },
      automaticVerify: async () => { verifications++; return install.fingerprint; },
      record: (record) => records.push(record), startupTimeoutMs: 100,
      launch: (_binary, _args, _env, shared) => {
        launches.push(shared);
        return spawn(process.execPath, ['-e', shared ? 'process.exit(2)' : 'process.stdin.pipe(process.stdout)']);
      },
    });
    expect(result).toBe(0);
    expect(verifications).toBe(mode === 'private' || mode === 'startup-exit' ? 1 : 0);
    expect(launches).toEqual(mode === 'blocked' ? [false] : [true, false]);
    expect(chunks.join('')).toBe('{"method":"initialize","id":1}\n');
    if (mode === 'blocked') expect(records.at(-1)?.mode).toBe('blocked');
  });

  it('keeps queued input intact when automatic verification fails', async () => {
    const input = new PassThrough(); const output = new PassThrough(); const launches: boolean[] = [];
    const chunks: string[] = []; output.on('data', (chunk) => chunks.push(String(chunk)));
    input.end('{"method":"initialize","id":1}\n');
    await runDesktopBridge({
      args, input, output, diagnostics: new PassThrough(), install: { ...install, autoConnect: true },
      fingerprint: async () => 'changed', record: () => {},
      automaticVerify: async () => { throw new Error('Compatibility assertion failed'); },
      launch: (_binary, _args, _env, shared) => {
        launches.push(shared); return spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)']);
      },
    });
    expect(launches).toEqual([false]);
    expect(chunks.join('')).toBe('{"method":"initialize","id":1}\n');
  });

  it('cancels verification without launching a backend when Desktop closes', async () => {
    const controller = new AbortController(); let launched = false;
    const result = await runDesktopBridge({
      args, input: new PassThrough(), output: new PassThrough(), diagnostics: new PassThrough(),
      install: { ...install, autoConnect: true }, fingerprint: async () => 'changed',
      record: () => {}, signal: controller.signal,
      automaticVerify: async (_install, options) => {
        controller.abort(); expect(options?.signal?.aborted).toBe(true);
        throw new Error('cancelled');
      },
      launch: () => { launched = true; throw new Error('must not launch'); },
    });
    expect(result).toBe(0); expect(launched).toBe(false);
  });
});
