// Synthetic installation-record writers. HOME must be an explicit disposable root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [moduleDirectory, extension, root, operation, pauseStage = ''] = process.argv.slice(2);
assert.equal(fs.realpathSync(process.env.HOME), fs.realpathSync(root));
assert.match(root, /micro-install-txn-/);
const expected = JSON.parse(fs.readFileSync(join(root, 'expected.json'), 'utf8'));
const write = fs.writeFileSync;
const release = join(root, `release-${process.pid}`);
const files = new Map();
const open = fs.openSync;
let paused = false;
function pause(stage) {
  if (pauseStage !== stage || paused) return;
  paused = true;
  fs.writeSync(1, JSON.stringify({ ready: stage }) + '\n');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(release)) {
    if (Date.now() > deadline) throw new Error('fixture barrier timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
fs.openSync = (path, ...args) => { const fd = open(path, ...args); files.set(fd, String(path)); return fd; };
fs.writeFileSync = (path, ...args) => {
  if (typeof path === 'number' && files.get(path)?.endsWith('.tmp')) pause('commit');
  return write(path, ...args);
};
syncBuiltinESMExports();
try {
  const state = await import(pathToFileURL(join(moduleDirectory, `sharedInstall.${extension}`)));
  const { verifyAutomaticDesktop } = await import(pathToFileURL(join(moduleDirectory, `automaticVerification.${extension}`)));
  if (operation === 'verify') {
    await verifyAutomaticDesktop(expected, {
      resolveBinary: () => '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
      fingerprint: async () => 'c'.repeat(64),
      verify: async () => { pause('probe'); return { version: 'synthetic-new', checks: ['fixture'] }; },
    });
  } else if (operation === 'enable') state.enableSharedAutoconnect();
  else if (operation === 'delete') state.updateSharedInstall(() => null);
  else if (operation === 'replace') state.updateSharedInstall(() => ({ ...expected, token: 'd'.repeat(64) }));
  else throw new Error('unknown fixture operation');
  fs.writeSync(1, JSON.stringify({ success: true }) + '\n');
} catch (error) {
  fs.writeSync(1, JSON.stringify({ error: error.message, code: error.code }) + '\n');
  process.exitCode = 1;
}
