import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCodexVersion, SharedServerVersionMonitor, type ServerVersionSource } from './serverUpdate.js';

const endpoint = 'ws://127.0.0.1:17532';
function source(): ServerVersionSource {
  return {
    managed: vi.fn(() => true),
    running: vi.fn(async () => '0.149.0-alpha.4.3'),
    bundled: vi.fn(async () => '0.150.0-alpha.8'),
  };
}
afterEach(() => vi.useRealTimers());

describe('shared server update detection', () => {
  it('parses full Desktop handshake and binary versions, rejecting unknown formats', () => {
    expect(parseCodexVersion('Codex Desktop/0.149.0-alpha.4.3 (Mac OS 26.5; arm64)')).toBe('0.149.0-alpha.4.3');
    expect(parseCodexVersion('codex-cli 0.150.0-alpha.8')).toBe('0.150.0-alpha.8');
    expect(parseCodexVersion('unrelated/0.150.0')).toBeNull();
    expect(parseCodexVersion('codex-cli unknown')).toBeNull();
  });

  it('detects a mismatch without initiating recovery', async () => {
    const monitor = new SharedServerVersionMonitor(endpoint, source());
    expect(await monitor.refresh()).toEqual({
      state: 'update-required', runningVersion: '0.149.0-alpha.4.3', bundledVersion: '0.150.0-alpha.8',
    });
  });

  it('throttles probes and rechecks immediately after an explicit update', async () => {
    vi.useFakeTimers();
    const versions = source();
    const monitor = new SharedServerVersionMonitor(endpoint, versions);
    await monitor.refresh();
    await monitor.refresh();
    expect(versions.running).toHaveBeenCalledTimes(1);
    vi.mocked(versions.running).mockResolvedValue('0.150.0-alpha.8');
    expect((await monitor.refresh(true)).state).toBe('current');
    vi.advanceTimersByTime(15_000);
    await monitor.refresh();
    expect(versions.running).toHaveBeenCalledTimes(3);
  });

  it('does not offer an update for an unmanaged endpoint or missing version', async () => {
    const versions = source();
    vi.mocked(versions.managed).mockReturnValue(false);
    expect((await new SharedServerVersionMonitor(endpoint, versions).refresh()).state).toBe('unknown');
    expect(versions.running).not.toHaveBeenCalled();
    vi.mocked(versions.managed).mockReturnValue(true);
    vi.mocked(versions.bundled).mockResolvedValue(null);
    expect((await new SharedServerVersionMonitor(endpoint, versions).refresh()).state).toBe('unknown');
  });

  it('retains a confirmed recovery screen across a temporary probe failure', async () => {
    const versions = source();
    const monitor = new SharedServerVersionMonitor(endpoint, versions);
    await monitor.refresh();
    vi.mocked(versions.running).mockRejectedValue(new Error('connection closed'));
    expect((await monitor.refresh(true)).state).toBe('update-required');
  });

  it('coalesces overlapping probes', async () => {
    const versions = source();
    const monitor = new SharedServerVersionMonitor(endpoint, versions);
    await Promise.all([monitor.refresh(), monitor.refresh(true), monitor.refresh()]);
    expect(versions.running).toHaveBeenCalledTimes(1);
  });

  it('does not treat stale matching versions as a successful recovery verification', async () => {
    const versions = source();
    vi.mocked(versions.running).mockResolvedValue('0.150.0-alpha.8');
    const monitor = new SharedServerVersionMonitor(endpoint, versions);
    expect((await monitor.refresh()).state).toBe('current');
    vi.mocked(versions.running).mockRejectedValue(new Error('offline'));
    expect((await monitor.refresh(true)).state).toBe('unknown');
  });
});
