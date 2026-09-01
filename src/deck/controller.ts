import { openStreamDeck, type StreamDeck } from 'elgato-stream-deck';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_DECK_SETTINGS,
  type DeckSettings,
} from '../config.js';
import type { AgentSlotSnapshot } from '../core/types.js';
import type { CapabilityMode } from '../runtimeStatus.js';
import {
  ACTION_KEYS_STYLE,
  DO_IT_STYLE,
  layoutActions,
  type DeckLayoutEntry,
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
  /** The user explicitly requested a graceful Codex Desktop restart. */
  restartCodex: () => void;
  /** The user explicitly requested removal of shared mode and a private restart. */
  recoverCodex: () => void;
}

export type DeckMode = 'awake' | 'attention' | 'asleep';
export type AttentionState = 'done' | 'error';
export type DesktopRecoveryState =
  | 'restart-required' | 'restarting' | 'update-required' | 'updating'
  | 'shared-error' | 'recovering-private' | 'private-ready';

export interface DeckStatus {
  mode: DeckMode;
  settings: DeckSettings;
  layout: { keyIndex: number; action: KeyAction }[];
  attention: { index: number; state: AttentionState; sessionId: string | null }[];
  autoSleepDueAt: number | null;
  desktopRecovery: DesktopRecoveryState | null;
  capabilityMode: CapabilityMode;
  actionFeedback: ActionFeedback | null;
}

export interface ActionFeedback {
  keyIndex: number;
  outcome: 'blocked' | 'failed';
  message: string;
  expiresAt: number;
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
const RECOVERY_KEY_INDEX = 7;
const SHARED_RETRY_KEY_INDEX = 6;

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
  private layout: DeckLayoutEntry[] | undefined;
  private snapshots: AgentSlotSnapshot[] = [];
  private readonly attention = new Map<number, AttentionState>();
  private selectedIndex = 0;
  private mode: DeckMode = 'awake';
  private pulsePhase = 0;
  private pulseTimer: NodeJS.Timeout | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
  private autoSleepDueAt: number | null = null;
  private desktopRecovery: DesktopRecoveryState | null = null;
  private capabilityMode: CapabilityMode = 'offline';
  private actionFeedback: ActionFeedback | null = null;
  private feedbackTimer: NodeJS.Timeout | null = null;

  constructor(
    device: DeckDriver,
    workflows: WorkflowKey[],
    settings: DeckSettings = DEFAULT_DECK_SETTINGS,
    layout?: DeckLayoutEntry[],
  ) {
    this.device = device;
    this.workflows = workflows;
    this.settings = cloneSettings(settings);
    this.layout = cloneLayout(layout);
    this.device.on('down', (keyIndex: number) => this.onDown(keyIndex));
    this.device.on('error', (e: unknown) => {
      throw e instanceof Error ? e : new Error(String(e));
    });
  }

  /** Open the real device; throws with a helpful message if it's unavailable. */
  static open(
    workflows: WorkflowKey[],
    settings: DeckSettings = DEFAULT_DECK_SETTINGS,
    layout?: DeckLayoutEntry[],
  ): DeckController {
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
    return new DeckController(device as unknown as DeckDriver, workflows, settings, layout);
  }

  on<K extends keyof DeckEvents>(event: K, listener: DeckEvents[K]): void {
    this.emitter.on(event, listener);
  }

  /** Swap the workflow set at runtime and repaint the workflow keys. */
  setWorkflows(workflows: WorkflowKey[]): void {
    this.workflows.length = 0;
    this.workflows.push(...workflows);
    if (this.mode === 'awake' && !this.desktopRecovery) this.repaintAll();
  }

  setLayout(layout: DeckLayoutEntry[]): void {
    this.layout = cloneLayout(layout);
    if (this.mode === 'awake' && !this.desktopRecovery) this.repaintAll();
  }

  setSettings(settings: DeckSettings): void {
    this.settings = cloneSettings(settings);
    if (this.mode !== 'asleep') this.device.setBrightness(this.settings.brightness);
    if (!this.settings.autoSleep.enabled && this.mode === 'attention') this.wake();
    else this.resetAutoSleepTimer();
    if (this.mode === 'awake' && !this.desktopRecovery) this.drawStaticKeys();
  }

