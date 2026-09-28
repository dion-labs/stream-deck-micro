import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  install: null as any,
  fingerprint: 'a'.repeat(64),
  runtime: null as any,
  exec: vi.fn(),
  binary: '/Applications/ChatGPT.app/Contents/Resources/codex',
}));
vi.mock('node:child_process', async (original) => ({ ...(await original<typeof import('node:child_process')>()), execFile: mocks.exec }));
vi.mock('./sharedRuntime.js', async (original) => ({
  ...(await original<typeof import('./sharedRuntime.js')>()),
  readSharedInstall: () => mocks.install,
  readSharedRuntime: () => mocks.runtime,
  desktopBuildFingerprint: async () => mocks.fingerprint,
}));
vi.mock('./desktopExecutable.js', async original => ({ ...(await original<typeof import('./desktopExecutable.js')>()), resolveDesktopExecutable: () => mocks.binary }));
import {
  assertSharedLaunchCompatible,
  assertDesktopRecoverySupported,
  restartCodexDesktop,
  restartSharedCodexDesktop,
  sharedDesktopOpenArguments,
  sharedLaunchNeedsVerification,
} from './sharedServer.js';

beforeEach(() => {
  mocks.exec.mockReset();
  mocks.install = { codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex', url: 'ws://127.0.0.1:17532', fingerprint: 'a'.repeat(64) };
  mocks.fingerprint = 'a'.repeat(64);
  mocks.runtime = null;
  mocks.binary = '/Applications/ChatGPT.app/Contents/Resources/codex';
});

describe('shared activation safety boundary', () => {
  it.each(['selected', 'saved'])('rejects a modern %s layout before generic or shared restart effects', async source => {
    const modern = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
    if (source === 'saved') mocks.install.codexPath = modern;
    else mocks.binary = modern;
    expect(() => assertDesktopRecoverySupported()).toThrow('Modern Desktop recovery');
    await expect(restartCodexDesktop()).rejects.toThrow('Modern Desktop recovery');
    await expect(restartSharedCodexDesktop('ws://127.0.0.1:17532')).rejects.toThrow('Modern Desktop recovery');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('does not quit or reopen Desktop when setup was removed', async () => {
    mocks.install = null;
    await expect(restartSharedCodexDesktop('ws://127.0.0.1:17532')).rejects.toThrow('not installed');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('does not quit or reopen Desktop when either bundled artifact changed', async () => {
    mocks.fingerprint = 'new-build';
    await expect(sharedLaunchNeedsVerification('ws://127.0.0.1:17532')).resolves.toBe(true);
    await expect(restartSharedCodexDesktop('ws://127.0.0.1:17532')).rejects.toThrow('build changed');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('recognizes the exact verified Desktop build', async () => {
    await expect(sharedLaunchNeedsVerification('ws://127.0.0.1:17532')).resolves.toBe(false);
  });
  it('does not restart Desktop after a failed shared attempt', async () => {
    mocks.runtime = { mode: 'blocked' };
    await expect(restartSharedCodexDesktop('ws://127.0.0.1:17532')).rejects.toThrow('previously failed');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('rejects an endpoint other than the exact installation', async () => {
    await expect(assertSharedLaunchCompatible('ws://127.0.0.1:17000')).rejects.toThrow('not installed');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('uses process-scoped CLI routing and explicitly clears inherited WS routing', () => {
    const args = sharedDesktopOpenArguments();
    expect(args).toContain('--env');
    expect(args).toContain('CODEX_APP_SERVER_WS_URL=');
    expect(args).toContain('CODEX_APP_SERVER_FORCE_CLI=1');
    expect(args.some((arg) => arg.startsWith('CODEX_CLI_PATH='))).toBe(true);
    expect(args.join(' ')).not.toContain('launchctl');
  });
});
