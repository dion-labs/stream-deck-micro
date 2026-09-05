import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (process.version !== 'v22.22.3') throw new Error('Use Node 22.22.3 to match the bundled license and tested runtime.');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This release builder targets Apple Silicon macOS.');
const stage = mkdtempSync(join(tmpdir(), 'micro-release-'));
const out = join(root, 'release'); mkdirSync(out, { recursive: true });
const bundle = join(stage, 'Codex + Stream Deck.app');
const contents = join(bundle, 'Contents'); const resources = join(contents, 'Resources');
const runtime = join(resources, 'runtime');
mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(runtime, 'bin'), { recursive: true });
try {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos14.0', join(root, 'native/ControlCenterPolicy.swift'), join(root, 'native/DesktopLauncher.swift'), '-o', join(contents, 'MacOS/Launcher'), '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'UserNotifications'], { stdio: 'inherit' });
  copyFileSync(process.execPath, join(runtime, 'bin/node'));
  copyFileSync(join(root, 'native/licenses/NODE-LICENSE'), join(runtime, 'NODE-LICENSE'));
  cpSync(join(root, 'dist'), join(runtime, 'dist'), { recursive: true, filter: p => !p.endsWith('.map') && !p.endsWith('.d.ts') });
  for (const file of ['package.json', 'package-lock.json', 'LICENSE']) copyFileSync(join(root, file), join(runtime, file));
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' });
  execFileSync(join(runtime, 'bin/node'), ['--input-type=module', '-e', "await import('@napi-rs/canvas'); await import('elgato-stream-deck'); await import('./dist/desktopLauncher.js'); console.log('Bundled runtime imports passed')"], { cwd: runtime, stdio: 'inherit', env: { PATH: '/usr/bin:/bin', HOME: stage } });
  const iconset = join(stage, 'Launcher.iconset'); mkdirSync(iconset);
  for (const size of [16,32,128,256,512]) for (const scale of [1,2]) {
    execFileSync('/usr/bin/sips', ['-s','format','png','-z',String(size*scale),String(size*scale),join(root,'native/assets/curator-headshot.webp'),'--out',join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)], { stdio: 'ignore' });
  }
  execFileSync('/usr/bin/iconutil', ['-c','icns',iconset,'-o',join(resources,'Launcher.icns')]);
  copyFileSync(join(root,'src/admin/assets/control-center.css'),join(resources,'ControlCenter.css'));
  copyFileSync(join(root,'marketplace/ai.dionlabs.stream-deck-micro.streamDeckPlugin'),join(resources,'Micro.streamDeckPlugin'));
  writeFileSync(join(resources,'launcher.json'),JSON.stringify({node:'runtime/bin/node',cli:'runtime/dist/cli/desktop-launcher.js',log:'~/.stream-deck-micro/launcher.error.log',controlRoomURL:'http://127.0.0.1:17531'},null,2));
  writeFileSync(join(contents,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.dionlabs.stream-deck-micro.launcher</string>
<key>CFBundleName</key><string>Codex + Stream Deck</string>
<key>CFBundleDisplayName</key><string>Codex + Stream Deck</string>
<key>CFBundleExecutable</key><string>Launcher</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>20</string>
<key>LSMinimumSystemVersion</key><string>14.0</string><key>CFBundleIconFile</key><string>Launcher</string>
<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>`);
  function signNative(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory,item.name);
      if (item.isDirectory()) signNative(file);
      else if (item.name.endsWith('.node') || file === join(runtime,'bin/node')) execFileSync('/usr/bin/codesign',['--force','--sign','-',file],{stdio:'pipe'});
    }
  }
  signNative(runtime);
  execFileSync('/usr/bin/codesign',['--force','--sign','-',bundle],{stdio:'inherit'});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
  const zip = join(out,`Codex-Stream-Deck-${version}-macOS-arm64.zip`);
  execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,zip]);
  const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
  writeFileSync(join(out,'SHA256SUMS'),`${digest}  ${zip.split('/').at(-1)}\n`);
  console.log(`Release ready: ${zip}`);
} finally { rmSync(stage,{recursive:true,force:true}); }