  status(): DeckStatus {
    return {
      mode: this.mode,
      settings: cloneSettings(this.settings),
      layout: [...this.actions()].map(([keyIndex, action]) => ({ keyIndex, action })),
      attention: [...this.attention.entries()].map(([index, state]) => ({
        index,
        state,
        sessionId: this.snapshots[index]?.sessionId ?? null,
      })),
      autoSleepDueAt: this.autoSleepDueAt,
      desktopRecovery: this.desktopRecovery,
      capabilityMode: this.capabilityMode,
      actionFeedback: this.actionFeedback ? { ...this.actionFeedback } : null,
    };
  }

  setCapabilityMode(mode: CapabilityMode): void {
    if (mode === this.capabilityMode) return;
    this.capabilityMode = mode;
    if (this.mode === 'awake' && !this.desktopRecovery) this.repaintAll();
  }

  showActionFeedback(action: KeyAction, outcome: ActionFeedback['outcome'], message: string): void {
    const keyIndex = [...this.actions()].find(([, candidate]) => actionIdentity(candidate) === actionIdentity(action))?.[0];
    if (keyIndex === undefined) return;
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.actionFeedback = { keyIndex, outcome, message, expiresAt: Date.now() + 1_400 };
    if (this.mode === 'awake' && !this.desktopRecovery) {
      this.device.fillImage(
        keyIndex,
        renderActionKey(outcome === 'blocked' ? 'BLOCKED' : 'FAILED', [105, 45, 76], message.slice(0, 12)),
        { format: 'rgba' },
      );
    }
    this.feedbackTimer = setTimeout(() => {
      this.feedbackTimer = null;
      this.actionFeedback = null;
      if (this.mode === 'awake' && !this.desktopRecovery) this.repaintAll();
    }, 1_400);
    this.feedbackTimer.unref?.();
  }

