// Disposable-process test fixture. Never select a default/user config path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [modulePath, configPath, operation, pauseStage = ''] = process.argv.slice(2);
const root = fs.realpathSync(process.env.TMPDIR);
assert.equal(process.env.HOME, root);
assert.equal(fs.realpathSync(dirname(configPath)), root);
const release = join(root, `release-${process.pid}`);
const original = { read: fs.readFileSync, write: fs.writeFileSync, rename: fs.renameSync, open: fs.openSync, close: fs.closeSync, sync: fs.fsyncSync };
const files = new Map();
let paused = false;
let descendant;
function pause(stage) {
  if (paused || pauseStage !== stage) return;
  paused = true;
  if (process.env.FIXTURE_DESCENDANT === '1') {
    descendant = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 2000)'], { env: process.env, stdio: ['ignore', 'ignore', 'ignore', 3] });
    descendant.unref();
  }
  fs.writeSync(1, JSON.stringify({ ready: stage, pid: process.pid, descendant: descendant?.pid }) + '\n');
  const deadline = Date.now() + 12000;
  while (!fs.existsSync(release)) {
    if (Date.now() > deadline) throw new Error('fixture barrier timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
fs.openSync = (file, ...args) => { if (String(file) === configPath && args[0] === 'wx') pause('create'); const fd = original.open(file, ...args); files.set(fd, String(file)); return fd; };
fs.closeSync = fd => { files.delete(fd); return original.close(fd); };
fs.readFileSync = (file, ...args) => {
  try { return original.read(file, ...args); }
  finally { if (String(file) === configPath) pause('read'); }
};
fs.writeFileSync = (file, ...args) => {
  const path = typeof file === 'number' ? files.get(file) : String(file);
  if (path === configPath && pauseStage === 'partial-create') {
    original.write(file, '{"partial":'); pause('partial-create');
  }
  if (path === configPath || path?.endsWith('.tmp')) pause('write');
  return original.write(file, ...args);
};
fs.renameSync = (...args) => { const result = original.rename(...args); if (String(args[1]) === configPath) pause('rename'); return result; };
fs.fsyncSync = fd => { const result = original.sync(fd); if (files.get(fd) === configPath) pause('created'); return result; };
syncBuiltinESMExports();
try {
  const config = await import(pathToFileURL(modulePath));
  const operations = {
    settings: () => config.saveDeckSettings(configPath, { ...config.DEFAULT_DECK_SETTINGS, brightness: 42 }),
    edition: () => config.saveSurfaceMode(configPath, 'marketplace'),
    endpoint: () => config.saveAppServerUrl(configPath, 'ws://127.0.0.1:17532'),
    workflows: () => config.saveWorkflows(configPath, [{ id: 'fixture', name: 'FIXTURE', prompt: 'Synthetic' }], []),
    layout: () => config.saveDeckLayout(configPath, [{ keyIndex: 0, action: { kind: 'slot', index: 0 } }]),
    initialize: () => config.createConfigIfAbsent(configPath, { surface: { mode: 'marketplace' }, attachExternal: true, slots: { count: 15, cwd: root }, admin: { enabled: true, port: 17531 } }),
  };
  assert.equal(typeof operations[operation], 'function');
  pause('start');
  operations[operation]();
  fs.writeSync(1, JSON.stringify({ success: true }) + '\n');
} catch (error) {
  fs.writeSync(1, JSON.stringify({ error: error.message, code: error.code }) + '\n');
  process.exitCode = 1;
}
// The bounded descendant holds only the test control pipe; never signal it by PID.
