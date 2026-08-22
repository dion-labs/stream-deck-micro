import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Codex } from '@openai/codex-sdk';
import type {
  AgentSession,
  CreateSessionOptions,
  HarnessAdapter,
  SessionEvent,
  SessionInfo,
} from '../../core/types.js';

/** The slice of the SDK surface we depend on — faked in unit tests. */
export interface ThreadLike {
  readonly id: string | null;
  runStreamed(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<object> }>;
}

export interface CodexLike {
  startThread(options?: Record<string, unknown>): ThreadLike | Promise<ThreadLike>;
  resumeThread(id: string, options?: Record<string, unknown>): ThreadLike | Promise<ThreadLike>;
}

export interface CodexAdapterOptions {
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Unattended runs want 'never' so nothing can block on a hidden approval prompt. */
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  modelReasoningEffort?: string;
  extraConfig?: Record<string, string | number | boolean>;
}

const SESSION_INDEX = join(homedir(), '.codex', 'session_index.jsonl');

/** One Codex conversation, driven turn-by-turn via the SDK's streamed exec events. */
class CodexAgentSession implements AgentSession {
  private listeners = new Set<(e: SessionEvent) => void>();
  private inFlight: AbortController | null = null;
  name_: string | null = null;

  constructor(
    private readonly thread: ThreadLike,
    private readonly codexOptions: Record<string, unknown> | undefined,
    private readonly indexLookup: (id: string) => Promise<string | null>,
  ) {}

  get sessionId(): string | null {
    return this.thread.id;
  }

  get name(): string | null {
    return this.name_;
  }

  async send(prompt: string, signal?: AbortSignal): Promise<void> {
    if (this.inFlight) throw new Error('a turn is already running on this session');
    const ac = new AbortController();
    this.inFlight = ac;
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    try {
      const { events } = await this.thread.runStreamed(prompt, { signal: ac.signal });
      for await (const event of events) {
        this.dispatchEvent(event);
      }
    } finally {
      this.inFlight = null;
    }
  }

  interrupt(): void {
    this.inFlight?.abort();
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.interrupt();
    this.listeners.clear();
  }

  /** Translate codex exec JSONL events into harness-agnostic SessionEvents. */
  private dispatchEvent(raw: object): void {
    const event = raw as { type?: string; item?: { type?: string } & Record<string, unknown> };
    switch (event.type) {
      case 'thread.started':
        // id becomes visible via this.thread.id; nothing to emit.
        break;
      case 'turn.started':
        this.emit({ type: 'turn-started' });
        break;
      case 'turn.completed':
        void this.refreshName();
        this.emit({ type: 'turn-completed' });
        break;
      case 'turn.failed':
        this.emit({
          type: 'turn-failed',
          error: String((raw as { error?: { message?: string } }).error?.message ?? 'turn failed'),
        });
        break;
      case 'error':
        this.emit({ type: 'turn-failed', error: String((raw as { message?: string }).message) });
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.dispatchItem(event.item);
        break;
    }
  }

  private dispatchItem(item: { type?: string } & Record<string, unknown> | undefined): void {
    switch (item?.type) {
      case 'reasoning':
        this.emit({ type: 'reasoning' });
        break;
      case 'agent_message':
        this.emit({ type: 'agent-message', text: String(item.text ?? '') });
        break;
      case 'command_execution':
        this.emit({
          type: 'tool-started',
          tool: 'shell',
          detail: String(item.command ?? ''),
        });
        break;
      case 'mcp_tool_call':
        this.emit({
          type: 'tool-started',
          tool: String(item.tool ?? 'mcp'),
          detail: `${item.server ?? ''}/${item.tool ?? ''}`,
        });
        break;
      case 'web_search':
        this.emit({
          type: 'tool-started',
          tool: 'web-search',
          detail: String(item.query ?? ''),
        });
        break;
      case 'file_change':
        this.emit({
          type: 'file-change',
          files: ((item.changes as { path: string }[] | undefined) ?? []).map((c) => c.path),
        });
        break;
      // 'error' items are non-fatal; todo_list carries no state signal.
    }
  }

  /** Codex names the thread in the session index after the first turn; pick it up. */
  private async refreshName(): Promise<void> {
    const id = this.thread.id;
    if (!id) return;
    try {
      const name = await this.indexLookup(id);
      if (name) this.name_ = name;
    } catch {
      // name is cosmetic; ignore index read errors
    }
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }
}

async function lookupThreadName(id: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(SESSION_INDEX, 'utf8');
  } catch {
    return null;
  }
  const lines = content.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const rec = JSON.parse(lines[i]) as { id?: string; thread_name?: string };
      if (rec.id === id) return rec.thread_name ?? null;
    } catch {
      // skip malformed lines
    }
  }
  return null;
}

export class CodexAdapter implements HarnessAdapter {
  readonly name = 'codex';
  private readonly codex: CodexLike;

  constructor(private readonly options: CodexAdapterOptions = {}, codex?: CodexLike) {
    this.codex = codex ?? new Codex({ config: options.extraConfig });
  }

  async listSessions(): Promise<SessionInfo[]> {
    let content: string;
    try {
      content = await readFile(SESSION_INDEX, 'utf8');
    } catch {
      return [];
    }
    const sessions: SessionInfo[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as {
          id?: string;
          thread_name?: string;
          updated_at?: string;
        };
        if (rec.id) {
          sessions.push({ id: rec.id, name: rec.thread_name, updatedAt: rec.updated_at });
        }
      } catch {
        // skip malformed lines
      }
    }
    // newest last in the file; expose newest first
    return sessions.reverse();
  }

  async createSession(opts: CreateSessionOptions): Promise<AgentSession> {
    const thread = await this.codex.startThread(this.threadOptions(opts.cwd));
    return new CodexAgentSession(thread, undefined, lookupThreadName);
  }

  async resumeSession(id: string, opts: { cwd: string }): Promise<AgentSession> {
    const thread = await this.codex.resumeThread(id, this.threadOptions(opts.cwd));
    return new CodexAgentSession(thread, undefined, lookupThreadName);
  }

  private threadOptions(cwd: string): Record<string, unknown> {
    const options: Record<string, unknown> = {
      workingDirectory: cwd,
      skipGitRepoCheck: true,
    };
    const { model, sandboxMode, approvalPolicy, modelReasoningEffort } = this.options;
    if (model) options.model = model;
    if (sandboxMode) options.sandboxMode = sandboxMode;
    if (approvalPolicy) options.approvalPolicy = approvalPolicy;
    if (modelReasoningEffort) options.modelReasoningEffort = modelReasoningEffort;
    return options;
  }
}
