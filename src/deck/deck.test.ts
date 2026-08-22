import { describe, expect, it } from 'vitest';
import { DeckController, type DeckDriver } from './controller.js';
import type { AgentSlotSnapshot } from '../core/types.js';
import { SLOT_KEYS, layoutActions, stateColor } from './layout.js';
import { renderActionKey, renderSlotKey } from './renderer.js';

class FakeDeck implements DeckDriver {
  NUM_KEYS = 15;
  MODEL = 'original-mk2';
  downs: number[] = [];
  fills = new Map<number, number>(); // keyIndex → fill count
  listeners = new Map<string, ((arg: unknown) => void)[]>();

  fillColor(keyIndex: number): void {
    this.fills.set(keyIndex, (this.fills.get(keyIndex) ?? 0) + 1);
  }

  fillImage(keyIndex: number): void {
    this.fills.set(keyIndex, (this.fills.get(keyIndex) ?? 0) + 1);
  }

  clearKey(): void {}

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
  it('maps 15 keys: slots, stop/attach/select, do-it pinned, workflows fill the rest', () => {
    const actions = layoutActions([{ id: 'do-it', name: 'DO IT' }, ...workflows]);
    expect(actions.size).toBe(12); // 6 slots + stop/attach/select + do-it + 2 workflows
    expect(actions.get(0)).toEqual({ kind: 'slot', index: 0 });
    expect(actions.get(5)).toEqual({ kind: 'slot', index: 5 });
    expect(actions.get(6)).toEqual({ kind: 'workflow', id: 'do-it' });
    expect(actions.get(7)).toEqual({ kind: 'stop' });
    expect(actions.get(8)).toEqual({ kind: 'attach' });
    expect(actions.get(14)).toEqual({ kind: 'select' });
    expect(actions.get(10)).toEqual({ kind: 'workflow', id: 'review-pr' });
    expect(actions.get(11)).toEqual({ kind: 'workflow', id: 'debug' });
  });

  it('without a do-it workflow its key stays unassigned', () => {
    const actions = layoutActions(workflows);
    expect(actions.get(6)).toBeUndefined();
    expect(actions.get(10)).toEqual({ kind: 'workflow', id: 'review-pr' });
    expect(actions.get(14)).toEqual({ kind: 'select' });
  });

  it('state colors are distinct and pulse dims', () => {
    const idle = stateColor('idle');
    const think = stateColor('thinking', 1);
    const thinkDim = stateColor('thinking', 0);
    expect(think).not.toEqual(thinkDim);
    expect(idle).not.toEqual(think);
  });
});

describe('renderer', () => {
  it('produces a 72×72 RGBA buffer', () => {
    const buf = renderSlotKey(slot(0, 'idle'), true);
    expect(buf.length).toBe(72 * 72 * 4);
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
      Array.from({ length: 6 }, (_, i) => slot(i, i === 0 ? 'running' : 'idle')),
      0,
    );
    for (const key of SLOT_KEYS) expect(deck.fills.get(key)).toBeGreaterThan(0);
    expect(deck.fills.get(7)).toBeGreaterThan(0); // STOP
    expect(deck.fills.get(8)).toBeGreaterThan(0); // ATTACH
    expect(deck.fills.get(14)).toBeGreaterThan(0); // SEL
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
    deck.press(14);
    deck.press(13); // unmapped with only 2 workflows
    expect(actions).toEqual([
      { kind: 'slot', index: 0 },
      { kind: 'stop' },
      { kind: 'attach' },
      { kind: 'workflow', id: 'review-pr' },
      { kind: 'select' },
    ]);
  });

  it('updateSlot repaints only that key', () => {
    const deck = new FakeDeck();
    const c = new DeckController(deck, workflows);
    c.render(Array.from({ length: 6 }, (_, i) => slot(i, 'idle')), 0);
    deck.fills.clear();
    c.updateSlot(slot(3, 'done'));
    expect([...deck.fills.keys()]).toEqual([3]);
  });
});
