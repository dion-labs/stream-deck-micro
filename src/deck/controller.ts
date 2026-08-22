import { openStreamDeck, type StreamDeck } from 'elgato-stream-deck';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_DECK_SETTINGS,
  type DeckSettings,
} from '../config.js';
import type { AgentSlotSnapshot } from '../core/types.js';
import {
  ACTION_KEYS_STYLE,
  DO_IT_STYLE,
  KEY_ATTACH,
  KEY_SLEEP,
  KEY_STOP,
  SLOT_KEYS,
  layoutActions,
  workflowKeyAssignments,
  type KeyAction,
  type WorkflowKey,
} from './layout.js';
import { renderActionKey, renderSlotKey } from './renderer.js';

export interface DeckEvents {
  /** A semantic key action fired (physical key → layout meaning). */
  action: (action: KeyAction) => void;
  /** Persistent completion/error attention changed and should be saved. */
  attention: () => void;
  /** Awake/attention/asleep presentation mode changed. */
  mode: (mode: DeckMode) => void;
}

export type DeckMode = 'awake' | 'attention' | 'asleep';
export type AttentionState = 'done' | 'error';

export interface DeckStatus {
  mode: DeckMode;
  settings: DeckSettings;
  attention: { index: number; state: AttentionState; sessionId: string | null }[];
  autoSleepDueAt: number | null;
}

export interface DeckDriver {
  readonly NUM_KEYS: number;
  readonly MODEL: string;
  fillColor(keyIndex: number, r: number, g: number, b: number): void;
  fillImage(keyIndex: number, buffer: Buffer, options?: { format: 'rgba' }): void;
  clearKey(keyIndex: number): void;
  clearAllKeys(): void;
  setBrightness(percentage: number): void;
  on(event: 'down' | 'up', listener: (keyIndex: number) => void): unknown;
  on(event: 'error', listener: (e: unknown) => void): unknown;
  close(): void;
}

const PULSE_INTERVAL_MS = 450;

/**
 * Owns the physical Stream Deck: renders slots/actions onto keys, runs the
 * thinking/working pulse animation, and translates key presses into semantic
 * actions. Injectable driver for tests.
 */
export class DeckController {
  private readonly emitter = new EventEmitter();
  private readonly device: DeckDriver;
  private readonly workflows: WorkflowKey[];
  private settings: DeckSettings;
  private snapshots: AgentSlotSnapshot[] = [];
  private readonly attention = new Map<number, AttentionState>();
  private selectedIndex = 0;
  private mode: DeckMode = 'awake';
  private pulsePhase = 0;
  private pulseTimer: NodeJS.Timeout | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
  private autoSleepDueAt: number | null = null;

  constructor(
    device: DeckDriver,
    workflows: WorkflowKey[],
    settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  ) {
    this.device = device;
    this.workflows = workflows;
    this.settings = cloneSettings(settings);
    this.device.on('down', (keyIndex: number) => this.onDown(keyIndex));
    this.device.on('error', (e: unknown) => {
      throw e instanceof Error ? e : new Error(String(e));
    });
  }

  /** Open the real device; throws with a helpful message if it's unavailable. */
  static open(workflows: WorkflowKey[], settings: DeckSettings = DEFAULT_DECK_SETTINGS): DeckController {
    let device: StreamDeck;
    try {
      device = openStreamDeck();
    } catch (e) {
      throw new Error(
        `cannot open Stream Deck (${String(e)}). ` +
          'Is it plugged in, and is the Elgato Stream Deck app quit? ' +
          'The app holds the HID device exclusively.',
      );
    }
    return new DeckController(device as unknown as DeckDriver, workflows, settings);
  }

  on<K extends keyof DeckEvents>(event: K, listener: DeckEvents[K]): void {
    this.emitter.on(event, listener);
  }

  /** Swap the workflow set at runtime and repaint the workflow keys. */
  setWorkflows(workflows: WorkflowKey[]): void {
    this.workflows.length = 0;
    this.workflows.push(...workflows);
    if (this.mode === 'awake') this.drawStaticKeys();
  }

  setSettings(settings: DeckSettings): void {
    this.settings = cloneSettings(settings);
    if (this.mode !== 'asleep') this.device.setBrightness(this.settings.brightness);
    if (!this.settings.autoSleep.enabled && this.mode === 'attention') this.wake();
    else this.resetAutoSleepTimer();
    if (this.mode === 'awake') this.drawStaticKeys();
  }

