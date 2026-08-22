import { describe, expect, it } from 'vitest';
import { CodexAdapter } from './adapter.js';
import type { SessionEvent } from '../../core/types.js';
import type { CodexLike, ThreadLike } from './adapter.js';

function fakeThread(events: object[], id: string | null = null): ThreadLike {
  return {
    id,
    async runStreamed() {
      async function* gen() {
        for (const e of events) yield e;
      }
      return { events: gen() };
    },
  };
}

function adapterWith(threads: ThreadLike[]): CodexAdapter {
  let i = 0;
  const codex: CodexLike = {
    startThread: async () => threads[i++] ?? fakeThread([]),
    resumeThread: async (id) => {
      const t = threads[i++] ?? fakeThread([]);
      return { ...t, id } as ThreadLike;
    },
  };
  return new CodexAdapter({}, codex);
}

async function collect(session: ReturnType<typeof adapterWith> extends never ? never : any) {
  const events: SessionEvent[] = [];
  session.onEvent((e: SessionEvent) => events.push(e));
  await session.send('test');
  return events;
}

describe('CodexAdapter event translation', () => {
  it('maps a full happy turn', async () => {
    const adapter = adapterWith([
      fakeThread([
        { type: 'thread.started', thread_id: 't1' },
        { type: 'turn.started' },
        { type: 'item.started', item: { id: 'r1', type: 'reasoning', text: 'hmm' } },
        {
          type: 'item.completed',
          item: { id: 'c1', type: 'command_execution', command: 'npm test', status: 'completed' },
        },
        {
          type: 'item.completed',
          item: {
            id: 'f1',
            type: 'file_change',
            changes: [{ path: 'src/a.ts', kind: 'update' }],
            status: 'completed',
          },
        },
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'done' } },
        { type: 'turn.completed', usage: {} },
      ]),
    ]);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const events = await collect(session);

    expect(events).toEqual([
      { type: 'turn-started' },
      { type: 'reasoning' },
      { type: 'tool-started', tool: 'shell', detail: 'npm test' },
      { type: 'file-change', files: ['src/a.ts'] },
      { type: 'agent-message', text: 'done' },
      { type: 'turn-completed' },
    ]);
  });

  it('maps mcp tool calls and web search', async () => {
    const adapter = adapterWith([
      fakeThread([
        { type: 'turn.started' },
        {
          type: 'item.started',
          item: { id: 'm1', type: 'mcp_tool_call', server: 'node_repl', tool: 'eval' },
        },
        { type: 'item.started', item: { id: 'w1', type: 'web_search', query: 'elgato hid' } },
        { type: 'turn.completed' },
      ]),
    ]);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const events = await collect(session);
    expect(events).toContainEqual({
      type: 'tool-started',
      tool: 'eval',
      detail: 'node_repl/eval',
    });
    expect(events).toContainEqual({
      type: 'tool-started',
      tool: 'web-search',
      detail: 'elgato hid',
    });
  });

  it('maps turn.failed and stream errors to turn-failed', async () => {
    const adapter = adapterWith([
      fakeThread([
        { type: 'turn.started' },
        { type: 'turn.failed', error: { message: 'boom' } },
      ]),
    ]);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const events = await collect(session);
    expect(events).toContainEqual({ type: 'turn-failed', error: 'boom' });

    const adapter2 = adapterWith([fakeThread([{ type: 'error', message: 'stream died' }])]);
    const session2 = await adapter2.createSession({ cwd: '/tmp/x' });
    const events2 = await collect(session2);
    expect(events2).toContainEqual({ type: 'turn-failed', error: 'stream died' });
  });

  it('rejects concurrent sends on one session', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const thread: ThreadLike = {
      id: null,
      async runStreamed() {
        async function* gen() {
          yield { type: 'turn.started' } as object;
          await gate;
          yield { type: 'turn.completed' } as object;
        }
        return { events: gen() };
      },
    };
    const adapter = adapterWith([thread]);
    const session = await adapter.createSession({ cwd: '/tmp/x' });
    const first = session.send('one');
    await expect(session.send('two')).rejects.toThrow(/already running/);
    release();
    await first;
  });

  it('resumeSession exposes the thread id immediately', async () => {
    const adapter = adapterWith([fakeThread([])]);
    const session = await adapter.resumeSession('abc-123', { cwd: '/tmp/x' });
    expect(session.sessionId).toBe('abc-123');
  });
});
