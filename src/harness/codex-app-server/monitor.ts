import { open, stat } from 'node:fs/promises';
import type { SessionEvent } from '../../core/types.js';

/** Slice of ThreadRecord the monitor needs. */
export interface MonitoredThread {
  id: string;
  name?: string | null;
  cwd?: string | null;
  /** Unix seconds, from thread/list. */
  updatedAt?: number | null;
  /** Rollout file path, from thread/list. */
  path?: string | null;
}

export interface ExternalMonitorOptions {
  pollMs?: number;
  /** How long without an updatedAt bump before an active external thread counts as idle. */
  quietMs?: number;
}

type ActivityClass = 'thinking' | 'running';

interface Watched {
  thread: MonitoredThread;
  lastUpdatedAt: number | null;
  lastBumpWallMs: number;
  active: boolean;
  lastClass: ActivityClass | null;
  emit: (e: SessionEvent) => void;
}

const TAIL_BYTES = 32768;

/**
 * Watches threads owned by other Codex windows (no writer access) by polling
 * thread/list activity and classifying the rollout file tail. Emits the same
 * SessionEvents owned sessions produce, so slots and keys need no special cases.
 */
export class ExternalThreadMonitor {
  private readonly watched = new Map<string, Watched>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly pollList: () => Promise<MonitoredThread[]> = async () => [],
    private readonly opts: ExternalMonitorOptions = {},
  ) {}

  watch(threadId: string, emit: (e: SessionEvent) => void): () => void {
    const entry: Watched = {
      thread: { id: threadId },
      lastUpdatedAt: null,
      lastBumpWallMs: 0,
      active: false,
      lastClass: null,
      emit,
    };
    this.watched.set(threadId, entry);
    this.ensureTimer();
    return () => {
      if (this.watched.get(threadId) === entry) this.watched.delete(threadId);
    };
  }

  /** Seed/refresh the record for a watched thread (id, name, path from thread/list). */
  provideThread(thread: MonitoredThread): void {
    const entry = this.watched.get(thread.id);
    if (!entry) return;
    const previousName = entry.thread.name ?? null;
    entry.thread = { ...entry.thread, ...thread };
    if (thread.name && thread.name !== previousName) {
      entry.emit({ type: 'meta', name: thread.name });
    }
  }

  private ensureTimer(): void {
    if (this.timer || this.watched.size === 0) return;
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 2000);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (this.polling || this.watched.size === 0) return;
    this.polling = true;
    try {
      const threads = await this.pollList();
      const byId = new Map(threads.map((t) => [t.id, t]));
      const now = Date.now();
      for (const entry of this.watched.values()) {
        const fresh = byId.get(entry.thread.id);
        if (!fresh) continue;
        const previousName = entry.thread.name ?? null;
        entry.thread = { ...entry.thread, ...fresh };
        if (fresh.name && fresh.name !== previousName) {
          entry.emit({ type: 'meta', name: fresh.name });
        }
        const bumped = entry.lastUpdatedAt !== null && fresh.updatedAt !== entry.lastUpdatedAt;
        if (entry.lastUpdatedAt === null && fresh.updatedAt != null) {
          // first sighting: only treat as active if it updated within the quiet window
          const ageSec = now / 1000 - fresh.updatedAt;
          // updatedAt is normally whole Unix seconds, so allow its lost fractional second.
          if (ageSec >= 0 && ageSec < (this.opts.quietMs ?? 10000) / 1000 + 1) {
            entry.lastBumpWallMs = now;
            await this.activate(entry);
          }
          entry.lastUpdatedAt = fresh.updatedAt;
          continue;
        }
        if (bumped && fresh.updatedAt != null) {
          entry.lastBumpWallMs = now;
          if (!entry.active) await this.activate(entry);
          else await this.reclassify(entry);
          entry.lastUpdatedAt = fresh.updatedAt;
        } else if (entry.active && now - entry.lastBumpWallMs > (this.opts.quietMs ?? 10000)) {
          entry.active = false;
          entry.lastClass = null;
          entry.emit({ type: 'turn-completed' });
        }
      }
    } catch {
      // transient list failures: retry on next tick
    } finally {
      this.polling = false;
    }
  }

  private async activate(entry: Watched): Promise<void> {
    entry.active = true;
    entry.emit({ type: 'turn-started' });
    await this.reclassify(entry);
  }

  private async reclassify(entry: Watched): Promise<void> {
    const path = entry.thread.path;
    if (!path) return;
    const cls = await classifyRolloutTail(path);
    if (!cls || cls === entry.lastClass) return;
    entry.lastClass = cls;
    entry.emit(
      cls === 'thinking'
        ? { type: 'reasoning' }
        : { type: 'tool-started', tool: 'activity', detail: '(external window)' },
    );
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watched.clear();
  }
}

/**
 * Classify what an externally-driven thread is doing from the tail of its
 * rollout file. Pure-ish (reads the file); exported for tests.
 */
export async function classifyRolloutTail(path: string): Promise<ActivityClass | null> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return null;
  }
  if (size === 0) return null;
  const fh = await open(path, 'r');
  try {
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await fh.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    // walk backwards; unparseable lines (partial writes, truncation edge) are skipped
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      let rec: { payload?: { type?: string } };
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const kind = rec.payload?.type;
      if (!kind) continue;
      if (RUNNING_KINDS.has(kind)) return 'running';
      if (THINKING_KINDS.has(kind)) return 'thinking';
    }
    return null;
  } finally {
    await fh.close();
  }
}

// rollout payload types observed in codex 0.145–0.149 sessions
const RUNNING_KINDS = new Set([
  'function_call',
  'custom_tool_call',
  'local_shell_call',
  'exec_command_begin',
  'exec_command_end',
  'apply_patch_call',
  'mcp_tool_call_begin',
  'mcp_tool_call_end',
  'unified_exec_begin',
  'unified_exec_end',
  'web_search_begin',
  'web_search_end',
]);

const THINKING_KINDS = new Set(['reasoning', 'message', 'agent_message', 'plan_update', 'todo_list']);
