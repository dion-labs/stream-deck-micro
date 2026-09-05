import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn(), exists: vi.fn(), installed: true, running: false, inspectFailed: false }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec, execFile: vi.fn() }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), existsSync: mocks.exists, mkdirSync: vi.fn(), writeFileSync: mocks.write }));
vi.mock('./sharedRuntime.js', async (original) => ({ ...await original<typeof import('./sharedRuntime.js')>(), readSharedInstall: () => mocks.installed ? {} : null }));
import { applyDesktopAutoconnect, installDesktopAutoconnect } from './desktopAutoconnect.js';
import { DESKTOP_LAUNCHER } from './sharedRuntime.js';
beforeEach(() => { vi.clearAllMocks(); mocks.installed = true; mocks.running = false; mocks.inspectFailed = false;
  mocks.exists.mockReturnValue(false);
  mocks.exec.mockImplementation((command: string) => {
    if (command === '/bin/ps') {
      if (mocks.inspectFailed) throw new Error('process inspection failed');
      return mocks.running ? '10 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT' : '';
    }
  });
});
it('keeps the installed native launcher as the login entry when autoconnect is re-enabled', () => {
  mocks.exists.mockReturnValue(true);
  installDesktopAutoconnect();
  expect(mocks.write.mock.calls[0][1]).toContain('Codex + Stream Deck.app');
  expect(mocks.write.mock.calls[0][1]).toContain('--login');
  expect(mocks.write.mock.calls[0][1]).not.toContain('desktop-autoconnect.js');
});
it('enables future launches without opening or quitting the current app', () => {
  installDesktopAutoconnect();
  expect(mocks.exec.mock.calls).toEqual([
    ['/bin/launchctl', ['setenv', 'CODEX_CLI_PATH', DESKTOP_LAUNCHER]],
    ['/bin/launchctl', ['setenv', 'CODEX_APP_SERVER_FORCE_CLI', '1']],
  ]);
  expect(mocks.write.mock.calls[0][1]).toContain('desktop-autoconnect.js');
  expect(mocks.write.mock.calls[0][1]).toContain('<key>RunAtLoad</key>');
});
it('opens with explicit connection routing at login after setting defaults', () => {
  applyDesktopAutoconnect(true);
  expect(mocks.exec.mock.calls[3][0]).toBe('/usr/bin/open');
  expect(mocks.exec.mock.calls[3][1]).toContain(`CODEX_CLI_PATH=${DESKTOP_LAUNCHER}`);
});
it('does not change the environment without an installation', () => {
  mocks.installed = false;
  expect(() => installDesktopAutoconnect()).toThrow('Install shared control');
  expect(mocks.exec).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

it.each(['running', 'unknown'])('never opens or restarts Codex when its process state is %s', (state) => {
  mocks.running = state === 'running';
  mocks.inspectFailed = state === 'unknown';
  expect(applyDesktopAutoconnect(true)).toBe('already-running');
  expect(mocks.exec.mock.calls.map(([command]) => command)).toEqual(['/bin/launchctl', '/bin/launchctl', '/bin/ps']);
});
