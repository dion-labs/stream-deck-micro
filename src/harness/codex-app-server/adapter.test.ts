import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppServerAdapter, WriterHeldError, type AppServerConn } from './adapter.js';
import { classifyRolloutTail } from './monitor.js';
import type { SessionEvent } from '../../core/types.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class FakeConn implements AppServerConn {
  responders = new Map<string, (params: unknown) => unknown>();
  notificationSink: ((method: string, params: unknown) => void)[] = [];
  requests: { method: string; params: unknown }[] = [];
  closed = false;

  constructor() {
    this.responders.set('initialize', () => ({}));
  }

  respond(method: string, fn: (params: unknown) => unknown): void {
    this.responders.set(method, fn);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const fn = this.responders.get(method);
    if (!fn) return Promise.reject(new Error(`no responder for ${method}`));
    return Promise.resolve(fn(params));
  }

  onNotification(cb: (method: string, params: unknown) => void): () => void {
    this.notificationSink.push(cb);
    return () => {};
  }

  notify(): void {}

  push(method: string, params: unknown): void {
    for (const cb of this.notificationSink) cb(method, params);
  }

  close(): void {
    this.closed = true;
  }
}

function adapterWith(conn: FakeConn): AppServerAdapter {
  conn.respond('thread/start', () => ({ thread: { id: 't-new', name: null } }));
  return new AppServerAdapter({}, conn);
}

async function eventsOf(session: { onEvent: (cb: (e: SessionEvent) => void) => () => void }) {
  const events: SessionEvent[] = [];
  session.onEvent((e) => events.push(e));
  return events;
}

