import type { AgentSession, SessionEvent } from './types.js';

/**
 * A persisted session binding that is visible while its harness is offline.
 *
 * Detached sessions keep navigation and layout identity available without
 * pretending that prompts can be delivered. A live adapter session replaces
 * this object in-place after the harness reconnects.
 */
export class DetachedSession implements AgentSession {
  readonly name: string | null;

  constructor(
    readonly sessionId: string,
    name?: string,
  ) {
    this.name = name ?? null;
  }

  async send(): Promise<void> {
    throw new Error('This session is available for navigation only until shared control reconnects.');
  }

  interrupt(): void {}

  onEvent(_callback: (event: SessionEvent) => void): () => void {
    return () => {};
  }

  dispose(): void {}
}
