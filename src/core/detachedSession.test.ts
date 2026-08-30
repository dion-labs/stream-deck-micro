import { describe, expect, it, vi } from 'vitest';
import { DetachedSession } from './detachedSession.js';

describe('DetachedSession', () => {
  it('preserves identity without emitting activity', async () => {
    const session = new DetachedSession('thread-1', 'Saved task');
    const listener = vi.fn();

    expect(session.sessionId).toBe('thread-1');
    expect(session.name).toBe('Saved task');
    expect(session.onEvent(listener)).toBeTypeOf('function');
    expect(listener).not.toHaveBeenCalled();
    await expect(session.send()).rejects.toThrow('navigation only');
  });
});
