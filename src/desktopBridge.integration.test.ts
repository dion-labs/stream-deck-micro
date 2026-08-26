/**
 * Opt in to the bundled binary:
 * SDM_TEST_CODEX=/absolute/path/to/codex npm test -- src/desktopBridge.integration.test.ts
 * No Desktop process/pipe, production port, real auth, user history, or model turn.
 */
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, type Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  IsolatedDesktopProbe, verifyDesktopServer,
  type DesktopProbeClient, type DesktopProbeThread,
} from './desktopCompatibility.js';
import { runDesktopBridge } from './desktopBridge.js';

const binary = process.env.SDM_TEST_CODEX;
const TIMEOUT = 60_000;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  vi.restoreAllMocks();
  if (errors.length) throw new AggregateError(errors, 'Isolated integration cleanup failed');
}, 15_000);

function probe(): IsolatedDesktopProbe {
  const value = new IsolatedDesktopProbe();
  cleanups.push(() => value.dispose());
  return value;
}

async function bounded<T>(pending: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Isolated integration deadline exceeded')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** Test-side stdio peer: string IDs and notifications remain visible to assertions. */
class StdioPeer implements DesktopProbeClient {
  readonly methods: string[] = [];
  readonly notifications: { method: string; params: any }[] = [];
  private sequence = 0;
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  private lines: ReturnType<typeof createInterface>;

  constructor(input: Readable, private readonly send: (line: string) => void) {
    this.lines = createInterface({ input });
    this.lines.on('line', (line) => {
      const message = JSON.parse(line);
      if (message.method) {
        if (message.id !== undefined) throw new Error('Unexpected interactive App Server request; no callbacks are authorized');
        this.notifications.push(message);
        return;
      }
      const waiter = this.pending.get(String(message.id));
      if (!waiter) return;
      this.pending.delete(String(message.id));
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = 'desktop:' + (++this.sequence);
    return this.requestRaw<T>(id, ' { "jsonrpc" : "2.0", "id" : ' + JSON.stringify(id)
      + ', "method" : ' + JSON.stringify(method) + ', "params" : ' + JSON.stringify(params) + ' }');
  }

  requestRaw<T>(id: string, line: string): Promise<T> {
    const message = JSON.parse(line);
    if (message.method === 'turn/start') throw new Error('Model turns forbidden in isolated integration');
    this.methods.push(message.method);
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(line + '\n');
    });
    return bounded(response).finally(() => this.pending.delete(id));
  }

  notify(method: string): void { this.send(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); }
  async close(): Promise<void> {
    this.lines.close();
    for (const pending of this.pending.values()) pending.reject(new Error('Test peer closed'));
    this.pending.clear();
  }
}

async function unusedLoopbackEndpoint(): Promise<string> {
  // The wrapper requires its endpoint before spawning. Release a kernel-chosen
  // port immediately before launch; unique per-launch auth makes collision fail
  // closed rather than attaching to any unrelated listener.
  const listener = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (!address || typeof address === 'string' || address.port === 17532) throw new Error('Invalid isolated listener');
    return 'ws://127.0.0.1:' + address.port;
  } finally {
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  }
}

describe('isolated Desktop MCP fixture', () => {
  it('implements initialize, tools/list and harmless echo on Node stdio', async () => {
    const state = probe();
    const child = state.spawnFixture();
    const peer = new StdioPeer(child.stdout, (line) => { child.stdin.write(line); });
    cleanups.push(() => peer.close());
    expect(await peer.request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    })).toMatchObject({ serverInfo: { name: 'sdm-desktop-mcp-fixture' }, capabilities: { tools: {} } });
    peer.notify('notifications/initialized');
    expect(await peer.request('tools/list')).toMatchObject({ tools: [{ name: 'echo' }] });
    expect(await peer.request('tools/call', { name: 'echo', arguments: { text: 'isolated echo' } }))
      .toEqual({ content: [{ type: 'text', text: 'isolated echo' }], isError: false });
    expect(() => peer.request('turn/start')).toThrow('forbidden');
  }, TIMEOUT);

  it('generates assistant-only durable test data strictly under its temporary CODEX_HOME', async () => {
    const state = probe();
    const thread = state.durableFixture('fixture-version');
    const records = readFileSync(thread.path!, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0].payload.id).toBe(thread.id);
    expect(records[0].payload.cwd).toBe(state.cwd);
    expect(records[0].payload.model_provider).toBe('sdm_fixture');
    expect(records[1].payload.role).toBe('assistant');
    const root = state.root;
    await state.dispose();
    expect(existsSync(root)).toBe(false);
  });
});

