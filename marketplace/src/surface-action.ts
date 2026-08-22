import {
  action,
  type KeyAction,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';
import streamDeck from '@elgato/streamdeck';
import type { JsonObject, JsonValue } from '@elgato/utils';
import { BridgeClient } from './bridge.js';
import { renderKey } from './render.js';
import type { DaemonStatus } from './types.js';

const POLL_MS = 650;

@action({ UUID: 'ai.dionlabs.stream-deck-micro.surface-key' })
export class SurfaceKeyAction extends SingletonAction {
  private readonly bridge = new BridgeClient();
  private readonly images = new Map<string, string>();
  private status: DaemonStatus | null = null;
  private error = 'Local bridge is not running';
  private pulse = false;
  private polling = false;

  constructor() {
    super();
    const timer = setInterval(() => {
      this.pulse = !this.pulse;
      void this.refresh();
    }, POLL_MS);
    timer.unref?.();
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refresh();
    if (ev.action.controllerType === 'Keypad') {
      await this.renderAction(ev.action as KeyAction);
    }
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.images.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (ev.payload.isInMultiAction || ev.action.device.size.columns !== 5) {
      await ev.action.showAlert();
      return;
    }
    if (!this.status || this.status.surface !== 'marketplace') {
      await ev.action.showAlert();
      await this.refresh();
      return;
    }
    const index = ev.payload.coordinates.row * 5 + ev.payload.coordinates.column;
    try {
      await this.bridge.press(index);
      await this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = null;
      await ev.action.showAlert();
      await this.renderAll();
    }
  }

  override async onPropertyInspectorDidAppear(
    _ev: PropertyInspectorDidAppearEvent,
  ): Promise<void> {
    await this.refresh();
    await streamDeck.ui.sendToPropertyInspector(this.inspectorState());
  }

  override async onSendToPlugin(
    _ev: SendToPluginEvent<JsonValue, JsonObject>,
  ): Promise<void> {
    await this.refresh();
    await streamDeck.ui.sendToPropertyInspector(this.inspectorState());
  }

  private async refresh(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.status = await this.bridge.status();
      this.error = this.status.surface === 'marketplace'
        ? ''
        : 'Bridge is running in Independent mode';
    } catch (error) {
      this.status = null;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.polling = false;
    }
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    await Promise.all([...this.actions]
      .filter((visible) => visible.controllerType === 'Keypad')
      .map((visible) => this.renderAction(visible as KeyAction)));
  }

  private async renderAction(visible: KeyAction): Promise<void> {
    const coordinates = visible.coordinates;
    if (!coordinates || visible.device.size.columns !== 5) {
      await visible.setImage(renderKey(null, -1, this.pulse, 'A 5×3 Stream Deck is required'));
      return;
    }
    const index = coordinates.row * 5 + coordinates.column;
    const image = renderKey(this.status, index, this.pulse, this.error);
    if (this.images.get(visible.id) === image) return;
    this.images.set(visible.id, image);
    await visible.setImage(image);
  }

  private inspectorState(): Record<string, JsonValue> {
    return {
      connected: Boolean(this.status && this.status.surface === 'marketplace'),
      message: this.error || 'Connected to the local Stream Deck Micro bridge',
      mode: this.status?.deck.mode ?? 'offline',
    };
  }
}
