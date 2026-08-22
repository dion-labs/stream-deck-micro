import { EventEmitter } from 'node:events';
import type { DeckDriver } from './controller.js';

/**
 * Headless 5×3 surface used when the official Elgato app owns the hardware.
 * Rendering happens in the Marketplace plugin; this driver keeps the existing
 * DeckController state machine (sleep, attention and key semantics) authoritative.
 */
export class VirtualDeckDriver extends EventEmitter implements DeckDriver {
  readonly NUM_KEYS = 15;
  readonly MODEL = 'marketplace-5x3';

  fillColor(_keyIndex: number, _r: number, _g: number, _b: number): void {}
  fillImage(_keyIndex: number, _buffer: Buffer, _options?: { format: 'rgba' }): void {}
  clearKey(_keyIndex: number): void {}
  clearAllKeys(): void {}
  setBrightness(_percentage: number): void {}

  press(keyIndex: number): void {
    this.emit('down', keyIndex);
  }

  close(): void {
    this.removeAllListeners();
  }
}
