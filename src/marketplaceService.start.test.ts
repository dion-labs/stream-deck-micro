import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), ipc: vi.fn(), exists: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), execFileSync: mocks.exec }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), existsSync: mocks.exists }));
vi.mock('./ipc.js', () => ({ ipcCall: mocks.ipc }));
import { ensureMarketplaceService } from './marketplaceService.js';
beforeEach(() => { vi.resetAllMocks(); mocks.exists.mockReturnValue(true); });
it('does not touch launchd when the bridge is already ready', async () => {
  mocks.ipc.mockResolvedValue({ surface: 'marketplace' });
  await ensureMarketplaceService(); expect(mocks.exec).not.toHaveBeenCalled();
});
it('starts a loaded service without the restart flag', async () => {
  mocks.ipc.mockRejectedValueOnce(new Error('not ready')).mockResolvedValue({ surface: 'marketplace' });
  await ensureMarketplaceService();
  expect(mocks.exec.mock.calls.map(([, args]) => args[0])).toEqual(['print', 'kickstart']);
  expect(mocks.exec.mock.calls.some(([, args]) => args.includes('-k') || args.includes('bootout'))).toBe(false);
});
it('loads a missing job and waits for readiness', async () => {
  mocks.ipc.mockRejectedValueOnce(new Error('not ready')).mockResolvedValue({ surface: 'marketplace' });
  mocks.exec.mockImplementationOnce(() => { throw new Error('not loaded'); });
  await ensureMarketplaceService();
  expect(mocks.exec.mock.calls.map(([, args]) => args[0])).toEqual(['print', 'bootstrap', 'kickstart']);
});
it('does not replace an independent daemon', async () => {
  mocks.ipc.mockResolvedValue({ surface: 'independent' });
  await expect(ensureMarketplaceService()).rejects.toThrow('Another Micro surface');
  expect(mocks.exec).not.toHaveBeenCalled();
});
it('requires an installed service rather than changing the configuration', async () => {
  mocks.ipc.mockRejectedValue(new Error('offline')); mocks.exists.mockReturnValue(false);
  await expect(ensureMarketplaceService()).rejects.toThrow('Install the Marketplace');
  expect(mocks.exec).not.toHaveBeenCalled();
});
