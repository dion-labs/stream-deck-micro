import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('./config.js', () => ({ get APP_DIR() { return fixture.directory; } }));
fixture.directory = mkdtempSync(join(tmpdir(), 'micro-layout-install-'));
const { DESKTOP_CODEX, DESKTOP_LAUNCHER, SHARED_INSTALL_STATE, readSharedInstall, desktopBuildFingerprint } = await import('./sharedRuntime.js');
afterAll(() => rmSync(fixture.directory, { recursive: true, force: true }));

const modern = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const install = {
  mode: 'desktop-launch', url: 'ws://127.0.0.1:17532', codexPath: DESKTOP_CODEX,
  configPath: join(fixture.directory, 'config.json'), launcherPath: DESKTOP_LAUNCHER,
  fingerprint: 'a'.repeat(64), version: 'fixture', token: 'b'.repeat(64),
};
function save(codexPath: unknown): void {
  writeFileSync(SHARED_INSTALL_STATE, JSON.stringify({ ...install, codexPath }), { mode: 0o600 });
}

describe('saved Desktop executable identity', () => {
  it('retains legacy records independently of the currently installed bundle layout', () => {
    save(DESKTOP_CODEX);
    expect(readSharedInstall()).toEqual(install);
  });

  it('recognizes the exact modern bundled CLI path', () => {
    save(modern);
    expect(readSharedInstall()).toEqual({ ...install, codexPath: modern });
  });

  it.each([
    '/tmp/codex', 'codex', `${DESKTOP_CODEX}-other`, `${modern}-other`,
    `${modern}/child`, `${modern} --version`, modern.replace('ChatGPT.app', 'ChatGPT-copy.app'),
    '/Applications/ChatGPT.app/Contents/Resources/../MacOS/codex', null, 42,
  ])('rejects a saved path outside the exact allowlist: %j', (path) => {
    save(path);
    expect(readSharedInstall()).toBeNull();
  });
});

it('binds a fingerprint to its selected executable path even when executable bytes match', async () => {
  const legacy = join(fixture.directory, 'legacy-codex');
  const nested = join(fixture.directory, 'nested-codex');
  const archive = join(fixture.directory, 'app.asar');
  writeFileSync(legacy, 'identical executable fixture');
  writeFileSync(nested, 'identical executable fixture');
  writeFileSync(archive, 'unchanged desktop fixture');
  expect(await desktopBuildFingerprint([legacy, archive]))
    .not.toBe(await desktopBuildFingerprint([nested, archive]));
});
