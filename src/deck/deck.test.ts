import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckController, type DeckDriver } from './controller.js';
import type { AgentSlotSnapshot } from '../core/types.js';
import { ATTENTION_COLORS, SLOT_KEYS, attentionColor, layoutActions, stateColor } from './layout.js';
import { renderActionKey, renderSlotKey } from './renderer.js';

class FakeDeck implements DeckDriver {
  NUM_KEYS = 15;
  MODEL = 'original-mk2';
  downs: number[] = [];
  fills = new Map<number, number>(); // keyIndex → fill count
  brightness: number[] = [];
  clearAllCount = 0;
  listeners = new Map<string, ((arg: unknown) => void)[]>();

  fillColor(keyIndex: number): void {
    this.fills.set(keyIndex, (this.fills.get(keyIndex) ?? 0) + 1);
  }

  fillImage(keyIndex: number): void {
    this.fills.set(keyIndex, (this.fills.get(keyIndex) ?? 0) + 1);
  }

  clearKey(): void {}

  clearAllKeys(): void {
    this.clearAllCount += 1;
    this.fills.clear();
  }

  setBrightness(percentage: number): void {
    this.brightness.push(percentage);
  }

  on(event: 'down' | 'up', listener: (keyIndex: number) => void): unknown;
  on(event: 'error', listener: (e: unknown) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: any, listener: any): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (arg: unknown) => void);
    this.listeners.set(event, list);
    return this;
  }

  press(keyIndex: number): void {
    this.downs.push(keyIndex);
    for (const l of this.listeners.get('down') ?? []) l(keyIndex);
  }
  close(): void {}
}

const workflows = [
  { id: 'review-pr', name: 'REVIEW PR' },
  { id: 'debug', name: 'DEBUG' },
];

const sleepSettings = {
  brightness: 70,
  autoSleep: { enabled: true, timeoutMinutes: 1 },
  sleepKey: 'sleep' as const,
};

afterEach(() => {
  vi.useRealTimers();
});

function slot(index: number, state: AgentSlotSnapshot['state']): AgentSlotSnapshot {
  return {
    index,
    state,
    sessionId: state === 'empty' ? null : `s${index}`,
    label: state === 'empty' ? `${index + 1}` : `Slot ${index + 1}`,
    customLabel: null,
    cwd: '/tmp/p',
    detail: '',
    lastMessage: null,
    updatedAt: Date.now(),
  };
}

