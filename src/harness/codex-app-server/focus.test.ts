import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexDesktopFocusMonitor,
  findCurrentCodexDesktopLog,
  parseCodexDesktopThreadActivity,
} from './focus.js';

const THREAD_A = '01a02920-eba5-7221-8e89-f2ca07165f0c';
const THREAD_B = '01a032fb-e13b-7311-93fc-978d8b65c57e';

function activity(conversationId: string, active: boolean): string {
  return `2026-08-25T06:20:43.967Z info [electron-message-handler] `
    + `thread_stream_view_activity_changed active=${active} conversationId=${conversationId} `
    + `rendererWebContentsId=1 rendererWindowAppearance=primary rendererWindowFocused=true `
    + 'rendererWindowId=1 rendererWindowVisible=true resumeState=resumed streamRole=owner\n';
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Codex Desktop focus events', () => {
  it('parses the exact primary-window activity fields', () => {
    expect(parseCodexDesktopThreadActivity(activity(THREAD_A, true))).toEqual({
      active: true,
      conversationId: THREAD_A,
      windowId: '1',
      primary: true,
      focused: true,
      visible: true,
    });
  });

  it('fails closed on unrelated or malformed activity', () => {
    expect(parseCodexDesktopThreadActivity('ordinary log line')).toBeNull();
    expect(parseCodexDesktopThreadActivity(activity('not-a-thread', true))).toBeNull();
    expect(parseCodexDesktopThreadActivity(
      activity(THREAD_A, true).replace('rendererWindowFocused=true ', ''),
    )).toBeNull();
  });

  it('finds the newest main-process log across a date boundary', () => {
    const root = temporaryDirectory();
    const yesterday = join(root, '2026', '08', '24');
    const today = join(root, '2026', '08', '25');
    mkdirSync(yesterday, { recursive: true });
    mkdirSync(today, { recursive: true });
    const older = join(yesterday, 'codex-desktop-old-1-t0-i1-000000-0.log');
    const newer = join(today, 'codex-desktop-new-2-t0-i1-000000-0.log');
    const worker = join(today, 'codex-desktop-worker-3-t1-i1-000000-0.log');
    writeFileSync(older, 'old');
    writeFileSync(newer, 'new');
    writeFileSync(worker, 'worker');
    utimesSync(older, new Date(1_000), new Date(1_000));
    utimesSync(newer, new Date(2_000), new Date(2_000));
    utimesSync(worker, new Date(3_000), new Date(3_000));

    expect(findCurrentCodexDesktopLog(root, new Date(2026, 7, 25, 12))).toBe(newer);
  });

  it('replays only the latest active thread and follows appended switches', () => {
    vi.useFakeTimers();
    const path = join(temporaryDirectory(), 'codex.log');
    writeFileSync(path, activity(THREAD_A, true) + activity(THREAD_A, false) + activity(THREAD_B, true));
    const focused: string[] = [];
    const monitor = new CodexDesktopFocusMonitor(() => path, 100);

    monitor.start((threadId) => focused.push(threadId));
    expect(focused).toEqual([THREAD_B]);

    appendFileSync(path, activity(THREAD_B, false) + activity(THREAD_A, true));
    vi.advanceTimersByTime(100);
    expect(focused).toEqual([THREAD_B, THREAD_A]);
    monitor.close();
  });

  it('does not replay a thread whose final activity event is inactive', () => {
    vi.useFakeTimers();
    const path = join(temporaryDirectory(), 'codex.log');
    writeFileSync(path, activity(THREAD_A, true) + activity(THREAD_A, false));
    const focused: string[] = [];
    const monitor = new CodexDesktopFocusMonitor(() => path, 100);

    monitor.start((threadId) => focused.push(threadId));
    expect(focused).toEqual([]);
    monitor.close();
  });

  it('ignores hidden and secondary-window activations and follows rotation', () => {
    vi.useFakeTimers();
    const directory = temporaryDirectory();
    const first = join(directory, 'first.log');
    const second = join(directory, 'second.log');
    writeFileSync(first, activity(THREAD_A, true));
    writeFileSync(
      second,
      activity(THREAD_B, true).replace('rendererWindowAppearance=primary', 'rendererWindowAppearance=secondary')
        + activity(THREAD_B, true).replace('rendererWindowVisible=true', 'rendererWindowVisible=false'),
    );
    let current = first;
    const focused: string[] = [];
    const monitor = new CodexDesktopFocusMonitor(() => current, 100);
    monitor.start((threadId) => focused.push(threadId));

    current = second;
    vi.advanceTimersByTime(100);
    expect(focused).toEqual([THREAD_A]);

    appendFileSync(second, activity(THREAD_B, true));
    vi.advanceTimersByTime(100);
    expect(focused).toEqual([THREAD_A, THREAD_B]);
    monitor.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'stream-deck-micro-focus-'));
  temporaryDirectories.push(directory);
  return directory;
}
