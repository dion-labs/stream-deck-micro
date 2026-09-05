import { execFileSync } from 'node:child_process';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, loadConfig } from '../dist/config.js';
import { readSharedInstall, SHARED_INSTALL_STATE } from '../dist/sharedRuntime.js';
import { AUTOCONNECT_LABEL, AUTOCONNECT_PLIST } from '../dist/desktopAutoconnect.js';
import { launchAgentPlist } from '../dist/sharedServer.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const install = readSharedInstall();
if (!install) throw new Error('Run shared install before installing the launcher.');
const { config } = loadConfig(install.configPath);
if (!config.admin.enabled) throw new Error('Enable the local Control Center in the Micro configuration before installing the native app.');
const service = join(homedir(), 'Library', 'LaunchAgents', 'ai.dionlabs.stream-deck-micro.marketplace-bridge.plist');
accessSync(service, constants.R_OK);
const cli = join(root, 'dist', 'cli', 'desktop-launcher.js');
accessSync(cli, constants.R_OK);
const applications = existsSync('/Applications/Codex + Stream Deck.app') ? '/Applications' : join(homedir(), 'Applications');
mkdirSync(applications, { recursive: true });
const destination = join(applications, 'Codex + Stream Deck.app');
const bundleID = 'ai.dionlabs.stream-deck-micro.launcher';
if (existsSync(destination)) {
  const existing = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(destination, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
  if (existing !== bundleID) throw new Error('An unrelated application already exists at the launcher destination.');
}
const stage = mkdtempSync(join(applications, '.micro-launcher-'));
const bundle = join(stage, 'Codex + Stream Deck.app');
const contents = join(bundle, 'Contents');
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(join(contents, 'Resources'), { recursive: true });
try {
  execFileSync('/usr/bin/xcrun', ['swiftc', join(root, 'native', 'ControlCenterPolicy.swift'), join(root, 'native', 'DesktopLauncher.swift'), '-o', join(contents, 'MacOS', 'Launcher'), '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'UserNotifications'], { stdio: 'inherit' });
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleID}</string>
<key>CFBundleName</key><string>Codex + Stream Deck</string>
<key>CFBundleDisplayName</key><string>Codex + Stream Deck</string>
<key>CFBundleExecutable</key><string>Launcher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>4</string>
<key>CFBundleIconFile</key><string>Launcher</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>`);
  const iconset = join(stage, 'Launcher.iconset'); mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(size * scale), String(size * scale), join(root, 'native', 'assets', 'curator-headshot.webp'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(contents, 'Resources', 'Launcher.icns')]);
  copyFileSync(join(root, 'src/admin/assets/control-center.css'), join(contents, 'Resources', 'ControlCenter.css'));
  writeFileSync(join(contents, 'Resources', 'launcher.json'), JSON.stringify({ node: process.execPath, cli, log: join(APP_DIR, 'launcher.error.log'), controlRoomURL: `http://127.0.0.1:${config.admin.port}` }, null, 2));
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundle]);
  // Keep a recoverable previous app; never remove an unrelated bundle.
  const backup = `${destination}.previous-${Date.now()}`;
  if (existsSync(destination)) {
    renameSync(destination, backup);
  }
  try { renameSync(bundle, destination); }
  catch (error) { if (existsSync(backup)) renameSync(backup, destination); throw error; }
  mkdirSync(dirname(AUTOCONNECT_PLIST), { recursive: true });
  if (existsSync(AUTOCONNECT_PLIST)) copyFileSync(AUTOCONNECT_PLIST, join(APP_DIR, 'autoconnect-before-launcher.plist'));
  writeFileSync(AUTOCONNECT_PLIST, launchAgentPlist({
    label: AUTOCONNECT_LABEL, args: ['/usr/bin/open', destination, '--args', '--login'], keepAlive: false,
    stdoutPath: join(APP_DIR, 'autoconnect.log'), stderrPath: join(APP_DIR, 'autoconnect.error.log'),
  }), { mode: 0o600 });
  // Read again to preserve changes another session may have made while compiling.
  const current = readSharedInstall();
  if (!current || current.token !== install.token) throw new Error('Shared installation changed during launcher installation.');
  writeFileSync(SHARED_INSTALL_STATE, `${JSON.stringify({ ...current, autoConnect: true }, null, 2)}\n`, { mode: 0o600 });
  // Unload only the superseded login entry. Do not load/run the new launcher now.
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${AUTOCONNECT_LABEL}`], { stdio: 'pipe' }); } catch {}
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', destination]);
  console.log(`Installed ${destination}\nLogin now uses this launcher. No app or Stream Deck service was restarted.`);
} finally { rmSync(stage, { recursive: true, force: true }); }
