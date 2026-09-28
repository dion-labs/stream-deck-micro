import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string;
let configPath: string;
const children = new Set<ChildProcess>();
const completions = new Map<ChildProcess, Promise<unknown>>();
const runtimeRoot = process.env.SDM_RUNTIME_ROOT;
const modulePath = runtimeRoot ? join(runtimeRoot, 'dist/config.js') : fileURLToPath(new URL('./config.ts', import.meta.url));
const workerNode = runtimeRoot ? join(runtimeRoot, 'bin/node') : process.execPath;
const fixturePath = fileURLToPath(new URL('../scripts/fixtures/config-writer.mjs', import.meta.url));
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sdm-txn-')));
  configPath = join(root, 'config.json');
  writeFileSync(configPath, JSON.stringify({ fixture: 'preserve' }));
});
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
    }
  }
  // Child close waits for its pipes, including the bounded descendant's control
  // pipe. Confirm close before deleting fixtures; never signal an orphan PID.
  await Promise.all(completions.values());
  children.clear(); completions.clear();
  rmSync(root, { recursive: true, force: true });
});
function start(operation: string, stage = '', descendant = false, selectedPath = configPath) {
  const child = spawn(workerNode, [...(runtimeRoot ? [] : ['--import', 'tsx']), fixturePath, modulePath, selectedPath, operation, stage], {
    env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, ...(descendant ? { FIXTURE_DESCENDANT: '1' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  (child.stdio[3] as import('node:stream').Readable).resume();
  let output = '', stderr = '';
  let resolveReady: (value: { pid: number; descendant?: number }) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<{ pid: number; descendant?: number }>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Some workers intentionally never pause; their unused ready rejection is handled.
  void ready.catch(() => {});
  const readyTimeout = setTimeout(() => rejectReady(new Error(`worker readiness timeout: ${output} ${stderr}`)), 5000);
  child.stdout.on('data', part => {
    output += part.toString();
    for (const line of output.trim().split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.ready) {
          clearTimeout(readyTimeout);
          resolveReady(event);
        }
      } catch { /* Wait for a complete line. */ }
    }
  });
  child.stderr.on('data', part => { stderr += part.toString(); });
  const done = new Promise<{ code: number | null; output: string; stderr: string }>((resolve, reject) => {
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fixture exit deadline')); }, 15000);
    child.on('error', error => { clearTimeout(deadline); clearTimeout(readyTimeout); rejectReady(error); reject(error); });
    child.on('close', code => {
      clearTimeout(deadline); clearTimeout(readyTimeout);
      rejectReady(new Error(`worker exited before readiness: ${output} ${stderr}`));
      resolve({ code, output, stderr });
    });
  });
  completions.set(child, done);
  return { child, ready, done, release: () => writeFileSync(join(root, `release-${child.pid}`), '') };
}

it.each(['settings', 'edition', 'endpoint', 'workflows', 'layout'])('%s contends before fresh read and preserves a prior disjoint commit on retry', async operation => {
  const firstOperation = operation === 'settings' ? 'edition' : 'settings';
  const owner = start(firstOperation, 'read');
  await owner.ready;
  const before = readFileSync(configPath, 'utf8');
  const contender = await start(operation).done;
  expect(contender.code, contender.output + contender.stderr).toBe(1);
  expect(contender.output).toMatch(/being updated/);
  expect(readFileSync(configPath, 'utf8')).toBe(before);
  owner.release();
  expect((await owner.done).code).toBe(0);
  expect((await start(operation).done).code).toBe(0);
  const final = JSON.parse(readFileSync(configPath, 'utf8'));
  expect(final.fixture).toBe('preserve');
  expect(firstOperation === 'edition' ? final.surface.mode : final.deck.brightness).toBe(firstOperation === 'edition' ? 'marketplace' : 42);
  const expected = { settings: final.deck?.brightness, edition: final.surface?.mode, endpoint: final.appServer?.url, workflows: final.workflows?.[0].id, layout: final.layout?.[0].keyIndex };
  expect(expected[operation as keyof typeof expected]).toBe({ settings: 42, edition: 'marketplace', endpoint: 'ws://127.0.0.1:17532', workflows: 'fixture', layout: 0 }[operation]);
});

it.each(['write', 'rename'])('recovers the retained lock after killing an owner at %s', async stage => {
  const owner = start('settings', stage, true);
  const event = await owner.ready;
  const lockPath = join(root, '.stream-deck-micro-config.lock');
  const inode = statSync(lockPath).ino;
  expect((await start('edition').done).output).toMatch(/being updated/);
  const exited = once(owner.child, 'exit');
  owner.child.kill('SIGKILL'); await exited;
  expect(event.descendant).toBeTypeOf('number');
  expect(owner.child.stdio[3]?.destroyed).toBe(false); // Owned control pipe remains open in bounded descendant.
  expect((await start('edition').done).code).toBe(0);
  expect(statSync(lockPath).ino).toBe(inode);
  expect(statSync(lockPath).mode & 0o777).toBe(0o600);
  const value = JSON.parse(readFileSync(configPath, 'utf8'));
  expect(value.surface.mode).toBe('marketplace');
  expect(value.deck?.brightness).toBe(stage === 'rename' ? 42 : undefined);
});

it('serializes setup creation after an absent-file save without overlaying defaults', async () => {
  rmSync(configPath);
  const owner = start('settings', 'read');
  await owner.ready;
  expect((await start('initialize').done).output).toMatch(/being updated/);
  expect(existsSync(configPath)).toBe(false);
  owner.release(); expect((await owner.done).code).toBe(0);
  const saved = readFileSync(configPath, 'utf8');
  expect((await start('initialize').done).code).toBe(0);
  expect(readFileSync(configPath, 'utf8')).toBe(saved);
});

it('preserves initialized defaults when a competing save retries', async () => {
  rmSync(configPath);
  const owner = start('initialize', 'created');
  await owner.ready;
  expect((await start('settings').done).output).toMatch(/being updated/);
  expect((await start('initialize').done).output).toMatch(/being updated/);
  owner.release(); expect((await owner.done).code).toBe(0);
  expect((await start('settings').done).code).toBe(0);
  expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({ attachExternal: true, slots: { count: 15 }, admin: { port: 17531 }, deck: { brightness: 42 } });
});

it.each(['create', 'partial-create', 'created'])('retains first-creation semantics after owner death at %s', async stage => {
  rmSync(configPath);
  const owner = start('initialize', stage);
  await owner.ready; owner.child.kill('SIGKILL'); await owner.done;
  if (stage === 'partial-create') {
    const partial = readFileSync(configPath, 'utf8');
    expect((await start('initialize').done).code).toBe(0); // No overwrite; native load then rejects invalid data.
    expect((await start('settings').done).output).toMatch(/invalid config/);
    expect(readFileSync(configPath, 'utf8')).toBe(partial);
  } else {
    expect((await start('initialize').done).code).toBe(0);
    expect((await start('settings').done).code).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({ attachExternal: true, deck: { brightness: 42 } });
  }
});

it('preserves every disjoint field when five actual writers start together and retry busy only', async () => {
  const operations = ['settings', 'edition', 'endpoint', 'workflows', 'layout'];
  const workers = operations.map(operation => start(operation, 'start'));
  await Promise.all(workers.map(worker => worker.ready));
  workers.forEach(worker => worker.release());
  await Promise.all(workers.map(async (worker, index) => {
    let result = await worker.done;
    for (let attempt = 0; result.code !== 0 && /being updated/.test(result.output) && attempt < 10; attempt++) result = await start(operations[index]).done;
    expect(result.code, result.output + result.stderr).toBe(0);
  }));
  expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({ fixture: 'preserve', deck: { brightness: 42 }, surface: { mode: 'marketplace' }, appServer: { url: 'ws://127.0.0.1:17532' }, workflows: [{ id: 'fixture' }], layout: [{ keyIndex: 0 }] });
});

it.each(['target-link', 'parent-link', 'case', 'relative'])('uses the same directory lock for %s aliases', async kind => {
  let alias: string;
  if (kind === 'target-link') { alias = join(root, 'alias.json'); symlinkSync(configPath, alias); }
  else if (kind === 'parent-link') { const dir = join(root, 'alias'); symlinkSync(root, dir); alias = join(dir, 'config.json'); }
  else if (kind === 'case') { alias = join(root, 'CONFIG.JSON'); }
  else { alias = join(root, '.', 'config.json'); }
  const owner = start('settings', 'read'); await owner.ready;
  expect((await start('edition', '', false, alias).done).output).toMatch(/being updated/);
  owner.release(); await owner.done;
});
