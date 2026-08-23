import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CODEX_GLOBAL_STATE_FILE = join(
  homedir(),
  '.codex',
  '.codex-global-state.json',
);

export const CODEX_UNREAD_GRACE_MS = 3_000;

type AttentionEntry = { index: number; sessionId: string | null };

/**
 * Parse Codex Desktop's persisted notification-dot state. This is deliberately
 * strict: an unexpected app-state shape must never make Micro clear attention.
 */
export function parseCodexUnreadThreadIds(value: unknown): ReadonlySet<string> | null {
  if (!isRecord(value)) return null;
  const persisted = value['electron-persisted-atom-state'];
  if (!isRecord(persisted)) return null;
  const byHost = persisted['unread-thread-ids-by-host-v1'];
  if (!isRecord(byHost) || !Array.isArray(byHost.local)) return null;
  if (!byHost.local.every((id) => typeof id === 'string')) return null;
  return new Set(byHost.local);
}

export function readCodexUnreadThreadIds(
  path = CODEX_GLOBAL_STATE_FILE,
): ReadonlySet<string> | null {
  try {
    return parseCodexUnreadThreadIds(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/** Polling tolerates Codex replacing the state file atomically during writes. */
export class CodexUnreadMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path = CODEX_GLOBAL_STATE_FILE,
    private readonly intervalMs = 1_000,
  ) {}

  start(onSnapshot: (threadIds: ReadonlySet<string>) => void): void {
    if (this.timer) return;
    const poll = () => {
      const threadIds = readCodexUnreadThreadIds(this.path);
      if (threadIds) onSnapshot(threadIds);
    };
    poll();
    this.timer = setInterval(poll, this.intervalMs);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Prevent a completion from being acknowledged during the small interval in
 * which Micro has observed it but Codex has not persisted its unread dot yet.
 */
export class CodexUnreadAttentionSync {
  private readonly eligibleAtBySession = new Map<string, number>();

  constructor(private readonly graceMs = CODEX_UNREAD_GRACE_MS) {}

  track(entries: AttentionEntry[], now = Date.now()): void {
    const active = new Set<string>();
    for (const entry of entries) {
      if (!entry.sessionId) continue;
      active.add(entry.sessionId);
      if (!this.eligibleAtBySession.has(entry.sessionId)) {
        this.eligibleAtBySession.set(entry.sessionId, now + this.graceMs);
      }
    }
    for (const sessionId of this.eligibleAtBySession.keys()) {
      if (!active.has(sessionId)) this.eligibleAtBySession.delete(sessionId);
    }
  }

  acknowledgeable(
    entries: AttentionEntry[],
    unreadThreadIds: ReadonlySet<string>,
    now = Date.now(),
  ): number[] {
    this.track(entries, now);
    return entries
      .filter((entry): entry is AttentionEntry & { sessionId: string } => Boolean(entry.sessionId))
      .filter((entry) => (this.eligibleAtBySession.get(entry.sessionId) ?? Infinity) <= now)
      .filter((entry) => !unreadThreadIds.has(entry.sessionId))
      .map((entry) => entry.index);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