  status(): DeckStatus {
    return {
      mode: this.mode,
      settings: cloneSettings(this.settings),
      attention: [...this.attention.entries()].map(([index, state]) => ({
        index,
        state,
        sessionId: this.snapshots[index]?.sessionId ?? null,
      })),
      autoSleepDueAt: this.autoSleepDueAt,
    };
  }

  restoreAttention(entries: { sessionId: string; state: AttentionState }[]): void {
    const bySession = new Map(entries.map((entry) => [entry.sessionId, entry.state]));
    this.attention.clear();
    for (const snapshot of this.snapshots) {
      if (!snapshot.sessionId) continue;
      const state = bySession.get(snapshot.sessionId);
      if (state) this.attention.set(snapshot.index, state);
    }
    if (this.mode === 'awake') this.repaintAll();
    this.ensurePulse();
    this.emitter.emit('attention');
  }

  /** Full repaint of every key from current slot snapshots. */
  render(snapshots: AgentSlotSnapshot[], selectedIndex: number): void {
    this.snapshots = snapshots;
    this.selectedIndex = selectedIndex;
    this.device.setBrightness(this.settings.brightness);
    this.repaintAll();
    this.ensurePulse();
    this.resetAutoSleepTimer();
  }

  /** Incremental update for a single slot (fired on every slot event). */
  updateSlot(snapshot: AgentSlotSnapshot): void {
    const previous = this.snapshots[snapshot.index];
    const sessionChanged = previous?.sessionId !== snapshot.sessionId;
    if (sessionChanged && this.attention.delete(snapshot.index)) {
      this.emitter.emit('attention');
    }
    if (
      !sessionChanged
      && this.attention.has(snapshot.index)
      && (snapshot.state === 'thinking' || snapshot.state === 'running')
    ) {
      this.attention.delete(snapshot.index);
      this.emitter.emit('attention');
    }
    if (
      previous
      && snapshot.sessionId
      && (snapshot.state === 'done' || snapshot.state === 'error')
      && previous.state !== 'done'
      && previous.state !== 'error'
    ) {
      this.attention.set(snapshot.index, snapshot.state);
      this.emitter.emit('attention');
    }
    this.snapshots[snapshot.index] = snapshot;
    const changed = previous !== undefined && slotChanged(previous, snapshot);
    if (changed) {
      if (this.mode !== 'awake') this.wake();
      else {
        this.resetAutoSleepTimer();
        this.drawSlot(snapshot);
      }
    } else if (this.mode === 'awake') this.drawSlot(snapshot);
    this.ensurePulse();
  }

  updateSelection(selectedIndex: number): void {
    const previous = this.selectedIndex;
    this.selectedIndex = selectedIndex;
    if (this.mode === 'awake') {
      if (this.snapshots[previous]) this.drawSlot(this.snapshots[previous]);
      if (this.snapshots[selectedIndex]) this.drawSlot(this.snapshots[selectedIndex]);
    }
  }

  /** Mark a completed/error slot as seen. Used by both physical and virtual slot presses. */
  acknowledge(index: number, wake = true): boolean {
    const changed = this.attention.delete(index);
    if (wake) this.wake();
    if (changed) {
      if (this.mode === 'attention') this.drawAttentionOnly();
      else if (this.mode === 'awake' && this.snapshots[index]) this.drawSlot(this.snapshots[index]);
      this.emitter.emit('attention');
    }
    return changed;
  }

  sleep(): void {
    if (this.mode === 'asleep') return;
    this.clearSleepTimer();
    this.stopPulse();
    this.mode = 'asleep';
    this.device.setBrightness(0);
    this.emitter.emit('mode', this.mode);
  }

  wake(): void {
    const changed = this.mode !== 'awake';
    this.mode = 'awake';
    this.device.setBrightness(this.settings.brightness);
    if (changed) this.repaintAll();
    this.ensurePulse();
    this.resetAutoSleepTimer();
    if (changed) this.emitter.emit('mode', this.mode);
  }

  private drawSlot(snapshot: AgentSlotSnapshot): void {
    const key = SLOT_KEYS[snapshot.index];
    if (key === undefined) return;
    const buffer = renderSlotKey(
      snapshot,
      snapshot.index === this.selectedIndex,
      72,
      this.pulsePhase,
      this.attention.get(snapshot.index),
    );
    this.device.fillImage(key, buffer, { format: 'rgba' });
  }

