import {
  closeSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CODEX_DESKTOP_LOG_ROOT = join(
  homedir(),
  'Library',
  'Logs',
  'com.openai.codex',
);

const THREAD_ACTIVITY_EVENT = 'thread_stream_view_activity_changed';
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAIN_PROCESS_LOG = /-t0-.*\.log$/;

export interface CodexDesktopThreadActivity {
  active: boolean;
  conversationId: string;
  windowId: string;
  primary: boolean;
  focused: boolean;
  visible: boolean;
}

/**
 * Parse the narrow Desktop activity event used for focus synchronization.
 * Missing or changed fields fail closed so an unrelated log line can never
 * change Micro's selected session.
 */
export function parseCodexDesktopThreadActivity(
  line: string,
): CodexDesktopThreadActivity | null {
  if (!line.includes(THREAD_ACTIVITY_EVENT)) return null;
  const fields = new Map<string, string>();
  const tokens = line.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g);
  for (const token of tokens) fields.set(token[1], token[2]);

  const active = parseBoolean(fields.get('active'));
  const focused = parseBoolean(fields.get('rendererWindowFocused'));
  const visible = parseBoolean(fields.get('rendererWindowVisible'));
  const conversationId = fields.get('conversationId');
  const windowId = fields.get('rendererWindowId');
  const appearance = fields.get('rendererWindowAppearance');
  if (
    active === null
    || focused === null
    || visible === null
    || !conversationId
    || !THREAD_ID.test(conversationId)
    || !windowId
    || !appearance
  ) {
    return null;
  }

  return {
    active,
    conversationId,
    windowId,
    primary: appearance === 'primary',
    focused,
    visible,
  };
}

/** Pick the newest Codex main-process log from today or yesterday. */
export function findCurrentCodexDesktopLog(
  root = CODEX_DESKTOP_LOG_ROOT,
  now = new Date(),
): string | null {
  const candidates: { path: string; modifiedAt: number }[] = [];
  for (const date of [now, previousDay(now)]) {
    const directory = join(
      root,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    );
    try {
      for (const name of readdirSync(directory)) {
        if (!MAIN_PROCESS_LOG.test(name)) continue;
        const path = join(directory, name);
        candidates.push({ path, modifiedAt: statSync(path).mtimeMs });
      }
    } catch {
      // Codex may not have created this date directory yet.
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.path ?? null;
}

type LogLocator = () => string | null;

/**
 * Best-effort tailer for Codex Desktop's focused thread. It follows log
 * rotation and only emits focused, visible activations from the primary window.
 */
export class CodexDesktopFocusMonitor {
  private timer: NodeJS.Timeout | null = null;
  private path: string | null = null;
  private offset = 0;
  private carry = '';
  private lastEmitted: string | null = null;
  private readonly activeThreadByWindow = new Map<string, string>();

  constructor(
    private readonly locateLog: LogLocator = () => findCurrentCodexDesktopLog(),
    private readonly intervalMs = 500,
  ) {}

  start(onFocus: (threadId: string) => void): void {
    if (this.timer) return;
    const poll = () => this.poll(onFocus);
    poll();
    this.timer = setInterval(poll, this.intervalMs);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(onFocus: (threadId: string) => void): void {
    const nextPath = this.locateLog();
    if (!nextPath) return;

    try {
      const size = statSync(nextPath).size;
      if (nextPath !== this.path || size < this.offset) {
        this.path = nextPath;
        this.offset = 0;
        this.carry = '';
        this.activeThreadByWindow.clear();
      }
      if (size === this.offset) return;

      const bytes = Buffer.alloc(size - this.offset);
      const descriptor = openSync(nextPath, 'r');
      let bytesRead = 0;
      try {
        bytesRead = readSync(descriptor, bytes, 0, bytes.length, this.offset);
      } finally {
        closeSync(descriptor);
      }
      this.offset += bytesRead;
      const lines = `${this.carry}${bytes.subarray(0, bytesRead).toString('utf8')}`.split(/\r?\n/);
      this.carry = lines.pop() ?? '';

      let latestActivation: { threadId: string; windowId: string } | null = null;
      for (const line of lines) {
        const activity = parseCodexDesktopThreadActivity(line);
        if (!activity || !activity.primary) continue;
        if (!activity.active) {
          if (this.activeThreadByWindow.get(activity.windowId) === activity.conversationId) {
            this.activeThreadByWindow.delete(activity.windowId);
          }
          if (
            latestActivation?.windowId === activity.windowId
            && latestActivation.threadId === activity.conversationId
          ) {
            latestActivation = null;
          }
          continue;
        }
        if (!activity.focused || !activity.visible) continue;
        this.activeThreadByWindow.set(activity.windowId, activity.conversationId);
        latestActivation = { threadId: activity.conversationId, windowId: activity.windowId };
      }

      if (latestActivation && latestActivation.threadId !== this.lastEmitted) {
        this.lastEmitted = latestActivation.threadId;
        onFocus(latestActivation.threadId);
      }
    } catch {
      // Logs are advisory. Rotation, partial writes, or format changes must not
      // disturb the existing selection or the shared App Server connection.
    }
  }
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function previousDay(now: Date): Date {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  return date;
}
