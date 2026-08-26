import type {
  AgentSession,
  CreateSessionOptions,
  HarnessAdapter,
  SessionEvent,
  SessionInfo,
} from '../../core/types.js';
import { ExternalThreadMonitor, type MonitoredThread } from './monitor.js';
import { RpcConnection } from './rpc.js';

export type { MonitoredThread } from './monitor.js';

/** The connection surface the adapter needs — faked in unit tests. */
export interface AppServerConn {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  onNotification(cb: (method: string, params: unknown) => void): () => void;
  notify?(method: string, params?: unknown): void;
  close(): void;
}

export function spawnAppServerConn(endpoint?: string): AppServerConn {
  const conn = endpoint
    ? RpcConnection.webSocket(endpoint)
    : RpcConnection.spawn('codex', ['app-server']);
  return {
    request: (m, p, t) => conn.request(m, p, t),
    onNotification: (cb) => {
      conn.on('notification', cb);
      return () => {}; // connection lives for the daemon's lifetime
    },
    notify: (m, p) => conn.notify(m, p),
    close: () => conn.close(),
  };
}

export class WriterHeldError extends Error {
  constructor(threadId: string) {
    super(
      `thread ${threadId} already has an active writer (open in another Codex window); ` +
        'close it there to control it from the deck',
    );
    this.name = 'WriterHeldError';
  }
}

interface TurnPayload {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
}

/** A thread this daemon owns: full control + notification-driven state. */
class AppServerSession implements AgentSession {
  name_: string | null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private waiter: { turnId: string; resolve: () => void; reject: (e: Error) => void } | null = null;
  /** True from send() entry until its turn settles — closes the pre-waiter race. */
  private sending = false;
  /** Terminal state of a turn that completed before send() registered its waiter. */
  private completedTurn: { turnId: string; failed: boolean; error?: string } | null = null;

  constructor(
    private readonly conn: AppServerConn,
    readonly threadId: string,
    name: string | null,
  ) {
    this.name_ = name;
  }

  get sessionId(): string | null {
    return this.threadId;
  }

  get name(): string | null {
    return this.name_;
  }

  async send(prompt: string, signal?: AbortSignal): Promise<void> {
    if (this.sending) throw new Error('a turn is already running on this session');
    this.sending = true;
    const resp = (await this.conn.request('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: prompt }],
    })) as { turn?: TurnPayload };
    const turnId = resp.turn?.id;
    if (!turnId) {
      this.sending = false;
      throw new Error('turn/start returned no turn id');
    }
    signal?.addEventListener('abort', () => this.interrupt(), { once: true });
    return new Promise<void>((resolve, reject) => {
      this.waiter = { turnId, resolve, reject };
      // fast turns can complete between the response and this registration
      if (this.completedTurn?.turnId === turnId) {
        const done = this.completedTurn;
        this.consume();
        if (done.failed) reject(new Error(done.error ?? 'turn failed'));
        else resolve();
      }
    });
  }

  private consume(): void {
    this.completedTurn = null;
    this.waiter = null;
    this.sending = false;
  }

  interrupt(): void {
    if (!this.waiter) return;
    void this.conn
      .request('turn/interrupt', { threadId: this.threadId, turnId: this.waiter.turnId })
      .catch(() => {
        // turn may have ended already; the waiter resolves via turn/completed
      });
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.interrupt();
    this.listeners.clear();
  }

  /** Called by the adapter's notification router for this thread. */
  handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'thread/name/updated':
        this.updateName((params.name as string) ?? null);
        break;
      case 'turn/started':
        this.emit({ type: 'turn-started' });
        break;
      case 'turn/completed': {
        const turn = params.turn as TurnPayload | undefined;
        this.emit(
          turn?.status === 'failed'
            ? { type: 'turn-failed', error: turn.error?.message ?? 'turn failed' }
            : { type: 'turn-completed' },
        );
        if (this.waiter && this.waiter.turnId === turn?.id) {
          const { resolve, reject } = this.waiter;
          const failed = turn?.status === 'failed';
          this.consume();
          if (failed) reject(new Error(turn?.error?.message ?? 'turn failed'));
          else resolve();
        } else if (turn?.id) {
          this.completedTurn = {
            turnId: turn.id,
            failed: turn.status === 'failed',
            error: turn.error?.message,
          };
        }
        break;
      }
      case 'item/started':
      case 'item/completed':
      case 'item/updated':
        this.dispatchItem(params.item as { type?: string } & Record<string, unknown> | undefined);
        break;
    }
  }

  updateName(name: string | null): void {
    if (!name || name === this.name_) return;
    this.name_ = name;
    this.emit({ type: 'meta', name });
  }

  private dispatchItem(item: { type?: string } & Record<string, unknown> | undefined): void {
    switch (item?.type) {
      case 'reasoning':
        this.emit({ type: 'reasoning' });
        break;
      case 'agentMessage':
        this.emit({ type: 'agent-message', text: String(item.text ?? '') });
        break;
      case 'commandExecution':
        this.emit({ type: 'tool-started', tool: 'shell', detail: String(item.command ?? '') });
        break;
      case 'mcpToolCall':
        this.emit({
          type: 'tool-started',
          tool: String(item.tool ?? 'mcp'),
          detail: `${item.server ?? ''}/${item.tool ?? ''}`,
        });
        break;
      case 'webSearch':
        this.emit({ type: 'tool-started', tool: 'web-search', detail: String(item.query ?? '') });
        break;
      case 'fileChange':
        this.emit({
          type: 'file-change',
          files: ((item.changes as { path: string }[] | undefined) ?? []).map((c) => c.path),
        });
        break;
      // userMessage/error/todoList carry no key-state signal
    }
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }
}

