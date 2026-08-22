import { EventEmitter } from 'node:events';
import { decayState, nextState } from './stateMachine.js';
import type {
  AgentSession,
  AgentSlotSnapshot,
  HarnessAdapter,
  SessionEvent,
} from './types.js';

export interface SlotManagerEvents {
  /** A slot's snapshot changed (state, label, session binding). */
  slot: (snapshot: AgentSlotSnapshot) => void;
  /** The selected slot (workflow/prompt target) changed. */
  select: (index: number) => void;
}

interface Slot {
  index: number;
  state: AgentSlotSnapshot['state'];
  session: AgentSession | null;
  label: string;
  /** User-set label (admin UI); overrides session names when set. */
  customLabel: string | null;
  cwd: string;
  detail: string;
  lastMessage: string | null;
  updatedAt: number;
  unsubscribe: (() => void) | null;
  decayTimer: NodeJS.Timeout | null;
}

export interface SlotManagerOptions {
  slotCount: number;
  defaultCwd: string;
  /** ms a done/error state stays lit before decaying to idle. */
  transientMs?: number;
}

/**
 * Owns the N agent slots, feeds harness events through the state machine, and
 * emits render-ready snapshots. Knows nothing about decks or specific harnesses.
 */
export class SlotManager {
  readonly slotCount: number;
  private readonly slots: Slot[] = [];
  private readonly transientMs: number;
  private selectedIndex_ = 0;
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly adapter: HarnessAdapter,
    opts: SlotManagerOptions,
  ) {
    this.slotCount = opts.slotCount;
    this.transientMs = opts.transientMs ?? 2500;
    for (let i = 0; i < opts.slotCount; i++) {
      this.slots.push({
        index: i,
        state: 'empty',
        session: null,
        label: `${i + 1}`,
        customLabel: null,
        cwd: opts.defaultCwd,
        detail: '',
        lastMessage: null,
        updatedAt: Date.now(),
        unsubscribe: null,
        decayTimer: null,
      });
    }
  }

  on<K extends keyof SlotManagerEvents>(event: K, listener: SlotManagerEvents[K]): void {
    this.emitter.on(event, listener);
  }

  get selectedIndex(): number {
    return this.selectedIndex_;
  }

  select(index: number): void {
    if (index < 0 || index >= this.slotCount || index === this.selectedIndex_) return;
    this.selectedIndex_ = index;
    this.emitter.emit('select', index);
    this.emitSlot(index);
  }

  /** Cycle selection to the next non-empty slot (wraps), for a SELECT key. */
  selectNext(): void {
    const start = this.selectedIndex_;
    for (let step = 1; step <= this.slotCount; step++) {
      const candidate = (start + step) % this.slotCount;
      if (this.slots[candidate].session) {
        this.select(candidate);
        return;
      }
    }
  }

  snapshots(): AgentSlotSnapshot[] {
    return this.slots.map((s) => this.snapshotOf(s));
  }

  snapshot(index: number): AgentSlotSnapshot {
    return this.snapshotOf(this.slots[index]);
  }

  /** Bind a fresh session to the first empty slot (or a given one). Returns the slot index or -1. */
  async createSession(cwd?: string, index?: number): Promise<number> {
    const target = index ?? this.slots.findIndex((s) => !s.session);
    if (target === -1 || this.slots[target]?.session) return -1;
    const session = await this.adapter.createSession({ cwd: cwd ?? this.slots[target].cwd });
    this.bind(target, session, cwd);
    return target;
  }

  async resumeSession(
    slotIndex: number,
    sessionId: string,
    cwd?: string,
    label?: string,
  ): Promise<void> {
    const slot = this.slots[slotIndex];
    if (!slot) return;
    const session = await this.adapter.resumeSession(sessionId, {
      cwd: cwd ?? slot.cwd,
    });
    this.bind(slotIndex, session, cwd);
    if (label) slot.label = label;
    this.emitSlot(slotIndex);
  }

  /** Set or clear (null/empty) a user label; it overrides the session name on the key. */
  rename(slotIndex: number, label: string | null): void {
    const slot = this.slots[slotIndex];
    if (!slot?.session) return;
    const trimmed = label?.trim();
    slot.customLabel = trimmed ? trimmed : null;
    this.emitSlot(slotIndex);
  }

  /** Bind an already-constructed session (used for monitor-only external threads). */
  attachSession(slotIndex: number, session: AgentSession, label?: string): void {
    this.bind(slotIndex, session);
    if (label) {
      this.slots[slotIndex].label = label;
      this.emitSlot(slotIndex);
    }
  }

  private bind(index: number, session: AgentSession, cwd?: string): void {
    const slot = this.slots[index];
    this.detach(index);
    slot.session = session;
    if (cwd) slot.cwd = cwd;
    slot.state = 'idle';
    slot.detail = '';
    slot.unsubscribe = session.onEvent((event) => this.onSessionEvent(index, event));
    if (session.name) slot.label = session.name;
    this.emitSlot(index);
  }

  private detach(index: number): void {
    const slot = this.slots[index];
    slot.unsubscribe?.();
    slot.unsubscribe = null;
    slot.session?.dispose();
    slot.session = null;
    this.clearDecay(index);
  }

  /** Send a prompt to a slot; resolves when its turn completes. */
  async send(slotIndex: number, prompt: string): Promise<void> {
    const slot = this.slots[slotIndex];
    if (!slot?.session) throw new Error(`slot ${slotIndex} has no session`);
    if (slot.label === String(slotIndex + 1)) slot.label = labelFromPrompt(prompt);
    try {
      return await slot.session.send(prompt);
    } catch (e) {
      // aborted turns and stream errors never emit a terminal event; drive the
      // state machine ourselves so the key can't stick on thinking/running
      this.onSessionEvent(slotIndex, {
        type: 'turn-failed',
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /** Send to the selected slot — the path used by workflow keys and the sdm CLI. */
  sendSelected(prompt: string): Promise<void> {
    return this.send(this.selectedIndex_, prompt);
  }

  interrupt(slotIndex?: number): void {
    const index = slotIndex ?? this.selectedIndex_;
    this.slots[index]?.session?.interrupt();
  }

  /** Clear a slot back to empty (unbind session). */
  clear(slotIndex: number): void {
    this.slots[slotIndex].state = 'empty';
    this.slots[slotIndex].label = `${slotIndex + 1}`;
    this.slots[slotIndex].detail = '';
    this.detach(slotIndex);
    this.emitSlot(slotIndex);
  }

  private onSessionEvent(index: number, event: SessionEvent): void {
    const slot = this.slots[index];
    const next = nextState(slot.state, event);
    this.clearDecay(index);
    if (event.type === 'tool-started') {
      slot.detail = event.detail ?? event.tool;
    } else if (event.type === 'reasoning') {
      slot.detail = 'thinking';
    } else if (event.type === 'file-change') {
      slot.detail = `patch: ${event.files.slice(0, 2).join(', ')}${event.files.length > 2 ? '…' : ''}`;
    } else if (event.type === 'turn-completed') {
      slot.detail = 'turn completed';
    } else if (event.type === 'turn-failed') {
      slot.detail = event.error.slice(0, 120);
    } else if (event.type === 'agent-message' && event.text.trim()) {
      slot.lastMessage = event.text;
    }
    slot.state = next;
    slot.updatedAt = Date.now();
    if (next === 'done' || next === 'error') {
      slot.decayTimer = setTimeout(() => {
        slot.state = decayState(slot.state);
        slot.updatedAt = Date.now();
        this.emitSlot(index);
      }, this.transientMs);
      slot.decayTimer.unref?.();
    }
    this.emitSlot(index);
  }

  private clearDecay(index: number): void {
    const slot = this.slots[index];
    if (slot.decayTimer) {
      clearTimeout(slot.decayTimer);
      slot.decayTimer = null;
    }
  }

  private snapshotOf(slot: Slot): AgentSlotSnapshot {
    return {
      index: slot.index,
      state: slot.state,
      sessionId: slot.session?.sessionId ?? null,
      label: slot.customLabel ?? slot.session?.name ?? slot.label,
      customLabel: slot.customLabel,
      cwd: slot.cwd,
      detail: slot.detail,
      lastMessage: slot.lastMessage,
      updatedAt: slot.updatedAt,
    };
  }

  private emitSlot(index: number): void {
    this.emitter.emit('slot', this.snapshot(index));
  }

  dispose(): void {
    for (let i = 0; i < this.slots.length; i++) this.detach(i);
    this.emitter.removeAllListeners();
  }
}

/** First prompt becomes the slot's label until a real thread name arrives. */
function labelFromPrompt(prompt: string): string {
  const squeezed = prompt.replace(/\s+/g, ' ').trim();
  return squeezed.length > 28 ? `${squeezed.slice(0, 28)}…` : squeezed;
}
