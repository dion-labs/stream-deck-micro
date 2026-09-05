import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ exists: vi.fn(), mkdir: vi.fn(), write: vi.fn(), read: vi.fn(), load: vi.fn(), shared: vi.fn(), ensure: vi.fn(), service: vi.fn(), auto: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: m.exists, mkdirSync: m.mkdir, writeFileSync: m.write }));
vi.mock('node:os', () => ({ homedir: () => '/demo' }));
vi.mock('./config.js', () => ({ APP_DIR: '/demo/.stream-deck-micro', loadConfig: m.load }));
vi.mock('./sharedRuntime.js', () => ({ readSharedInstall: m.read, SHARED_INSTALL_STATE: '/demo/shared.json' }));
vi.mock('./sharedServer.js', () => ({ installSharedServer: m.shared }));
vi.mock('./marketplaceService.js', () => ({ ensureMarketplaceService: m.ensure, installMarketplaceService: m.service }));
vi.mock('./desktopAutoconnect.js', () => ({ installDesktopAutoconnect: m.auto }));
import { setupNativeApp } from './nativeSetup.js';
const configPath = '/demo/.stream-deck-micro/config.json';
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('SDM_NATIVE_BUNDLE', '/Applications/Codex + Stream Deck.app'); m.exists.mockReturnValue(false); m.load.mockReturnValue({ config: { surface: { mode: 'marketplace' }, admin: { enabled: true, port: 17531 } } }); });
it('preserves an existing installation and only ensures its service', async () => {
  m.read.mockReturnValue({ configPath }); m.exists.mockReturnValue(true);
  await setupNativeApp(); expect(m.ensure).toHaveBeenCalledOnce(); expect(m.write).not.toHaveBeenCalled(); expect(m.shared).not.toHaveBeenCalled(); expect(m.service).not.toHaveBeenCalled();
});
it('rejects a transient download location before writing anything', async () => {
  vi.stubEnv('SDM_NATIVE_BUNDLE', '/demo/Downloads/Codex + Stream Deck.app');
  await expect(setupNativeApp()).rejects.toThrow('Move'); expect(m.write).not.toHaveBeenCalled();
});
it('installs the bridge CLI, not the launcher CLI, after verified setup', async () => {
  m.read.mockReturnValueOnce(null).mockReturnValue({ configPath, fingerprint: 'verified' });
  await setupNativeApp(); expect(m.shared).toHaveBeenCalledWith(configPath);
  expect(m.service).toHaveBeenCalledWith(configPath, expect.stringMatching(/\/cli\/stream-deck-micro\.js$/));
  expect(m.auto).toHaveBeenCalledOnce(); expect(m.write.mock.calls[1][1]).toContain('"autoConnect": true');
});
it('does not install a service if compatibility verification fails', async () => {
  m.shared.mockRejectedValue(new Error('unsupported Codex'));
  await expect(setupNativeApp()).rejects.toThrow('unsupported Codex'); expect(m.service).not.toHaveBeenCalled(); expect(m.auto).not.toHaveBeenCalled();
});
it('resumes a partial setup without repeating shared installation', async () => {
  m.read.mockReturnValue({ configPath });
  await setupNativeApp(); expect(m.shared).not.toHaveBeenCalled(); expect(m.service).toHaveBeenCalledOnce();
});
it('preserves custom configurations', async () => {
  m.exists.mockImplementation(p => p === configPath); m.load.mockReturnValue({ config: { surface: { mode: 'independent' }, admin: { enabled: true, port: 17531 } } });
  await expect(setupNativeApp()).rejects.toThrow('custom configuration'); expect(m.write).not.toHaveBeenCalled(); expect(m.shared).not.toHaveBeenCalled();
});