/**
 * A thread currently owned by another Codex window. It remains observable and
 * tries to acquire the writer lazily when the deck sends, so closing the other
 * window does not require restarting this daemon.
 */
class MonitorSession implements AgentSession {
  private listeners = new Set<(e: SessionEvent) => void>();
  private monitorUnsubscribe: () => void;
  private ownedUnsubscribe: (() => void) | null = null;
  private owned: AgentSession | null = null;
  private acquiring: Promise<AgentSession> | null = null;
  private disposed = false;
  private name_: string | null;

  constructor(
    private readonly monitor: ExternalThreadMonitor,
    readonly threadId: string,
    initialName: string | null,
    private readonly acquire: () => Promise<AgentSession>,
  ) {
    this.name_ = initialName;
    this.monitorUnsubscribe = monitor.watch(threadId, (event) => {
      if (event.type === 'meta' && event.name) this.name_ = event.name;
      this.emit(event);
    });
  }

  get sessionId(): string | null {
    return this.threadId;
  }

  get name(): string | null {
    return this.owned?.name ?? this.name_;
  }

  async send(prompt: string, signal?: AbortSignal): Promise<void> {
    const session = await this.ensureOwned();
    return session.send(prompt, signal);
  }

  interrupt(): void {
    this.owned?.interrupt();
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.disposed = true;
    this.monitorUnsubscribe();
    this.ownedUnsubscribe?.();
    this.owned?.dispose();
    this.listeners.clear();
  }

