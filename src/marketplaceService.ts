import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_DIR, IPC_SOCKET, saveSurfaceMode } from './config.js';
import { ipcCall } from './ipc.js';
import {
  launchAgentPlist,
  sharedServerStatus,
  type DesktopConnectionStatus,
} from './sharedServer.js';

export const MARKETPLACE_BRIDGE_LABEL = 'ai.dionlabs.stream-deck-micro.marketplace-bridge';
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const BRIDGE_PLIST = join(LAUNCH_AGENTS_DIR, `${MARKETPLACE_BRIDGE_LABEL}.plist`);
const INSTALL_STATE = join(APP_DIR, 'marketplace-bridge.json');

interface MarketplaceInstallState {
  configPath: string;
  nodePath: string;
  cliPath: string;
}

export interface MarketplaceServiceStatus {
  installed: boolean;
  running: boolean;
  surface: string | null;
  configPath: string | null;
  sharedServerHealthy: boolean;
  desktopRestartRequired: boolean;
  desktopConnection: DesktopConnectionStatus;
}

export async function installMarketplaceService(
  configPath?: string,
): Promise<MarketplaceServiceStatus> {
  // Installing/updating the Elgato bridge must not change Codex's backend.
  const shared = await sharedServerStatus();
  const savedConfigPath = resolve(saveSurfaceMode(configPath ?? shared.configPath ?? undefined, 'marketplace'));
  const cliPath = resolve(process.argv[1]);
  const state: MarketplaceInstallState = {
    configPath: savedConfigPath,
    nodePath: process.execPath,
    cliPath,
  };
  mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true, mode: 0o700 });
  writePrivateFile(
    BRIDGE_PLIST,
    launchAgentPlist({
      label: MARKETPLACE_BRIDGE_LABEL,
      args: [state.nodePath, state.cliPath, 'start', state.configPath, '--marketplace'],
      keepAlive: true,
      stdoutPath: join(APP_DIR, 'marketplace-bridge.log'),
      stderrPath: join(APP_DIR, 'marketplace-bridge.error.log'),
    }),
  );
  writePrivateFile(INSTALL_STATE, `${JSON.stringify(state, null, 2)}\n`);
  const domain = launchDomain();
  bootout(domain, BRIDGE_PLIST);
  launchctl(['bootstrap', domain, BRIDGE_PLIST]);
  await waitForBridge();
  return marketplaceServiceStatus();
}

export async function uninstallMarketplaceService(
  configPath?: string,
): Promise<MarketplaceServiceStatus> {
  const state = readInstallState();
  bootout(launchDomain(), BRIDGE_PLIST);
  for (const path of [BRIDGE_PLIST, INSTALL_STATE]) {
    if (existsSync(path)) unlinkSync(path);
  }
  saveSurfaceMode(configPath ?? state?.configPath, 'independent');
  return marketplaceServiceStatus();
}

export async function marketplaceServiceStatus(): Promise<MarketplaceServiceStatus> {
  const state = readInstallState();
  const shared = await sharedServerStatus();
  let surface: string | null = null;
  try {
    const status = await ipcCall<{ surface: string }>(IPC_SOCKET, 'status', {}, 1000);
    surface = status.surface;
  } catch {
    // Not running yet.
  }
  return {
    installed: existsSync(BRIDGE_PLIST),
    running: surface === 'marketplace',
    surface,
    configPath: state?.configPath ?? null,
    sharedServerHealthy: shared.healthy,
    desktopRestartRequired: shared.desktopRestartRequired,
    desktopConnection: shared.desktopConnection,
  };
}

function readInstallState(): MarketplaceInstallState | null {
  try {
    return JSON.parse(readFileSync(INSTALL_STATE, 'utf8')) as MarketplaceInstallState;
  } catch {
    return null;
  }
}

async function waitForBridge(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const status = await ipcCall<{ surface: string }>(IPC_SOCKET, 'status', {}, 500);
      if (status.surface === 'marketplace') return;
    } catch {
      // LaunchAgent is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Marketplace bridge did not become ready; see ${join(APP_DIR, 'marketplace-bridge.error.log')}`);
}

function launchDomain(): string {
  if (!process.getuid) throw new Error('Marketplace setup requires macOS');
  return `gui/${process.getuid()}`;
}

function launchctl(args: string[]): void {
  execFileSync('/bin/launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function bootout(domain: string, plist: string): void {
  try {
    launchctl(['bootout', domain, plist]);
  } catch {
    // Not loaded yet.
  }
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}
