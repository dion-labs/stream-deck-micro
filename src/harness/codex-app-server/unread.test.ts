import { describe, expect, it } from 'vitest';
import {
  CodexUnreadAttentionSync,
  parseCodexUnreadThreadIds,
} from './unread.js';

function state(local: unknown): unknown {
  return {
    'electron-persisted-atom-state': {
      'unread-thread-ids-by-host-v1': { local },
    },
  };
}

describe('Codex unread state', () => {
  it('parses the local notification-dot thread IDs', () => {
    expect([...parseCodexUnreadThreadIds(state(['thread-a', 'thread-b']))!])
      .toEqual(['thread-a', 'thread-b']);
    expect([...parseCodexUnreadThreadIds(state([]))!]).toEqual([]);
  });

  it('fails closed when Codex state is missing or changes shape', () => {
    expect(parseCodexUnreadThreadIds({})).toBeNull();
    expect(parseCodexUnreadThreadIds(state('thread-a'))).toBeNull();
    expect(parseCodexUnreadThreadIds(state(['thread-a', 2]))).toBeNull();
  });

  it('waits for the write grace before clearing attention absent from Codex', () => {
    const sync = new CodexUnreadAttentionSync(3_000);
    const attention = [{ index: 2, sessionId: 'thread-a' }];
    sync.track(attention, 1_000);

    expect(sync.acknowledgeable(attention, new Set(), 3_999)).toEqual([]);
    expect(sync.acknowledgeable(attention, new Set(), 4_000)).toEqual([2]);
  });

  it('keeps attention while Codex still shows its notification dot', () => {
    const sync = new CodexUnreadAttentionSync(0);
    const attention = [{ index: 4, sessionId: 'thread-a' }];

    expect(sync.acknowledgeable(attention, new Set(['thread-a']), 1_000)).toEqual([]);
    expect(sync.acknowledgeable(attention, new Set(), 1_001)).toEqual([4]);
  });
});
