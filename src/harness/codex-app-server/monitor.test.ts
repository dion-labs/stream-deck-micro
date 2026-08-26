import { describe, expect, it, vi } from 'vitest';
import { ExternalThreadMonitor } from './monitor.js';
import type { SessionEvent } from '../../core/types.js';

describe('ExternalThreadMonitor replacement subscriptions', () => {
  it.each([false, true])('ignores stale unsubscribe after replacement (dispose first: %s)', async (disposeFirst) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    const poll = vi.fn(async () => [{
      id: 'thread-1', name: 'From poll', updatedAt: Date.now() / 1000, path: null,
    }]);
    const monitor = new ExternalThreadMonitor(poll, { pollMs: 20, quietMs: 100 });
    try {
      const oldEvents: SessionEvent[] = [];
      const replacementEvents: SessionEvent[] = [];
      const stopOld = monitor.watch('thread-1', (event) => oldEvents.push(event));
      if (disposeFirst) monitor.dispose();
      const stopReplacement = monitor.watch('thread-1', (event) => replacementEvents.push(event));

      stopOld();
      stopOld();
      monitor.provideThread({ id: 'thread-1', name: 'From catalog' });
      expect(replacementEvents).toEqual([{ type: 'meta', name: 'From catalog' }]);
      await vi.advanceTimersByTimeAsync(20);
      expect(oldEvents).toEqual([]);
      expect(replacementEvents).toEqual([
        { type: 'meta', name: 'From catalog' },
        { type: 'meta', name: 'From poll' },
        { type: 'turn-started' },
      ]);

      // Identity protection must not prevent the current owner from unsubscribing.
      stopReplacement();
      stopReplacement();
      monitor.provideThread({ id: 'thread-1', name: 'Must not be delivered' });
      await vi.advanceTimersByTimeAsync(200);
      expect(replacementEvents).toHaveLength(3);
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      monitor.dispose();
      vi.useRealTimers();
    }
  });
});
