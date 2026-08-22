import { openStreamDeck, type StreamDeck } from 'elgato-stream-deck';
import { EventEmitter } from 'node:events';
import type { AgentSlotSnapshot } from '../core/types.js';
import {
  ACTION_KEYS_STYLE,
  DO_IT_STYLE,
  KEY_ATTACH,
  KEY_SELECT,
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
}

export interface DeckDriver {
  readonly NUM_KEYS: number;
  readonly MODEL: string;
  fillColor(keyIndex: number, r: number, g: number, b: number): void;
  fillImage(keyIndex: number, buffer: Buffer, options?: { format: 'rgba' }): void;
  clearKey(keyIndex: number): void;
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
  private snapshots: AgentSlotSnapshot[] = [];
  private selectedIndex = 0;
  private pulsePhase = 0;
  private pulseTimer: NodeJS.Timeout | null = null;

  constructor(device: DeckDriver, workflows: WorkflowKey[]) {
    this.device = device;
    this.workflows = workflows;
    this.device.on('down', (keyIndex: number) => this.onDown(keyIndex));
    this.device.on('error', (e: unknown) => {
      throw e instanceof Error ? e : new Error(String(e));
    });
  }

  /** Open the real device; throws with a helpful message if it's unavailable. */
  static open(workflows: WorkflowKey[]): DeckController {
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
    return new DeckController(device as unknown as DeckDriver, workflows);
  }

  on<K extends keyof DeckEvents>(event: K, listener: DeckEvents[K]): void {
    this.emitter.on(event, listener);
  }

  /** Swap the workflow set at runtime and repaint the workflow keys. */
  setWorkflows(workflows: WorkflowKey[]): void {
    this.workflows.length = 0;
    this.workflows.push(...workflows);
    this.drawStaticKeys();
  }

  /** Full repaint of every key from current slot snapshots. */
  render(snapshots: AgentSlotSnapshot[], selectedIndex: number): void {
    this.snapshots = snapshots;
    this.selectedIndex = selectedIndex;
    for (const snapshot of snapshots) {
      this.drawSlot(snapshot);
    }
    this.drawStaticKeys();
    this.ensurePulse();
  }

  /** Incremental update for a single slot (fired on every slot event). */
  updateSlot(snapshot: AgentSlotSnapshot): void {
    this.snapshots[snapshot.index] = snapshot;
    this.drawSlot(snapshot);
    this.ensurePulse();
  }

  updateSelection(selectedIndex: number): void {
    const previous = this.selectedIndex;
    this.selectedIndex = selectedIndex;
    if (this.snapshots[previous]) this.drawSlot(this.snapshots[previous]);
    if (this.snapshots[selectedIndex]) this.drawSlot(this.snapshots[selectedIndex]);
  }

  private drawSlot(snapshot: AgentSlotSnapshot): void {
    const key = SLOT_KEYS[snapshot.index];
    if (key === undefined) return;
    const buffer = renderSlotKey(snapshot, snapshot.index === this.selectedIndex, 72, this.pulsePhase);
    this.device.fillImage(key, buffer, { format: 'rgba' });
  }

  private drawStaticKeys(): void {
    for (const [action, key] of [
      ['stop', KEY_STOP],
      ['select', KEY_SELECT],
      ['attach', KEY_ATTACH],
    ] as const) {
      const style = ACTION_KEYS_STYLE[action];
      this.device.fillImage(key, renderActionKey(style.title, style.color), { format: 'rgba' });
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
    const animated = this.snapshots.some((s) => s.state === 'thinking' || s.state === 'running');
    if (animated && !this.pulseTimer) {
      this.pulseTimer = setInterval(() => {
        this.pulsePhase = this.pulsePhase ? 0 : 1;
        for (const s of this.snapshots) {
          if (s.state === 'thinking' || s.state === 'running') this.drawSlot(s);
        }
      }, PULSE_INTERVAL_MS);
      this.pulseTimer.unref?.();
    } else if (!animated && this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
      // repaint any key left on the dim phase
      this.pulsePhase = 0;
      for (const s of this.snapshots) this.drawSlot(s);
    }
  }

  private onDown(keyIndex: number): void {
    const action = layoutActions(this.workflows).get(keyIndex);
    if (action) this.emitter.emit('action', action);
  }

  close(): void {
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.emitter.removeAllListeners();
    try {
      this.device.close();
    } catch {
      // device may already be gone
    }
  }
}
