import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR } from './config.js';
import { DESKTOP_LAUNCHER, readSharedInstall } from './sharedRuntime.js';
import { desktopAppIsRunning, launchAgentPlist, sharedDesktopOpenArguments } from './sharedServer.js';

export const AUTOCONNECT_LABEL = 'ai.dionlabs.stream-deck-micro.autoconnect';
export const AUTOCONNECT_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${AUTOCONNECT_LABEL}.plist`);
export const LAUNCHER_APP = join(homedir(), 'Applications', 'Codex + Stream Deck.app');

/** Set defaults for subsequent GUI launches; never quit an existing Desktop. */
export function applyDesktopAutoconnect(openAtLogin = false): 'configured' | 'already-running' | 'opened' {
  if (!readSharedInstall()) throw new Error('Install shared control before enabling automatic connection');
  execFileSync('/bin/launchctl', ['setenv', 'CODEX_CLI_PATH', DESKTOP_LAUNCHER]);
  execFileSync('/bin/launchctl', ['setenv', 'CODEX_APP_SERVER_FORCE_CLI', '1']);
  if (!openAtLogin) return 'configured';
  // A login restore may already own a backend. Opening again cannot change its
  // environment; never attempt to fix that by quitting or restarting it.
  if (desktopAppIsRunning()) return 'already-running';
  execFileSync('/usr/bin/open', sharedDesktopOpenArguments(), { timeout: 10_000 });
  return 'opened';
}

export function installDesktopAutoconnect(): void {
  applyDesktopAutoconnect();
  const launcherApp = ['/Applications/Codex + Stream Deck.app', LAUNCHER_APP].find((path) => existsSync(path));
  mkdirSync(dirname(AUTOCONNECT_PLIST), { recursive: true });
  writeFileSync(AUTOCONNECT_PLIST, launchAgentPlist({
    label: AUTOCONNECT_LABEL,
    args: launcherApp
      ? ['/usr/bin/open', launcherApp, '--args', '--login']
      : [process.execPath, join(dirname(fileURLToPath(import.meta.url)), 'cli', 'desktop-autoconnect.js')],
    keepAlive: false,
    stdoutPath: join(APP_DIR, 'autoconnect.log'),
    stderrPath: join(APP_DIR, 'autoconnect.error.log'),
  }), { mode: 0o600 });
}
