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
  feedbackTimer: NodeJS.Timeout | null;
}

export interface SlotManagerOptions {
  slotCount: number;
  defaultCwd: string;
  /** ms a done/error state stays lit before decaying to idle. */
  transientMs?: number;
  /** ms an explicit attachment confirmation stays visible on every surface. */
  attachmentFeedbackMs?: number;
}

/**
 * Owns the N agent slots, feeds harness events through the state machine, and
 * emits render-ready snapshots. Knows nothing about decks or specific harnesses.
 */
export class SlotManager {
  readonly slotCount: number;
  private readonly slots: Slot[] = [];
  private readonly transientMs: number;
  private readonly attachmentFeedbackMs: number;
  private selectedIndex_ = 0;
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly adapter: HarnessAdapter,
    opts: SlotManagerOptions,
  ) {
    this.slotCount = opts.slotCount;
    this.transientMs = opts.transientMs ?? 2500;
    this.attachmentFeedbackMs = opts.attachmentFeedbackMs ?? 4000;
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
        feedbackTimer: null,
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
    this.assertSessionAvailable(slotIndex, sessionId);
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

  /** Show an explicit, non-terminal acknowledgement after an admin attachment. */
  confirmAttachment(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    if (!slot?.session) return;
    this.clearFeedback(slotIndex);
    slot.detail = 'session attached';
    slot.updatedAt = Date.now();
    this.emitSlot(slotIndex);
    slot.feedbackTimer = setTimeout(() => {
      slot.feedbackTimer = null;
      if (slot.detail !== 'session attached') return;
      slot.detail = '';
      slot.updatedAt = Date.now();
      this.emitSlot(slotIndex);
    }, this.attachmentFeedbackMs);
    slot.feedbackTimer.unref?.();
  }

  private bind(index: number, session: AgentSession, cwd?: string): void {
    const slot = this.slots[index];
    const previousSessionId = slot.session?.sessionId ?? null;
    if (session.sessionId) {
      try {
        this.assertSessionAvailable(index, session.sessionId);
      } catch (error) {
        session.dispose();
        throw error;
      }
    }
    this.detach(index);
    if (previousSessionId !== null && previousSessionId !== session.sessionId) {
      this.resetBindingMetadata(slot);
    }
    slot.session = session;
    if (cwd) slot.cwd = cwd;
    slot.state = 'idle';
    slot.detail = '';
    slot.unsubscribe = session.onEvent((event) => this.onSessionEvent(index, event));
    if (session.name) slot.label = session.name;
    this.emitSlot(index);
  }

  private assertSessionAvailable(targetIndex: number, sessionId: string): void {
    const existing = this.slots.find(
      (slot) => slot.index !== targetIndex && slot.session?.sessionId === sessionId,
    );
    if (existing) {
      throw new Error(`session ${sessionId} is already attached to slot ${existing.index + 1}`);
    }
  }

  private detach(index: number): void {
    const slot = this.slots[index];
    slot.unsubscribe?.();
    slot.unsubscribe = null;
    slot.session?.dispose();
    slot.session = null;
    this.clearDecay(index);
    this.clearFeedback(index);
  }

  /** Send a prompt to a slot; resolves when its turn completes. */
  async send(slotIndex: number, prompt: string): Promise<void> {
    const slot = this.slots[slotIndex];
    if (!slot?.session) throw new Error(`slot ${slotIndex} has no session`);
    const session = slot.session;
    if (slot.label === String(slotIndex + 1)) slot.label = labelFromPrompt(prompt);
    try {
      return await session.send(prompt);
    } catch (e) {
      // aborted turns and stream errors never emit a terminal event; drive the
      // state machine ourselves so the key can't stick on thinking/running.
      // Resolve the session's current slot because an admin drag may have moved
      // the binding while the send was in flight.
      const currentIndex = this.slots.findIndex((candidate) => candidate.session === session);
      if (currentIndex >= 0) {
        this.onSessionEvent(currentIndex, {
          type: 'turn-failed',
          error: e instanceof Error ? e.message : String(e),
        });
      }
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

  /**
   * Swap the session bindings carried by two fixed numbered slots.
   *
   * Slot indexes are physical identities used by the deck layout, so only the
   * attached session and its binding-specific metadata move. Event listeners
   * are rebound synchronously, so active turns continue on their new slot.
   */
  swapBindings(firstIndex: number, secondIndex: number): void {
    if (firstIndex === secondIndex) return;
    const first = this.slots[firstIndex];
    const second = this.slots[secondIndex];
    if (!first || !second) throw new Error('invalid session slot');

    const binding = (slot: Slot) => ({
      sourceIndex: slot.index,
      state: slot.state,
      session: slot.session,
      label: slot.label,
      customLabel: slot.customLabel,
      cwd: slot.cwd,
      detail: slot.detail,
      lastMessage: slot.lastMessage,
      updatedAt: slot.updatedAt,
    });
    const firstBinding = binding(first);
    const secondBinding = binding(second);

    for (const index of [firstIndex, secondIndex]) {
      const slot = this.slots[index];
      slot.unsubscribe?.();
      slot.unsubscribe = null;
      this.clearDecay(index);
      this.clearFeedback(index);
    }

    const apply = (slot: Slot, value: ReturnType<typeof binding>) => {
      // Completion/error flashes and attachment confirmations are transient.
      // Normalize them while moving so clearing their old timers cannot leave
      // the destination stuck; persistent attention is restored by session ID.
      slot.state = value.state === 'done' || value.state === 'error' ? 'idle' : value.state;
      slot.session = value.session;
      slot.label = value.label === String(value.sourceIndex + 1)
        ? String(slot.index + 1)
        : value.label;
      slot.customLabel = value.customLabel;
      slot.cwd = value.cwd;
      slot.detail = value.detail === 'session attached' ? '' : value.detail;
      slot.lastMessage = value.lastMessage;
      slot.updatedAt = value.updatedAt;
      slot.unsubscribe = slot.session
        ? slot.session.onEvent((event) => this.onSessionEvent(slot.index, event))
        : null;
      if (!slot.session) {
        slot.state = 'empty';
        slot.label = String(slot.index + 1);
        slot.customLabel = null;
        slot.detail = '';
        slot.lastMessage = null;
      }
    };
    apply(first, secondBinding);
    apply(second, firstBinding);

    const previousSelection = this.selectedIndex_;
    if (previousSelection === firstIndex) this.selectedIndex_ = secondIndex;
    else if (previousSelection === secondIndex) this.selectedIndex_ = firstIndex;

    this.emitSlot(firstIndex);
    this.emitSlot(secondIndex);
    if (this.selectedIndex_ !== previousSelection) {
      this.emitter.emit('select', this.selectedIndex_);
    }
  }

  /** Clear a slot back to empty (unbind session). */
  clear(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    slot.state = 'empty';
    this.resetBindingMetadata(slot);
    this.detach(slotIndex);
    this.emitSlot(slotIndex);
  }

  /** Remove metadata that belongs to the session binding, not the physical slot. */
  private resetBindingMetadata(slot: Slot): void {
    slot.label = `${slot.index + 1}`;
    slot.customLabel = null;
    slot.detail = '';
    slot.lastMessage = null;
    slot.updatedAt = Date.now();
  }

  private onSessionEvent(index: number, event: SessionEvent): void {
    const slot = this.slots[index];
    const next = nextState(slot.state, event);
    this.clearDecay(index);
    if (event.type !== 'meta') {
      this.clearFeedback(index);
      if (slot.detail === 'session attached') slot.detail = '';
    }
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

  private clearFeedback(index: number): void {
    const slot = this.slots[index];
    if (slot.feedbackTimer) {
      clearTimeout(slot.feedbackTimer);
      slot.feedbackTimer = null;
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
