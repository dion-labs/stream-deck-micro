import { expect, it, vi } from 'vitest';
import { launchDesktop, type LauncherDependencies } from './desktopLauncher.js';
import type { DesktopSharedInstall } from './sharedRuntime.js';
const install = { fingerprint: 'verified', autoConnect: true } as DesktopSharedInstall;
function fixture() {
  const events: string[] = [];
  const deps: LauncherDependencies = {
    install: () => install,
    running: vi.fn(() => false),
    ensureService: vi.fn(async () => { events.push('service-ready'); }),
    fingerprint: vi.fn(async () => { events.push('fingerprint'); return 'verified'; }),
    verify: vi.fn(async () => { events.push('verified'); return 'updated'; }),
    open: vi.fn(async () => { events.push('open'); }),
    status: vi.fn(async () => ({ surface: 'marketplace', desktop: { state: 'connected', sessionsReady: true } })),
    wait: vi.fn(async () => {}),
  };
  return { deps, events };
}
it('waits for the service, then checks compatibility, opens and confirms session readiness', async () => {
  const { deps, events } = fixture();
  vi.mocked(deps.status).mockResolvedValueOnce({ surface: 'marketplace', desktop: { state: 'connected', sessionsReady: false } });
  expect((await launchDesktop(() => {}, deps)).state).toBe('connected');
  expect(events).toEqual(['service-ready', 'fingerprint', 'open']);
  expect(deps.wait).toHaveBeenCalledOnce();
});
it('verifies an updated build before opening the app', async () => {
  const { deps, events } = fixture(); vi.mocked(deps.fingerprint).mockResolvedValue('updated');
  await launchDesktop(() => {}, deps);
  expect(events).toEqual(['service-ready', 'verified', 'open']);
});
it.each(['service', 'verification'])('never opens if %s fails', async (failure) => {
  const { deps } = fixture();
  vi.mocked(deps.fingerprint).mockResolvedValue('updated');
  vi.mocked(failure === 'service' ? deps.ensureService : deps.verify).mockRejectedValue(new Error('failure'));
  await expect(launchDesktop(() => {}, deps)).rejects.toThrow('failure');
  expect(deps.open).not.toHaveBeenCalled();
});
it.each([true, false])('leaves an already-running app alone (connected=%s)', async (connected) => {
  const { deps } = fixture(); vi.mocked(deps.running).mockReturnValue(true);
  vi.mocked(deps.status).mockResolvedValue({ surface: 'marketplace', desktop: { state: connected ? 'connected' : 'restart-required', sessionsReady: connected } });
  expect((await launchDesktop(() => {}, deps)).state).toBe(connected ? 'connected' : 'already-running');
  expect(deps.fingerprint).not.toHaveBeenCalled(); expect(deps.verify).not.toHaveBeenCalled(); expect(deps.open).not.toHaveBeenCalled();
});
it('handles ChatGPT opening elsewhere while verification runs', async () => {
  const { deps } = fixture(); vi.mocked(deps.running).mockReturnValueOnce(false).mockReturnValue(true);
  await launchDesktop(() => {}, deps);
  expect(deps.open).not.toHaveBeenCalled();
});
it('bounds connection waiting without a second open or a restart', async () => {
  const { deps } = fixture();
  vi.mocked(deps.status).mockResolvedValue({ surface: 'marketplace', desktop: { state: 'connecting', sessionsReady: false } });
  await expect(launchDesktop(() => {}, deps)).rejects.toThrow('no sessions were restarted');
  expect(deps.open).toHaveBeenCalledOnce(); expect(deps.status).toHaveBeenCalledTimes(60);
});
it('reports private fallback without reopening ChatGPT', async () => {
  const { deps } = fixture();
  vi.mocked(deps.status).mockResolvedValue({ surface: 'marketplace', desktop: { state: 'unavailable', sessionsReady: false, message: 'Compatibility failed' } });
  await expect(launchDesktop(() => {}, deps)).rejects.toThrow('Compatibility failed');
  expect(deps.open).toHaveBeenCalledOnce(); expect(deps.wait).not.toHaveBeenCalled();
});

it('can prepare the Control Center without starting or verifying Codex', async () => {
  const { prepareControlCenter } = await import('./desktopLauncher.js');
  const ensure = vi.fn(async () => {});
  expect((await prepareControlCenter(ensure)).state).toBe('dashboard');
  expect(ensure).toHaveBeenCalledOnce();
});
it('reports a Control Center service failure without opening Codex', async () => {
  const { prepareControlCenter } = await import('./desktopLauncher.js');
  await expect(prepareControlCenter(async () => { throw new Error('service unavailable'); })).rejects.toThrow('service unavailable');
});