describe('layout', () => {
  it('maps 15 keys: seven slots, stop/sleep, do-it pinned, workflows fill the rest', () => {
    const actions = layoutActions([{ id: 'do-it', name: 'DO IT' }, ...workflows]);
    expect(actions.size).toBe(12); // 7 slots + stop/sleep + do-it + 2 workflows
    expect(actions.get(0)).toEqual({ kind: 'slot', index: 0 });
    expect(actions.get(5)).toEqual({ kind: 'slot', index: 5 });
    expect(actions.get(8)).toEqual({ kind: 'slot', index: 6 });
    expect(actions.get(14)).toEqual({ kind: 'workflow', id: 'do-it' });
    expect(actions.get(7)).toEqual({ kind: 'stop' });
    expect(actions.get(13)).toEqual({ kind: 'sleep' });
    expect(actions.get(10)).toEqual({ kind: 'workflow', id: 'review-pr' });
    expect(actions.get(11)).toEqual({ kind: 'workflow', id: 'debug' });
  });

  it('without a do-it workflow its key stays unassigned', () => {
    const actions = layoutActions(workflows);
    expect(actions.get(14)).toBeUndefined();
    expect(actions.get(10)).toEqual({ kind: 'workflow', id: 'review-pr' });
    expect(actions.get(13)).toEqual({ kind: 'sleep' });
  });

  it('keeps five workflow keys when do-it and sleep occupy the bottom-right pair', () => {
    const actions = layoutActions([
      { id: 'do-it', name: 'DO IT' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `wf-${i + 1}`, name: `WF ${i + 1}` })),
    ]);
    expect(actions.get(10)).toEqual({ kind: 'workflow', id: 'wf-1' });
    expect(actions.get(11)).toEqual({ kind: 'workflow', id: 'wf-2' });
    expect(actions.get(12)).toEqual({ kind: 'workflow', id: 'wf-3' });
    expect(actions.get(9)).toEqual({ kind: 'workflow', id: 'wf-4' });
    expect(actions.get(6)).toEqual({ kind: 'workflow', id: 'wf-5' });
    expect(actions.get(13)).toEqual({ kind: 'sleep' });
    expect(actions.get(14)).toEqual({ kind: 'workflow', id: 'do-it' });
  });

  it('uses a custom layout and ignores workflows that no longer exist', () => {
    const actions = layoutActions(workflows, [
      { keyIndex: 4, action: { kind: 'stop' } },
      { keyIndex: 14, action: { kind: 'slot', index: 0 } },
      { keyIndex: 13, action: { kind: 'slot', index: 14 } },
      { keyIndex: 0, action: { kind: 'workflow', id: 'debug' } },
      { keyIndex: 1, action: { kind: 'workflow', id: 'removed' } },
    ]);
    expect([...actions]).toEqual([
      [4, { kind: 'stop' }],
      [14, { kind: 'slot', index: 0 }],
      [13, { kind: 'slot', index: 14 }],
      [0, { kind: 'workflow', id: 'debug' }],
    ]);
  });

  it('state colors are distinct and pulse dims', () => {
    const idle = stateColor('idle');
    const think = stateColor('thinking', 1);
    const thinkDim = stateColor('thinking', 0);
    expect(think).not.toEqual(thinkDim);
    expect(idle).not.toEqual(think);
  });

  it('uses a dedicated yellow attention beacon instead of result colors', () => {
    expect(attentionColor(0)).toEqual(ATTENTION_COLORS.dim);
    expect(attentionColor(1)).toEqual(ATTENTION_COLORS.bright);
    expect(attentionColor(1)).not.toEqual(stateColor('done'));
    expect(attentionColor(1)).not.toEqual(stateColor('error'));
  });
});

describe('renderer', () => {
  it('produces a 72×72 RGBA buffer', () => {
    const buf = renderSlotKey(slot(0, 'idle'), true);
    expect(buf.length).toBe(72 * 72 * 4);
  });

  it('renders attachment confirmation differently from ordinary idle', () => {
    const idle = slot(0, 'idle');
    const attached = { ...idle, detail: 'session attached' };
    expect(renderSlotKey(attached, true)).not.toEqual(renderSlotKey(idle, true));
  });

  it('renders done and error attention with the same dedicated beacon background', () => {
    const done = renderSlotKey(slot(0, 'done'), false, 72, 1, 'done');
    const error = renderSlotKey(slot(0, 'error'), false, 72, 1, 'error');
    expect([...done.subarray(0, 3)]).toEqual(ATTENTION_COLORS.bright);
    expect([...error.subarray(0, 3)]).toEqual(ATTENTION_COLORS.bright);
    expect(done).not.toEqual(error);
  });

  it('action key buffers are valid too', () => {
    expect(renderActionKey('NEW', [1, 2, 3], 'x').length).toBe(72 * 72 * 4);
  });
});

