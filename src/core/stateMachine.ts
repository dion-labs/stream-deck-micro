import type { AgentState, SessionEvent } from './types.js';

/**
 * Pure reducer mapping a stream of SessionEvents to the AgentState shown on a key.
 * Mirrors the Codex Micro RGB semantics:
 *   reasoning/agent text → thinking (purple), commands/patches/tools → running (blue),
 *   turn completed → done (green flash), failure → error (red), then back to idle.
 */
export function nextState(current: AgentState, event: SessionEvent): AgentState {
  switch (event.type) {
    case 'turn-started':
      return 'thinking';

    case 'reasoning':
      // During running, late reasoning text keeps the more informative state.
      return current === 'running' ? 'running' : 'thinking';

    case 'agent-message':
      return current === 'thinking' ? 'thinking' : current;

    case 'tool-started':
    case 'file-change':
      return current === 'thinking' || current === 'running' ? 'running' : current;

    case 'turn-completed':
      return 'done';

    case 'turn-failed':
      return 'error';

    case 'meta':
      return current;
  }
}

/** Transient states decay back to idle so a slot never sticks on done/error forever. */
export function decayState(state: AgentState): AgentState {
  return state === 'done' || state === 'error' ? 'idle' : state;
}