  private drawStaticKeys(): void {
    for (const [action, key] of [
      ['stop', KEY_STOP],
      ['sleep', KEY_SLEEP],
      ['attach', KEY_ATTACH],
    ] as const) {
      const style = ACTION_KEYS_STYLE[action];
      this.device.fillImage(key, renderActionKey(style.title, style.color), { format: 'rgba' });
    }
    if (this.settings.sleepKey === 'toggle-auto') {
      this.device.fillImage(
        KEY_SLEEP,
        renderActionKey('AUTO', this.settings.autoSleep.enabled ? [48, 78, 66] : [55, 58, 66], this.settings.autoSleep.enabled ? 'ON' : 'OFF'),
        { format: 'rgba' },
      );
    }
    for (const { key, workflow, style } of workflowKeyAssignments(this.workflows)) {
      const title = style === 'action' ? DO_IT_STYLE.title : workflow.name.slice(0, 10);
      const color: [number, number, number] =
        style === 'action' ? DO_IT_STYLE.color : [55, 65, 110];
      this.device.fillImage(
        key,
        renderActionKey(title, color, style === 'workflow' ? workflow.id : undefined),
        { format: 'rgba' },
      );
    }
  }

  /** Pulse animate thinking/running slots; stop the timer when none remain. */
  private ensurePulse(): void {
    if (this.mode === 'asleep') {
      this.stopPulse();
      return;
    }
    const animated = this.attention.size > 0
      || this.snapshots.some((s) => s.state === 'thinking' || s.state === 'running');
    if (animated && !this.pulseTimer) {
      this.pulseTimer = setInterval(() => {
        this.pulsePhase = this.pulsePhase ? 0 : 1;
        if (this.mode === 'attention') this.drawAttentionOnly(false);
        else for (const s of this.snapshots) {
          if (s.state === 'thinking' || s.state === 'running' || this.attention.has(s.index)) {
            this.drawSlot(s);
          }
        }
      }, PULSE_INTERVAL_MS);
      this.pulseTimer.unref?.();
    } else if (!animated && this.pulseTimer) {
      this.stopPulse();
      // repaint any key left on the dim phase
      this.pulsePhase = 0;
      for (const s of this.snapshots) this.drawSlot(s);
    }
  }

  private onDown(keyIndex: number): void {
    const action = layoutActions(this.workflows).get(keyIndex);
    if (this.mode === 'asleep') {
      this.wake();
      return;
    }
    if (this.mode === 'attention') {
      if (action?.kind === 'slot' && this.attention.has(action.index)) {
        this.acknowledge(action.index);
        this.emitter.emit('action', action);
      } else {
        this.wake();
      }
      return;
    }
    if (action?.kind === 'slot') this.acknowledge(action.index, false);
    if (action) this.emitter.emit('action', action);
  }

  private repaintAll(): void {
    for (const snapshot of this.snapshots) this.drawSlot(snapshot);
    this.drawStaticKeys();
  }

  private resetAutoSleepTimer(): void {
    this.clearSleepTimer();
    if (
      this.mode !== 'awake'
      || !this.settings.autoSleep.enabled
      || this.snapshots.some((snapshot) => snapshot.state === 'thinking' || snapshot.state === 'running')
    ) return;
    const delay = this.settings.autoSleep.timeoutMinutes * 60_000;
    this.autoSleepDueAt = Date.now() + delay;
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.autoSleepDueAt = null;
      if (this.snapshots.some((snapshot) => snapshot.state === 'thinking' || snapshot.state === 'running')) return;
      if (this.attention.size) this.enterAttentionMode();
      else this.sleep();
    }, delay);
    this.sleepTimer.unref?.();
  }

  private enterAttentionMode(): void {
    this.clearSleepTimer();
    this.mode = 'attention';
    this.device.setBrightness(this.settings.brightness);
    this.drawAttentionOnly();
    this.ensurePulse();
    this.emitter.emit('mode', this.mode);
  }

  private drawAttentionOnly(clear = true): void {
    if (clear) this.device.clearAllKeys();
    for (const index of this.attention.keys()) {
      const snapshot = this.snapshots[index];
      if (snapshot) this.drawSlot(snapshot);
    }
  }

  private clearSleepTimer(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.autoSleepDueAt = null;
  }

  private stopPulse(): void {
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.pulseTimer = null;
  }

  close(): void {
    this.stopPulse();
    this.clearSleepTimer();
    this.emitter.removeAllListeners();
    try {
      this.device.close();
    } catch {
      // device may already be gone
    }
  }
}

function cloneSettings(settings: DeckSettings): DeckSettings {
  return { ...settings, autoSleep: { ...settings.autoSleep } };
}

function slotChanged(previous: AgentSlotSnapshot, next: AgentSlotSnapshot): boolean {
  return previous.state !== next.state
    || previous.sessionId !== next.sessionId
    || previous.label !== next.label
    || previous.detail !== next.detail
    || previous.lastMessage !== next.lastMessage;
}