describe('AppServerAdapter', () => {
  it('initializes once and starts threads via thread/start', async () => {
    const conn = new FakeConn();
    const adapter = adapterWith(conn);
    await adapter.createSession({ cwd: '/tmp/x' });
    await adapter.createSession({ cwd: '/tmp/y' });
    const inits = conn.requests.filter((r) => r.method === 'initialize');
    expect(inits).toHaveLength(1);
    expect(conn.requests.at(-1)?.method).toBe('thread/start');
  });

  it('send resolves on turn/completed and maps item events', async () => {
    const conn = new FakeConn();
    conn.respond('turn/start', () => ({ turn: { id: 'turn-1', status: 'inProgress' } }));
    const adapter = adapterWith(conn);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const events = await eventsOf(session);

    const pending = session.send('do it');
    conn.push('turn/started', { threadId: 't-new', turn: { id: 'turn-1' } });
    conn.push('item/started', { threadId: 't-new', item: { type: 'reasoning' } });
    conn.push('item/started', {
      threadId: 't-new',
      item: { type: 'commandExecution', command: 'npm test' },
    });
    conn.push('item/completed', {
      threadId: 't-new',
      item: { type: 'fileChange', changes: [{ path: 'a.ts' }] },
    });
    conn.push('turn/completed', { threadId: 't-new', turn: { id: 'turn-1', status: 'completed' } });
    await pending;

    expect(events).toEqual([
      { type: 'turn-started' },
      { type: 'reasoning' },
      { type: 'tool-started', tool: 'shell', detail: 'npm test' },
      { type: 'file-change', files: ['a.ts'] },
      { type: 'turn-completed' },
    ]);
  });

  it('send rejects when the turn fails', async () => {
    const conn = new FakeConn();
    conn.respond('turn/start', () => ({ turn: { id: 'turn-2' } }));
    const adapter = adapterWith(conn);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const events = await eventsOf(session);
    const pending = session.send('go');
    conn.push('turn/completed', {
      threadId: 't-new',
      turn: { id: 'turn-2', status: 'failed', error: { message: 'model exploded' } },
    });
    await expect(pending).rejects.toThrow('model exploded');
    expect(events.at(-1)).toEqual({ type: 'turn-failed', error: 'model exploded' });
  });

  it('interrupt issues turn/interrupt for the active turn', async () => {
    const conn = new FakeConn();
    conn.respond('turn/start', () => ({ turn: { id: 'turn-3' } }));
    conn.respond('turn/interrupt', (p) => {
      expect(p).toEqual({ threadId: 't-new', turnId: 'turn-3' });
      return {};
    });
    const adapter = adapterWith(conn);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const pending = session.send('long');
    session.interrupt();
    conn.push('turn/completed', {
      threadId: 't-new',
      turn: { id: 'turn-3', status: 'interrupted' },
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects concurrent sends', async () => {
    const conn = new FakeConn();
    conn.respond('turn/start', () => ({ turn: { id: 'turn-4' } }));
    const adapter = adapterWith(conn);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const first = session.send('one');
    await expect(session.send('two')).rejects.toThrow(/already running/);
    conn.push('turn/completed', { threadId: 't-new', turn: { id: 'turn-4', status: 'completed' } });
    await first;
  });

  it('resumeSession maps active-writer errors to WriterHeldError', async () => {
    const conn = new FakeConn();
    conn.respond('thread/resume', () => {
      throw new Error('rpc error -32600 thread abc already has an active writer');
    });
    const adapter = adapterWith(conn);
    await expect(adapter.resumeSession('abc', { cwd: '/x' })).rejects.toThrow(WriterHeldError);
  });

  it('thread/name/updated updates the session name via a meta event', async () => {
    const conn = new FakeConn();
    const adapter = adapterWith(conn);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const events = await eventsOf(session);
    conn.push('thread/name/updated', { threadId: 't-new', name: 'Fix the build' });
    expect(session.name).toBe('Fix the build');
    expect(events).toContainEqual({ type: 'meta' });
  });

  it('externally-owned sessions preserve the writer-held error while still owned elsewhere', async () => {
    const conn = new FakeConn();
    conn.respond('thread/resume', () => {
      throw new Error('thread ext-1 already has an active writer');
    });
    const adapter = adapterWith(conn);
    const session = adapter.monitorSession({ id: 'ext-1', name: 'Rust Star', cwd: '/tmp/rust' });
    expect(session.sessionId).toBe('ext-1');
    expect(session.name).toBe('Rust Star');
    await expect(session.send('hi')).rejects.toThrow(WriterHeldError);
  });

  it('re-acquires an externally-owned session on send after its writer is released', async () => {
    const conn = new FakeConn();
    conn.respond('thread/resume', () => ({ thread: { id: 'ext-1', name: 'Rust Star' } }));
    conn.respond('turn/start', () => ({ turn: { id: 'turn-ext' } }));
    const adapter = adapterWith(conn);
    const session = adapter.monitorSession({ id: 'ext-1', name: 'Rust Star', cwd: '/tmp/rust' });
    const events = await eventsOf(session);

    const pending = session.send('do it');
    await vi.waitFor(() => {
      expect(conn.requests.some((request) => request.method === 'turn/start')).toBe(true);
    });
    conn.push('turn/started', { threadId: 'ext-1', turn: { id: 'turn-ext' } });
    conn.push('turn/completed', {
      threadId: 'ext-1',
      turn: { id: 'turn-ext', status: 'completed' },
    });

    await expect(pending).resolves.toBeUndefined();
    expect(conn.requests.find((request) => request.method === 'thread/resume')?.params).toEqual({
      threadId: 'ext-1',
      cwd: '/tmp/rust',
    });
    expect(events).toContainEqual({ type: 'turn-started' });
    expect(events).toContainEqual({ type: 'turn-completed' });
  });

  it('listSessions maps thread records with preview fallback labels', async () => {
    const conn = new FakeConn();
    conn.respond('thread/list', () => ({
      data: [
        { id: 'a', name: 'Rust Star', updatedAt: 1787380000 },
        { id: 'b', preview: 'fix   the flaky login test please now', updatedAt: 1787370000 },
        { id: 'c', name: null, preview: null, ephemeral: true },
      ],
    }));
    const adapter = adapterWith(conn);
    const sessions = await adapter.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(sessions[0].name).toBe('Rust Star');
    expect(sessions[1].name).toBe('fix the flaky login test ple…');
    expect(sessions[0].updatedAt).toBeTypeOf('string');
  });

  it('listThreadRecords supplies the same preview fallback used by the session catalog', async () => {
    const conn = new FakeConn();
    conn.respond('thread/list', () => ({
      data: [{ id: 'b', name: null, preview: 'https://map.thinkdog.it/ I am testing this' }],
    }));
    const adapter = adapterWith(conn);

    const records = await adapter.listThreadRecords();

    expect(records[0].name).toBe('https://map.thinkdog.it/ I a…');
  });
});

describe('classifyRolloutTail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdm-monitor-'));
  const rollout = join(dir, 'rollout-test.jsonl');

  it('classifies reasoning tail as thinking', async () => {
    writeFileSync(
      rollout,
      [
        JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'reasoning' } }),
      ].join('\n'),
    );
    expect(await classifyRolloutTail(rollout)).toBe('thinking');
  });

  it('classifies function_call tail as running', async () => {
    writeFileSync(
      rollout,
      [
        JSON.stringify({ type: 'response_item', payload: { type: 'reasoning' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'function_call' } }),
      ].join('\n'),
    );
    expect(await classifyRolloutTail(rollout)).toBe('running');
  });

  it('returns null for missing files and empty files', async () => {
    expect(await classifyRolloutTail(join(dir, 'nope.jsonl'))).toBeNull();
    writeFileSync(join(dir, 'empty.jsonl'), '');
    expect(await classifyRolloutTail(join(dir, 'empty.jsonl'))).toBeNull();
  });

  it('ignores trailing partial line', async () => {
    writeFileSync(
      rollout,
      [
        JSON.stringify({ type: 'response_item', payload: { type: 'reasoning' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'function_call' } }),
        '{"type":"response_item","payload":{"type":"reasoning"  ', // partial
      ].join('\n'),
    );
    expect(await classifyRolloutTail(rollout)).toBe('running');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

describe('ExternalThreadMonitor', () => {
  it('does not mark an old thread active on first sight', async () => {
    const { ExternalThreadMonitor } = await import('./monitor.js');
    const old = Math.floor(Date.now() / 1000) - 60;
    const monitor = new ExternalThreadMonitor(
      async () => [{ id: 'ext-old', updatedAt: old, path: null }],
      { pollMs: 20, quietMs: 100 },
    );
    const events: SessionEvent[] = [];
    monitor.watch('ext-old', (event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(events).toEqual([]);
    monitor.dispose();
  });

  it('emits lifecycle events from updatedAt bumps', async () => {
    let records: { id: string; updatedAt: number | null; path: string | null }[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'sdm-mon2-'));
    const rollout = join(dir, 'r.jsonl');
    writeFileSync(rollout, JSON.stringify({ payload: { type: 'reasoning' } }));

    const { ExternalThreadMonitor } = await import('./monitor.js');
    const monitor = new ExternalThreadMonitor(async () => records, { pollMs: 25, quietMs: 150 });
    const events: SessionEvent[] = [];
    const base = Math.floor(Date.now() / 1000);
    records = [{ id: 'ext-1', updatedAt: base, path: rollout }];
    monitor.watch('ext-1', (e) => events.push(e));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await sleep(120); // first polls: recently updated → activate + classify
    expect(events).toContainEqual({ type: 'turn-started' });
    expect(events).toContainEqual({ type: 'reasoning' });

    events.length = 0;
    records = [{ id: 'ext-1', updatedAt: base + 5, path: rollout }]; // bump keeps it alive
    await sleep(120);
    expect(events.some((e) => e.type === 'turn-started')).toBe(false); // still the same turn

    records = [{ id: 'ext-1', updatedAt: base + 5, path: rollout }]; // no further bumps
    await sleep(400); // quiet window elapses
    expect(events).toContainEqual({ type: 'turn-completed' });
    monitor.dispose();
    rmSync(dir, { recursive: true, force: true });
  }, 10000);
});
