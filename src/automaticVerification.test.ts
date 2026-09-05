import { expect, it, vi } from 'vitest';
import { verifyAutomaticDesktop } from './automaticVerification.js';
import type { DesktopSharedInstall } from './sharedRuntime.js';
const install: DesktopSharedInstall = {
  mode: 'desktop-launch', url: 'ws://127.0.0.1:17532', codexPath: '/test/codex', configPath: '/test/config',
  launcherPath: '/test/launcher', fingerprint: 'old', version: 'old', token: 'test', autoConnect: true,
};
function fixture() {
  return {
    fingerprint: vi.fn(async () => 'new'),
    verify: vi.fn(async () => ({ version: 'new', checks: ['passed'] })),
    readInstall: vi.fn((): DesktopSharedInstall | null => ({ ...install })), save: vi.fn(), wait: vi.fn(async (_ms: number, _signal?: AbortSignal) => {}),
  };
}
it('retries a transient failure before saving a successfully checked build', async () => {
  const deps = fixture(); deps.verify.mockRejectedValueOnce(new Error('ECONNRESET'));
  expect(await verifyAutomaticDesktop(install, deps)).toBe('new');
  expect(deps.verify).toHaveBeenCalledTimes(2);
  expect(deps.wait).toHaveBeenCalledWith(500, undefined);
  expect(deps.save).toHaveBeenCalledExactlyOnceWith({ ...install, fingerprint: 'new', version: 'new', verificationGeneration: expect.any(String) });
});
it('bounds repeated transport failures without approving the build', async () => {
  const deps = fixture(); deps.verify.mockRejectedValue(new Error('request timed out'));
  await expect(verifyAutomaticDesktop(install, deps)).rejects.toThrow('timed out');
  expect(deps.verify).toHaveBeenCalledTimes(3);
  expect(deps.wait.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  expect(deps.save).not.toHaveBeenCalled();
});
it('never retries or approves a failed compatibility assertion', async () => {
  const deps = fixture(); deps.verify.mockRejectedValue(new Error('App Server did not reject an unauthenticated WebSocket'));
  await expect(verifyAutomaticDesktop(install, deps)).rejects.toThrow('unauthenticated');
  expect(deps.verify).toHaveBeenCalledTimes(1);
  expect(deps.wait).not.toHaveBeenCalled(); expect(deps.save).not.toHaveBeenCalled();
});
it('rechecks an update that changes while the probe runs', async () => {
  const deps = fixture(); deps.fingerprint.mockResolvedValueOnce('updating');
  await verifyAutomaticDesktop(install, deps);
  expect(deps.verify).toHaveBeenCalledTimes(2);
  expect(deps.save).toHaveBeenCalledExactlyOnceWith({ ...install, fingerprint: 'new', version: 'new', verificationGeneration: expect.any(String) });
});
it.each(['removed', 'reinstalled', 'disabled', 'verified-elsewhere'])('does not overwrite an installation that was %s during verification', async (change) => {
  const deps = fixture();
  deps.readInstall.mockImplementation(() => change === 'removed' ? null : {
    ...install, ...(change === 'reinstalled' ? { token: 'other' } : change === 'disabled' ? { autoConnect: false } : { fingerprint: 'other' }),
  });
  await expect(verifyAutomaticDesktop(install, deps)).rejects.toThrow('installation changed');
  expect(deps.save).not.toHaveBeenCalled();
});
it('cancellation after a probe prevents both persistence and retries', async () => {
  const deps = fixture(); const controller = new AbortController();
  deps.verify.mockImplementation(async () => { controller.abort(); return { version: 'new', checks: [] }; });
  await expect(verifyAutomaticDesktop(install, { ...deps, signal: controller.signal })).rejects.toThrow();
  expect(deps.save).not.toHaveBeenCalled(); expect(deps.wait).not.toHaveBeenCalled();
});
it('does not start a probe after cancellation', async () => {
  const deps = fixture();
  await expect(verifyAutomaticDesktop(install, { ...deps, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(deps.verify).not.toHaveBeenCalled();
});