describe('DeckController', () => {
  it('renders all slot keys and static keys', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows);
    c.render(
      Array.from({ length: 7 }, (_, i) => slot(i, i === 0 ? 'running' : 'idle')),
      0,
    );
    for (const key of SLOT_KEYS) expect(deck.fills.get(key)).toBeGreaterThan(0);
    expect(deck.fills.get(7)).toBeGreaterThan(0); // STOP
    expect(deck.fills.get(8)).toBeGreaterThan(0); // slot 7
    expect(deck.fills.get(13)).toBeGreaterThan(0); // SLEEP
    expect(deck.fills.get(10)).toBeGreaterThan(0); // workflow 1
  });

  it('emits semantic actions for key presses', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows);
    const actions: unknown[] = [];
    c.on('action', (a) => actions.push(a));
    deck.press(0);
    deck.press(7);
    deck.press(8);
    deck.press(10);
    deck.press(13);
    deck.press(14); // unmapped without a do-it workflow
    expect(actions).toEqual([
      { kind: 'slot', index: 0 },
      { kind: 'stop' },
      { kind: 'slot', index: 6 },
      { kind: 'workflow', id: 'review-pr' },
      { kind: 'sleep' },
    ]);
  });

  it('renders and executes actions from a custom key map', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings, [
      { keyIndex: 14, action: { kind: 'slot', index: 0 } },
      { keyIndex: 0, action: { kind: 'stop' } },
      { keyIndex: 4, action: { kind: 'workflow', id: 'debug' } },
    ]);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, 'idle')), 0);
    expect([...deck.fills.keys()].sort((a, b) => a - b)).toEqual([0, 4, 14]);
    const actions: unknown[] = [];
    c.on('action', (action) => actions.push(action));
    deck.press(14);
    deck.press(0);
    deck.press(4);
    expect(actions).toEqual([
      { kind: 'slot', index: 0 },
      { kind: 'stop' },
      { kind: 'workflow', id: 'debug' },
    ]);
    c.close();
  });

  it('updateSlot repaints only that key', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, 'idle')), 0);
    deck.fills.clear();
    c.updateSlot(slot(3, 'done'));
    expect([...deck.fills.keys()]).toEqual([3]);
  });

  it('manual sleep uses brightness zero and the first key press only wakes', () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, 'idle')), 0);
    const actions: unknown[] = [];
    c.on('action', (action) => actions.push(action));

    deck.press(13);
    expect(actions).toEqual([{ kind: 'sleep' }]);
    c.sleep();
    expect(c.status().mode).toBe('asleep');
    expect(deck.brightness.at(-1)).toBe(0);

    deck.press(0);
    expect(c.status().mode).toBe('awake');
    expect(deck.brightness.at(-1)).toBe(70);
    expect(actions).toEqual([{ kind: 'sleep' }]);

    deck.press(0);
    expect(actions.at(-1)).toEqual({ kind: 'slot', index: 0 });
    c.close();
  });

  it('keeps a completed slot visible alone after the auto-sleep timeout', () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, i === 2 ? 'running' : 'idle')), 0);
    c.updateSlot(slot(2, 'done'));

    expect(c.status().attention).toEqual([{ index: 2, state: 'done', sessionId: 's2' }]);
    vi.advanceTimersByTime(60_000);

    expect(c.status().mode).toBe('attention');
    expect(deck.clearAllCount).toBeGreaterThan(0);
    expect([...deck.fills.keys()]).toEqual([2]);
    c.close();
  });

  it('acknowledges an attention slot and still performs its normal slot action', () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, i === 1 ? 'running' : 'idle')), 0);
    c.updateSlot(slot(1, 'done'));
    vi.advanceTimersByTime(60_000);
    const actions: unknown[] = [];
    c.on('action', (action) => actions.push(action));

    deck.press(1);

    expect(c.status().mode).toBe('awake');
    expect(c.status().attention).toEqual([]);
    expect(actions).toEqual([{ kind: 'slot', index: 1 }]);
    c.close();
  });

  it('treats a new turn as acknowledgement of the previous completion', () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, i === 3 ? 'running' : 'idle')), 0);
    c.updateSlot(slot(3, 'done'));
    expect(c.status().attention).toHaveLength(1);

    c.updateSlot(slot(3, 'thinking'));

    expect(c.status().attention).toEqual([]);
    c.close();
  });

  it('offers shared retry and fail-safe private recovery while every normal key is inert', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, 'idle')), 0);
    const restarts: string[] = [];
    const recoveries: string[] = [];
    const actions: unknown[] = [];
    c.on('restartCodex', () => restarts.push('restart'));
    c.on('recoverCodex', () => recoveries.push('private'));
    c.on('action', (action) => actions.push(action));

    c.setDesktopRecovery('restart-required');
    expect(c.status().desktopRecovery).toBe('restart-required');
    expect([...deck.fills.keys()]).toEqual([6, 7]);

    deck.press(0);
    deck.press(6);
    deck.press(7);
    expect(restarts).toEqual(['restart']);
    expect(recoveries).toEqual(['private']);
    expect(actions).toEqual([]);

    c.setDesktopRecovery('restarting');
    deck.press(6);
    deck.press(7);
    expect(restarts).toEqual(['restart']);
    expect(recoveries).toEqual(['private']);

    c.setDesktopRecovery(null);
    expect(c.status().desktopRecovery).toBeNull();
    expect(deck.fills.size).toBeGreaterThan(1);
    c.close();
  });

  it('turns an unverified Desktop build into an explicit verify action', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    const restarts: string[] = [];
    const recoveries: string[] = [];
    c.on('restartCodex', () => restarts.push('verify'));
    c.on('recoverCodex', () => recoveries.push('private'));

    c.setDesktopRecovery('verification-required');
    expect([...deck.fills.keys()]).toEqual([6, 7]);
    deck.press(6);
    deck.press(7);
    expect(restarts).toEqual(['verify']);
    expect(recoveries).toEqual(['private']);

    c.setDesktopRecovery('verifying');
    deck.press(6);
    deck.press(7);
    expect(restarts).toEqual(['verify']);
    expect(recoveries).toEqual(['private']);
    c.close();
  });

  it('does not auto-sleep while a turn is active', () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, i === 0 ? 'thinking' : 'idle')), 0);

    vi.advanceTimersByTime(10 * 60_000);

    expect(c.status().mode).toBe('awake');
    c.close();
  });

  it('shows only UPDATE CODEX and blocks all normal/repeated actions during an update', () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, 'idle')), 2);
    const recoveries: string[] = [];
    const actions: unknown[] = [];
    c.on('restartCodex', () => { recoveries.push('update'); c.setDesktopRecovery('updating'); });
    c.on('action', (action) => actions.push(action));
    c.setDesktopRecovery('update-required');
    vi.advanceTimersByTime(20 * 60_000);
    expect(c.status().mode).toBe('awake');
    expect([...deck.fills.keys()]).toEqual([6, 7]);
    for (let key = 0; key < 15; key += 1) if (key !== 6 && key !== 7) deck.press(key);
    expect(actions).toEqual([]);
    expect(recoveries).toEqual([]);
    deck.press(6);
    deck.press(6);
    expect(recoveries).toEqual(['update']);
    expect(c.status().desktopRecovery).toBe('updating');
    expect([...deck.fills.keys()]).toEqual([7]);
    c.setDesktopRecovery('update-required');
    deck.press(6);
    expect(recoveries).toEqual(['update', 'update']);
    c.setDesktopRecovery(null);
    expect(deck.fills.size).toBeGreaterThan(1);
    c.close();
  });

  it('shows private recovery progress and completion as inert central states', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows, sleepSettings);
    const recoveries: string[] = [];
    c.on('recoverCodex', () => recoveries.push('private'));
    c.setDesktopRecovery('shared-error');
    expect([...deck.fills.keys()]).toEqual([7]);
    deck.press(7);
    expect(recoveries).toEqual(['private']);
    c.setDesktopRecovery('recovering-private');
    deck.press(7);
    expect(recoveries).toEqual(['private']);
    c.setDesktopRecovery('private-ready');
    deck.press(7);
    expect(recoveries).toEqual(['private']);
    c.close();
  });
});
