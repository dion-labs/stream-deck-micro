import { describe, expect, it, vi } from 'vitest';
import { SlotManager } from './slotManager.js';
import type { AgentSession, HarnessAdapter, SessionEvent } from './types.js';

class FakeSession implements AgentSession {
  sessionId: string | null;
  name: string | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private abort: AbortController | null = null;
  interruptMock = vi.fn();

  constructor(id: string | null, public promptLog: string[] = []) {
    this.sessionId = id;
  }

  get sessionId_(): string | null {
    return this.sessionId;
  }

  emit(e: SessionEvent) {
    for (const l of this.listeners) l(e);
  }

  async send(prompt: string, signal?: AbortSignal): Promise<void> {
    this.promptLog.push(prompt);
    if (signal) {
      this.abort = new AbortController();
      signal.addEventListener('abort', () => this.abort?.abort());
      // Emulate: turn runs until aborted externally, then fails with abort error.
      return new Promise<void>((resolve, reject) => {
        const done = () => resolve();
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        this.pendingResolve = done;
      });
    }
    return Promise.resolve();
  }

  private pendingResolve: (() => void) | null = null;

  finish() {
    this.pendingResolve?.();
  }

  interrupt(): void {
    this.interruptMock();
    this.abort?.abort();
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

function makeAdapter() {
  const created: FakeSession[] = [];
  const adapter: HarnessAdapter = {
    name: 'fake',
    listSessions: async () => [],
    createSession: async () => {
      const s = new FakeSession(null);
      created.push(s);
      return s;
    },
    resumeSession: async (id) => new FakeSession(id),
  };
  return { adapter, created };
}

function manager(adapter: HarnessAdapter) {
  return new SlotManager(adapter, {
    slotCount: 6,
    defaultCwd: '/tmp/proj',
    transientMs: 10,
    attachmentFeedbackMs: 10,
  });
}

describe('SlotManager', () => {
  it('starts with all slots empty', () => {
    const m = manager(makeAdapter().adapter);
    expect(m.snapshots().map((s) => s.state)).toEqual(Array(6).fill('empty'));
  });

  it('createSession binds first empty slot and emits idle', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    const events: string[] = [];
    m.on('slot', (s) => events.push(`${s.index}:${s.state}`));
    const idx = await m.createSession();
    expect(idx).toBe(0);
    expect(m.snapshot(0).state).toBe('idle');
    expect(events).toContain('0:idle');
    expect(created).toHaveLength(1);
  });

  it('returns -1 when all slots are full', async () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    for (let i = 0; i < 6; i++) await m.createSession();
    expect(await m.createSession()).toBe(-1);
  });

  it('maps session events through the state machine', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    const session = created[0];

    session.emit({ type: 'turn-started' });
    expect(m.snapshot(0).state).toBe('thinking');

    session.emit({ type: 'tool-started', tool: 'shell', detail: 'npm test' });
    expect(m.snapshot(0).state).toBe('running');
    expect(m.snapshot(0).detail).toBe('npm test');

    session.emit({ type: 'file-change', files: ['a.ts', 'b.ts', 'c.ts'] });
    expect(m.snapshot(0).detail).toBe('patch: a.ts, b.ts…');

    session.emit({ type: 'turn-completed' });
    expect(m.snapshot(0).state).toBe('done');
    await new Promise((r) => setTimeout(r, 30));
    expect(m.snapshot(0).state).toBe('idle');
  });

