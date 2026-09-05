import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from './config.js';

export const DESKTOP_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex';
export const DESKTOP_ARCHIVE = '/Applications/ChatGPT.app/Contents/Resources/app.asar';
export const SHARED_INSTALL_STATE = join(APP_DIR, 'shared-server.json');
export const SHARED_RUNTIME_STATE = join(APP_DIR, 'shared-runtime.json');
export const DESKTOP_LAUNCHER = join(APP_DIR, 'codex-desktop');
export const DEFAULT_SHARED_SERVER_URL = 'ws://127.0.0.1:17532';

export interface DesktopSharedInstall {
  mode: 'desktop-launch';
  url: string;
  codexPath: string;
  configPath: string;
  launcherPath: string;
  fingerprint: string;
  version: string;
  token: string;
  autoConnect?: boolean;
  verificationGeneration?: string;
}

export interface DesktopSharedRuntime {
  mode: 'shared' | 'private' | 'blocked';
  bridgePid: number;
  serverPid?: number;
  url: string;
  fingerprint: string;
  reason?: string;
  token?: string;
}

export function readSharedInstall(): DesktopSharedInstall | null {
  try {
    const value = JSON.parse(readFileSync(SHARED_INSTALL_STATE, 'utf8'));
    if (value.mode !== 'desktop-launch' || value.codexPath !== DESKTOP_CODEX
      || value.launcherPath !== DESKTOP_LAUNCHER
      || !/^[a-f0-9]{64}$/.test(value.fingerprint)
      || !/^[a-f0-9]{64}$/.test(value.token)
      || typeof value.configPath !== 'string' || typeof value.version !== 'string') return null;
    validateSharedEndpoint(value.url);
    return value;
  } catch { return null; }
}

export function readSharedRuntime(): DesktopSharedRuntime | null {
  try {
    const value = JSON.parse(readFileSync(SHARED_RUNTIME_STATE, 'utf8'));
    if (!['private', 'shared', 'blocked'].includes(value.mode) || !Number.isInteger(value.bridgePid)) return null;
    process.kill(value.bridgePid, 0);
    return value;
  } catch { return null; }
}

export function sharedConnectionHeaders(endpoint: string): Record<string, string> {
  const state = readSharedInstall();
  const runtime = readSharedRuntime();
  return state?.url === endpoint && runtime?.url === endpoint && runtime.mode === 'shared'
    && runtime.fingerprint === state.fingerprint && /^[a-f0-9]{64}$/.test(runtime.token ?? '')
    ? { Authorization: `Bearer ${runtime.token}` } : {};
}

/** Do not propagate Micro's scoped launch switches to tools or other apps. */
export function cleanDesktopEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  delete clean.CODEX_APP_SERVER_WS_URL;
  delete clean.CODEX_APP_SERVER_FORCE_CLI;
  delete clean.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
  delete clean.CODEX_CLI_PATH;
  return clean;
}

export function validateSharedEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('shared server URL must be a loopback ws://127.0.0.1 URL with an explicit port and no path');
  }
  return url.toString().replace(/\/$/, '');
}

/** Pin both sides of the contract, not just the CLI's version string. */
export async function desktopBuildFingerprint(files = [DESKTOP_CODEX, DESKTOP_ARCHIVE]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files) {
    const before = statSync(file);
    hash.update(`${file}\0${before.size}\0`);
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const after = statSync(file);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Desktop is updating; wait for the update to finish');
    }
  }
  return hash.digest('hex');
}
