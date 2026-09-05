import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, loadConfig } from './config.js';
import { readSharedInstall, SHARED_INSTALL_STATE } from './sharedRuntime.js';
import { installSharedServer } from './sharedServer.js';
import { ensureMarketplaceService, installMarketplaceService } from './marketplaceService.js';
import { installDesktopAutoconnect } from './desktopAutoconnect.js';

/** Explicit first-run setup. Never quits Desktop or replaces an existing setup. */
export async function setupNativeApp(): Promise<void> {
  const existing = readSharedInstall();
  const servicePath = join(homedir(), 'Library/LaunchAgents/ai.dionlabs.stream-deck-micro.marketplace-bridge.plist');
  if (existing && existsSync(servicePath)) { await ensureMarketplaceService(); return; }
  const bundle = process.env.SDM_NATIVE_BUNDLE;
  const allowed = ['/Applications/Codex + Stream Deck.app', join(homedir(), 'Applications/Codex + Stream Deck.app')];
  if (!bundle || !allowed.includes(bundle)) throw new Error('Move Codex + Stream Deck to Applications before setting it up.');
  const configPath = join(APP_DIR, 'config.json');
  if (existing && existing.configPath !== configPath) throw new Error('An existing custom installation needs manual upgrade; it was left unchanged.');
  if (existsSync(servicePath)) throw new Error('An existing bridge is installed. Follow the upgrade guide to preserve its configuration.');
  mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({ surface: { mode: 'marketplace' }, attachExternal: true,
      slots: { count: 15, cwd: homedir() }, admin: { enabled: true, port: 17531 } }, null, 2), { mode: 0o600, flag: 'wx' });
  }
  const { config } = loadConfig(configPath);
  if (config.surface.mode !== 'marketplace' || !config.admin.enabled || config.admin.port !== 17531) {
    throw new Error('An existing custom configuration needs manual setup; it was left unchanged.');
  }
  if (!existing) await installSharedServer(configPath);
  const install = readSharedInstall();
  if (!install) throw new Error('Shared setup could not be read');
  writeFileSync(SHARED_INSTALL_STATE, `${JSON.stringify({ ...install, autoConnect: true }, null, 2)}\n`, { mode: 0o600 });
  await installMarketplaceService(configPath, fileURLToPath(new URL('./cli/stream-deck-micro.js', import.meta.url)));
  installDesktopAutoconnect();
}