  private async ensureOwned(): Promise<AgentSession> {
    if (this.owned) return this.owned;
    if (this.disposed) throw new Error(`session ${this.threadId} is disposed`);
    if (this.acquiring) return this.acquiring;

    const pending = this.acquire().then((session) => {
      if (this.disposed) {
        session.dispose();
        throw new Error(`session ${this.threadId} is disposed`);
      }
      this.monitorUnsubscribe();
      this.ownedUnsubscribe = session.onEvent((e) => this.emit(e));
      this.owned = session;
      return session;
    });
    this.acquiring = pending;
    try {
      return await pending;
    } finally {
      if (this.acquiring === pending) this.acquiring = null;
    }
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

interface ThreadRecord {
  id: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
  updatedAt?: number | null;
  ephemeral?: boolean;
  path?: string | null;
}

export interface AppServerAdapterOptions {
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  endpoint?: string;
}

export class AppServerAdapter implements HarnessAdapter {
  readonly name = 'codex-app-server';
  private conn: AppServerConn;
  private readonly sessions = new Map<string, AppServerSession>();
  private readonly monitor: ExternalThreadMonitor;
  private initialized = false;

  constructor(
    private readonly options: AppServerAdapterOptions = {},
    conn?: AppServerConn,
  ) {
    this.conn = conn ?? spawnAppServerConn(options.endpoint);
    this.monitor = new ExternalThreadMonitor(async () => {
      try {
        await this.ensureInit();
        const resp = (await this.conn.request('thread/list', { limit: 50 })) as {
          data?: MonitoredThread[];
        };
        return (resp.data ?? []).map(normalizeThreadRecord);
      } catch {
        return [];
      }
    });
    this.bindNotifications();
  }

  private bindNotifications(): void {
    this.conn.onNotification((method, params) => {
      const record = (params ?? {}) as Record<string, unknown>;
      const threadId =
        (record.threadId as string | undefined) ??
        ((record.thread as { id?: string } | undefined)?.id ?? '');
      if (!threadId) return;
      this.sessions.get(threadId)?.handleNotification(method, record);
    });
  }

  /** Rebuild transport after an explicit managed-server update; callers restore bindings afterwards. */
  reconnect(conn?: AppServerConn): void {
    this.dispose();
    this.conn = conn ?? spawnAppServerConn(this.options.endpoint);
    this.initialized = false;
    this.bindNotifications();
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    await this.conn.request('initialize', {
      clientInfo: { name: 'stream-deck-micro', title: 'Stream Deck Micro', version: '0.2.0' },
    });
    this.conn.notify?.('initialized');
    this.initialized = true;
  }

  async listSessions(): Promise<SessionInfo[]> {
    const records = await this.listThreadRecords();
    return records
      .filter((t) => !t.ephemeral)
      .map((t) => ({
        id: t.id,
        name: t.name ?? undefined,
        updatedAt: t.updatedAt ? new Date(t.updatedAt * 1000).toISOString() : undefined,
      }));
  }

  /** Raw thread records (used by the external monitor and attach flows). */
  async listThreadRecords(): Promise<ThreadRecord[]> {
    await this.ensureInit();
    const resp = (await this.conn.request('thread/list', { limit: 50 })) as {
      data?: ThreadRecord[];
    };
    const records = (resp.data ?? []).map(normalizeThreadRecord);
    for (const record of records) {
      this.sessions.get(record.id)?.updateName(record.name ?? null);
      this.monitor.provideThread(record);
    }
    return records;
  }

  async createSession(opts: CreateSessionOptions): Promise<AgentSession> {
    await this.ensureInit();
    const resp = (await this.conn.request('thread/start', {
      cwd: opts.cwd,
      approvalPolicy: this.options.approvalPolicy ?? 'never',
      sandbox: this.options.sandbox ?? 'workspace-write',
    })) as { thread?: { id?: string; name?: string | null } };
    const id = resp.thread?.id;
    if (!id) throw new Error('thread/start returned no thread id');
    return this.register(new AppServerSession(this.conn, id, resp.thread?.name ?? null));
  }

  async resumeSession(id: string, opts: { cwd: string }): Promise<AgentSession> {
    await this.ensureInit();
    try {
      const resp = (await this.conn.request('thread/resume', {
        threadId: id,
        cwd: opts.cwd,
      })) as { thread?: { id?: string; name?: string | null } };
      const threadId = resp.thread?.id ?? id;
      return this.register(new AppServerSession(this.conn, threadId, resp.thread?.name ?? null));
    } catch (e) {
      if (String(e).includes('already has an active writer')) throw new WriterHeldError(id);
      throw e;
    }
  }

  /** Bind an externally-owned thread and lazily re-acquire it when available. */
  monitorSession(thread: MonitoredThread): AgentSession {
    const session = new MonitorSession(this.monitor, thread.id, thread.name ?? null, () =>
      this.resumeSession(thread.id, { cwd: thread.cwd ?? process.cwd() }),
    );
    this.monitor.provideThread(thread);
    return session;
  }

  private register(session: AppServerSession): AppServerSession {
    this.sessions.set(session.threadId, session);
    return session;
  }

  dispose(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.monitor.dispose();
    this.conn.close();
  }
}

function previewLabel(preview: string): string {
  const squeezed = preview.replace(/\s+/g, ' ').trim();
  return squeezed.length > 28 ? `${squeezed.slice(0, 28)}…` : squeezed;
}

function normalizeThreadRecord(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    name: thread.name ?? (thread.preview ? previewLabel(thread.preview) : null),
  };
}