  it('error state shows detail and decays', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    created[0].emit({ type: 'turn-started' });
    created[0].emit({ type: 'turn-failed', error: 'kaboom' });
    expect(m.snapshot(0).state).toBe('error');
    expect(m.snapshot(0).detail).toBe('kaboom');
    await new Promise((r) => setTimeout(r, 30));
    expect(m.snapshot(0).state).toBe('idle');
  });

  it('selectNext cycles through occupied slots', async () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    await m.createSession(); // slot 0
    await m.createSession(); // slot 1
    await m.createSession(); // slot 2
    m.select(2);
    m.selectNext();
    expect(m.selectedIndex).toBe(0);
    m.selectNext();
    expect(m.selectedIndex).toBe(1);
  });

  it('send goes to the selected slot', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    await m.createSession();
    m.select(1);
    await m.sendSelected('hello');
    expect(created[0].promptLog).toEqual([]);
    expect(created[1].promptLog).toEqual(['hello']);
  });

  it('interrupt calls through to the session', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    m.interrupt(0);
    expect(created[0].interruptMock).toHaveBeenCalled();
  });

  it('clear resets a slot to empty and frees it', async () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    m.rename(0, 'Old custom label');
    m.clear(0);
    expect(m.snapshot(0).state).toBe('empty');
    expect(m.snapshot(0).label).toBe('1');
    expect(m.snapshot(0).customLabel).toBeNull();
    expect(await m.createSession()).toBe(0);
  });

  it('drops binding-specific metadata when a different session replaces a slot', () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    const first = new FakeSession('first');
    first.name = 'First session';
    const replacement = new FakeSession('replacement');
    replacement.name = 'Replacement session';

    m.attachSession(0, first);
    m.rename(0, 'Old custom label');
    first.emit({ type: 'agent-message', text: 'old session response' });
    m.attachSession(0, replacement);

    expect(m.snapshot(0)).toMatchObject({
      sessionId: 'replacement',
      label: 'Replacement session',
      customLabel: null,
      lastMessage: null,
    });
  });

  it('keeps a custom label when reconnecting the same session', () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    m.attachSession(0, new FakeSession('same'));
    m.rename(0, 'Pinned label');

    m.attachSession(0, new FakeSession('same'));

    expect(m.snapshot(0).customLabel).toBe('Pinned label');
    expect(m.snapshot(0).label).toBe('Pinned label');
  });

  it('resumeSession binds by id', async () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    await m.resumeSession(3, 'abc-123');
    expect(m.snapshot(3).state).toBe('idle');
    expect(m.snapshot(3).sessionId).toBe('abc-123');
  });

  it('emits a transient attachment confirmation without changing agent state', async () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    await m.resumeSession(1, 'replacement');

    m.confirmAttachment(1);

    expect(m.snapshot(1).state).toBe('idle');
    expect(m.snapshot(1).detail).toBe('session attached');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(m.snapshot(1).state).toBe('idle');
    expect(m.snapshot(1).detail).toBe('');
  });

  it('rejects duplicate session ids before resuming a second copy', async () => {
    const { adapter } = makeAdapter();
    const resume = vi.spyOn(adapter, 'resumeSession');
    const m = manager(adapter);
    await m.resumeSession(0, 'abc-123');
    await expect(m.resumeSession(1, 'abc-123')).rejects.toThrow(
      'already attached to slot 1',
    );
    expect(resume).toHaveBeenCalledTimes(1);
    expect(m.snapshot(1).state).toBe('empty');
  });

  it('rejects duplicate directly attached sessions without replacing the target', () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    const first = new FakeSession('abc-123');
    const duplicate = new FakeSession('abc-123');
    m.attachSession(0, first);
    expect(() => m.attachSession(1, duplicate)).toThrow('already attached to slot 1');
    expect(m.snapshot(0).sessionId).toBe('abc-123');
    expect(m.snapshot(1).state).toBe('empty');
  });

  it('a rejected send drives the state machine to error instead of sticking', async () => {
    const { adapter } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    const failing: AgentSession = {
      sessionId: 'x',
      name: null,
      send: () => Promise.reject(new Error('The operation was aborted')),
      interrupt: () => {},
      onEvent: () => () => {},
      dispose: () => {},
    };
    // bind failing session into slot 1 directly via resumeSession alternative:
    // reuse createSession path by swapping adapter behavior
    const m2 = new SlotManager(
      { ...adapter, createSession: async () => failing },
      { slotCount: 6, defaultCwd: '/tmp', transientMs: 10 },
    );
    await m2.createSession();
    await expect(m2.send(0, 'go')).rejects.toThrow('aborted');
    expect(m2.snapshot(0).state).toBe('error');
    await new Promise((r) => setTimeout(r, 30));
    expect(m2.snapshot(0).state).toBe('idle');
  });

  it('rename sets a custom label that overrides session names and can be cleared', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    created[0].name = 'Model Title';
    created[0].emit({ type: 'turn-completed' });
    expect(m.snapshot(0).label).toBe('Model Title');

    m.rename(0, 'My Custom Name');
    expect(m.snapshot(0).label).toBe('My Custom Name');
    expect(m.snapshot(0).customLabel).toBe('My Custom Name');
    created[0].emit({ type: 'turn-completed' }); // name refresh doesn't override
    expect(m.snapshot(0).label).toBe('My Custom Name');

    m.rename(0, null);
    expect(m.snapshot(0).label).toBe('Model Title');
    expect(m.snapshot(0).customLabel).toBeNull();
  });

  it('label falls back to session name once provided', async () => {
    const { adapter, created } = makeAdapter();
    const m = manager(adapter);
    await m.createSession();
    expect(m.snapshot(0).label).toBe('1');
    created[0].name = 'Fix the build';
    created[0].emit({ type: 'turn-completed' });
    expect(m.snapshot(0).label).toBe('Fix the build');
  });
});