describe.skipIf(!binary)('real bundled App Server / isolated shared WS', () => {
  it('resumes oversized history with metadata only, without raising the WS payload limit', async () => {
    const state = probe();
    const version = await state.version(binary!);
    const fixture = state.durableFixture(version, 'x'.repeat(33 * 1024 * 1024));
    await state.start(binary!, true);
    const fullHistory = await state.client('sdm-full-history-regression');
    await expect(fullHistory.request('thread/resume', {
      ...state.threadParameters(), threadId: fixture.id, path: fixture.path,
    })).rejects.toThrow('WS_ERR_UNSUPPORTED_MESSAGE_LENGTH');
    await fullHistory.close();

    const metadataOnly = await state.client('sdm-metadata-only-regression');
    const resumed = await metadataOnly.request<{ thread: DesktopProbeThread }>('thread/resume', {
      ...state.threadParameters(), threadId: fixture.id, excludeTurns: true,
    });
    expect(resumed.thread).toMatchObject({ id: fixture.id, path: fixture.path, turns: [] });
    expect(Buffer.byteLength(JSON.stringify(resumed))).toBeLessThan(64 * 1024);
    await state.tools(metadataOnly, fixture.id);
    expect(metadataOnly.methods).not.toContain('turn/start');
  }, TIMEOUT);

  it('reproduces missing MCP base config at thread/start', async () => {
    const state = probe();
    await state.start(binary!, false);
    const client = await state.client('sdm-partial-config-regression');
    let error = '';
    try { await client.request('thread/start', state.threadParameters()); }
    catch (failure) { error = String(failure); }
    expect(error).toMatch(/invalid transport|missing field.*command/i);
    expect(error).toContain('mcp_servers.codex_app');
    expect(state.fixtureMethods()).toEqual([]);
    expect(client.methods).not.toContain('turn/start');
    console.info('Missing-base regression:', error);
  }, TIMEOUT);

  it('requires authenticated clients, ephemeral start, durable same-ID resume and MCP discovery', async () => {
    const result = await verifyDesktopServer(binary!);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.checks).toContain('ephemeral loopback port; capability-token auth rejects missing and wrong tokens');
    expect(result.checks).toContain('generated durable JSONL fixture resumed by path and then exact same ID on two live connections');
    expect(result.checks).toContain('codex_app.echo discovered on the same resumed durable fixture by both clients');
    console.info('Compatibility verification:', JSON.stringify(result));
  }, TIMEOUT);

  it('relays Desktop initialization and notifications through the real wrapper; Micro resumes the same durable task', async () => {
    const state = probe();
    const version = await state.version(binary!);
    const endpoint = await unusedLoopbackEndpoint();
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    let diagnosticText = '';
    diagnostics.on('data', (data) => { diagnosticText = (diagnosticText + String(data)).slice(-8192); });
    const records: Record<string, unknown>[] = [];
    const fingerprint = 'f'.repeat(64);
    const sent = vi.spyOn(WebSocket.prototype, 'send');
    const desktop = new StdioPeer(output, (line) => { input.write(line); });
    const bridge = runDesktopBridge({
      args: state.launchArguments(true), binary: binary!, env: state.env,
      input, output, diagnostics, fingerprint: async () => fingerprint,
      install: {
        mode: 'desktop-launch', url: endpoint, codexPath: binary!,
        configPath: join(state.root, 'unused-micro-config.json'),
        launcherPath: join(state.root, 'unused-launcher'), fingerprint, version, token: '0'.repeat(64),
      },
      record: (value) => { records.push(value); },
      startupTimeoutMs: 5000,
      launch: (command, args, environment) => {
        // Keep the real binary in the isolated cwd, including in native fallback.
        expect(environment).toEqual(state.env);
        return state.spawnChild(command, args);
      },
    });
    // Attach rejection handling immediately; finally still asserts the exit code.
    void bridge.catch(() => {});
    cleanups.push(async () => {
      input.end();
      try { await bounded(bridge, 8000); }
      finally { await desktop.close(); input.destroy(); output.destroy(); diagnostics.destroy(); }
    });
    const initialize = ' { "jsonrpc" : "2.0", "id" : "desktop:init:unchanged", "method" : "initialize", "params" : '
      + JSON.stringify({ clientInfo: { name: 'sdm-desktop-through-shim', title: 'Preserve identity', version: '0.1.0' },
        capabilities: { experimentalApi: true } }) + ' }';
    await desktop.requestRaw('desktop:init:unchanged', initialize);
    desktop.notify('initialized');
    // Assert byte-identical initialize forwarding, not merely a similar result.
    expect(sent.mock.calls.some((call) => call[0] === initialize)).toBe(true);
    const shared = records.find((entry) => entry.mode === 'shared');
    expect(typeof shared?.token === 'string').toBe(true);
    const token = shared!.token as string; // Never print tokens or include them in diagnostics.
    const micro = await state.client('sdm-micro-through-shim', endpoint, token);
    const started = await desktop.request<{ thread: DesktopProbeThread }>('thread/start', state.threadParameters());
    expect(started.thread.id).toEqual(expect.any(String));
    await state.tools(desktop, started.thread.id);
    await state.tools(micro, started.thread.id);
    const fixture = state.durableFixture(version);
    const firstResume = await desktop.request<{ thread: DesktopProbeThread }>('thread/resume', {
      ...state.threadParameters(), threadId: fixture.id, path: fixture.path,
    });
    const secondResume = await micro.request<{ thread: DesktopProbeThread }>('thread/resume', {
      ...state.threadParameters(), threadId: fixture.id,
    });
    expect(firstResume.thread.id).toBe(fixture.id);
    expect(secondResume.thread.id).toBe(fixture.id);
    expect(firstResume.thread.path).toBe(fixture.path);
    expect(secondResume.thread.path).toBe(fixture.path);
    await state.tools(desktop, fixture.id);
    await state.tools(micro, fixture.id);
    expect(desktop.notifications.some((event) => event.method === 'thread/started'
      && event.params?.thread?.id === started.thread.id)).toBe(true);
    expect([...desktop.methods, ...micro.methods]).not.toContain('turn/start');
    expect(state.fixtureMethods()).toContain('tools/list');
    expect(state.fixtureMethods()).not.toContain('tools/call');
    expect(diagnosticText.includes(token)).toBe(false);
    await micro.close();
    input.end();
    expect(await bounded(bridge, 8000)).toBe(0);
    console.info('Real wrapper: exact initialize bytes/string ID and thread/started notification relayed; two authenticated clients resume the same durable fixture; tools discovered; no model turns.');
    // Interactive server->client callbacks and real Desktop app-tool peer auth
    // are deliberately not claimed: no real peer, tool execution, or turn exists.
  }, TIMEOUT);
});
