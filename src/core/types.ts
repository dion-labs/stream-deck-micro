/**
 * Harness-agnostic core types.
 *
 * Everything in src/core knows nothing about Codex or the Stream Deck; it deals
 * only in agent sessions, states and workflows. An agent harness plugs in by
 * implementing HarnessAdapter in src/harness/.
 */

/** Lifecycle of a slot, mirrored 1:1 onto key colors. Ordered by precedence, low → high. */
export type AgentState =
  | 'empty' // slot has no session bound
  | 'idle' // session bound, no active turn
  | 'thinking' // turn active, model is reasoning/writing
  | 'running' // turn active, agent is executing commands/patches/tools
  | 'done' // turn just completed (transient, flashes then returns to idle)
  | 'error'; // turn failed or stream errored (transient, then idle)

/** A session as listed by a harness's session store. */
export interface SessionInfo {
  id: string;
  name?: string;
  updatedAt?: string;
}

/** What a slot displays: stable identity of the bound session. */
export interface AgentSlotSnapshot {
  index: number;
  state: AgentState;
  /** Harness session id; null until the harness assigns one (Codex: after the first turn). */
  sessionId: string | null;
  /** Short label shown on the key (slot number + thread name once known). */
  label: string;
  /** User-set label overriding everything else (admin UI / sdm rename). */
  customLabel: string | null;
  cwd: string;
  /** Last turn's headline activity, shown in `sdm status`. */
  detail: string;
  /** The agent's final message of the most recent turn, when available. */
  lastMessage: string | null;
  updatedAt: number;
}

/**
 * Activity events every adapter must translate its harness events into.
 * These are the only signal SlotManager consumes to drive AgentState.
 */
export type SessionEvent =
  | { type: 'turn-started' }
  | { type: 'reasoning'; text?: string }
  | { type: 'tool-started'; tool: string; detail?: string }
  | { type: 'file-change'; files: string[] }
  | { type: 'agent-message'; text: string }
  | { type: 'turn-completed' }
  | { type: 'turn-failed'; error: string }
  /** Metadata changed (e.g. thread name); carries no state signal. */
  | { type: 'meta'; name?: string };

/** A live conversation with one agent, bound to one slot. */
export interface AgentSession {
  /** Harness session id, or null if not yet assigned (assigned after first turn on Codex). */
  readonly sessionId: string | null;
  /** Human-readable thread name once the harness provides one. */
  readonly name: string | null;
  /** Send a prompt; resolves when the turn completes (or rejects on failure/abort). */
  send(prompt: string, signal?: AbortSignal): Promise<void>;
  /** Abort the in-flight turn, if any. */
  interrupt(): void;
  /** Register the event callback; returns an unsubscribe function. */
  onEvent(cb: (event: SessionEvent) => void): () => void;
  dispose(): void;
}

export interface CreateSessionOptions {
  cwd: string;
  /** Optional first prompt — some harnesses only assign a session id after the first turn. */
  initialPrompt?: string;
}

/** The contract a harness must fulfill to be driven by this daemon. */
export interface HarnessAdapter {
  readonly name: string;
  listSessions(): Promise<SessionInfo[]>;
  createSession(opts: CreateSessionOptions): Promise<AgentSession>;
  resumeSession(id: string, opts: { cwd: string }): Promise<AgentSession>;
}

/** A one-tap prompt template targeting the selected slot (joystick workflows equivalent). */
export interface Workflow {
  id: string;
  name: string;
  /** Prompt sent to the selected slot; may reference $CWD. */
  prompt: string;
}

export function isTransient(state: AgentState): boolean {
  return state === 'done' || state === 'error';
}