  /** Temporarily replace the normal surface with one central recovery action. */
  setDesktopRecovery(state: DesktopRecoveryState | null): void {
    if (state === this.desktopRecovery) return;
    const previousMode = this.mode;
    this.desktopRecovery = state;
    this.clearSleepTimer();
    this.stopPulse();
    this.mode = 'awake';
    this.device.setBrightness(this.settings.brightness);
    this.repaintAll();
    if (state === null) {
      this.ensurePulse();
      this.resetAutoSleepTimer();
    }
    if (previousMode !== this.mode) this.emitter.emit('mode', this.mode);
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
      else if (!this.desktopRecovery) {
        this.resetAutoSleepTimer();
        this.drawSlot(snapshot);
      }
    } else if (this.mode === 'awake' && !this.desktopRecovery) this.drawSlot(snapshot);
    this.ensurePulse();
  }

  updateSelection(selectedIndex: number): void {
    const previous = this.selectedIndex;
    this.selectedIndex = selectedIndex;
    if (this.mode === 'awake' && !this.desktopRecovery) {
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
    if (this.mode === 'asleep' || this.desktopRecovery) return;
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
    if (this.desktopRecovery) return;
    const key = [...this.actions()].find(([, action]) =>
      action.kind === 'slot' && action.index === snapshot.index)?.[0];
    if (key === undefined) return;
    const buffer = renderSlotKey(
      snapshot,
      snapshot.index === this.selectedIndex,
      72,
      this.pulsePhase,
      this.attention.get(snapshot.index),
      this.capabilityMode === 'navigation-only' && snapshot.state !== 'empty',
    );
    this.device.fillImage(key, buffer, { format: 'rgba' });
  }

  private drawStaticKeys(): void {
    for (const [key, action] of this.actions()) {
      if (action.kind === 'slot') continue;
      if (action.kind === 'workflow') {
        const workflow = this.workflows.find((candidate) => candidate.id === action.id);
        if (!workflow) continue;
        const doIt = workflow.id === 'do-it';
        const controlUnavailable = this.capabilityMode !== 'live';
        this.device.fillImage(
          key,
          renderActionKey(
            doIt ? DO_IT_STYLE.title : workflow.name.slice(0, 10),
            controlUnavailable ? [62, 48, 72] : doIt ? DO_IT_STYLE.color : [55, 65, 110],
            controlUnavailable ? 'LIVE OFF' : doIt ? undefined : workflow.id,
          ),
          { format: 'rgba' },
        );
        continue;
      }
      const style = ACTION_KEYS_STYLE[action.kind];
      const isAutoSleep = action.kind === 'sleep' && this.settings.sleepKey === 'toggle-auto';
      const controlUnavailable = this.capabilityMode !== 'live'
        && (action.kind === 'stop' || action.kind === 'attach');
      this.device.fillImage(
        key,
        controlUnavailable
          ? renderActionKey(style.title, [62, 48, 72], 'LIVE OFF')
          : isAutoSleep
          ? renderActionKey('AUTO', this.settings.autoSleep.enabled ? [48, 78, 66] : [55, 58, 66], this.settings.autoSleep.enabled ? 'ON' : 'OFF')
          : renderActionKey(style.title, style.color),
        { format: 'rgba' },
      );
    }
  }

  /** Pulse animate thinking/running slots; stop the timer when none remain. */
  private ensurePulse(): void {
    if (this.desktopRecovery) {
      this.stopPulse();
      return;
    }
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
    if (this.desktopRecovery) {
      if (keyIndex === SHARED_RETRY_KEY_INDEX && ['restart-required', 'update-required'].includes(this.desktopRecovery)) {
        this.emitter.emit('restartCodex');
      } else if (keyIndex === RECOVERY_KEY_INDEX && ['restart-required', 'update-required', 'shared-error'].includes(this.desktopRecovery)) {
        this.emitter.emit('recoverCodex');
      }
      return;
    }
    const action = this.actions().get(keyIndex);
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
    this.device.clearAllKeys();
    if (this.desktopRecovery) {
      const restarting = this.desktopRecovery === 'restarting';
      const updating = this.desktopRecovery === 'updating';
      const recoveringPrivate = this.desktopRecovery === 'recovering-private';
      const privateReady = this.desktopRecovery === 'private-ready';
      const canRetryShared = ['restart-required', 'update-required'].includes(this.desktopRecovery);
      const busy = restarting || updating || recoveringPrivate;
      if (canRetryShared) {
        this.device.fillImage(
          SHARED_RETRY_KEY_INDEX,
          renderActionKey(this.desktopRecovery === 'update-required' ? 'UPDATE' : 'RETRY', [180, 108, 20], 'SHARED'),
          { format: 'rgba' },
        );
      }
      this.device.fillImage(
        RECOVERY_KEY_INDEX,
        renderActionKey(
          updating ? 'UPDATING' : restarting ? 'OPENING' : recoveringPrivate ? 'RECOVERING' : privateReady ? 'READY' : 'PRIVATE',
          privateReady ? [37, 108, 72] : busy ? [62, 74, 96] : [18, 98, 127],
          privateReady ? 'PRIVATE' : 'CODEX',
        ),
        { format: 'rgba' },
      );
      return;
    }
    for (const snapshot of this.snapshots) this.drawSlot(snapshot);
    this.drawStaticKeys();
  }

  private actions(): Map<number, KeyAction> {
    return layoutActions(this.workflows, this.layout);
  }

  private resetAutoSleepTimer(): void {
    this.clearSleepTimer();
    if (
      this.desktopRecovery
      ||
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
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = null;
    this.actionFeedback = null;
    this.emitter.removeAllListeners();
    try {
      this.device.close();
    } catch {
      // device may already be gone
    }
  }
}

function actionIdentity(action: KeyAction): string {
  return action.kind === 'slot'
    ? `slot:${action.index}`
    : action.kind === 'workflow'
      ? `workflow:${action.id}`
      : action.kind;
}

function cloneSettings(settings: DeckSettings): DeckSettings {
  return { ...settings, autoSleep: { ...settings.autoSleep } };
}

function cloneLayout(layout?: DeckLayoutEntry[]): DeckLayoutEntry[] | undefined {
  return layout?.map(({ keyIndex, action }) => ({ keyIndex, action: { ...action } }));
}

function slotChanged(previous: AgentSlotSnapshot, next: AgentSlotSnapshot): boolean {
  return previous.state !== next.state
    || previous.sessionId !== next.sessionId
    || previous.label !== next.label
    || previous.detail !== next.detail
    || previous.lastMessage !== next.lastMessage;
}
