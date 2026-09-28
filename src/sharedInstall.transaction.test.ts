import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string;
let statePath: string;
const children = new Set<ChildProcess>();
const completions: Promise<unknown>[] = [];
const runtimeRoot = process.env.SDM_RUNTIME_ROOT;
const moduleDirectory = runtimeRoot ? join(runtimeRoot, 'dist') : fileURLToPath(new URL('.', import.meta.url));
const workerNode = runtimeRoot ? join(runtimeRoot, 'bin/node') : process.execPath;
const fixture = fileURLToPath(new URL('../scripts/fixtures/shared-install-writer.mjs', import.meta.url));
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'micro-install-txn-')));
  const directory = join(root, '.stream-deck-micro'); mkdirSync(directory);
  statePath = join(directory, 'shared-server.json');
  const expected = { mode: 'desktop-launch', url: 'ws://127.0.0.1:17532',
    codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex',
    configPath: join(directory, 'config.json'), launcherPath: join(directory, 'codex-desktop'),
    fingerprint: 'a'.repeat(64), token: 'b'.repeat(64), version: 'synthetic-old', autoConnect: true };
  writeFileSync(statePath, JSON.stringify(expected));
  writeFileSync(join(root, 'expected.json'), JSON.stringify(expected));
});
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
    }
  }
  await Promise.allSettled(completions.splice(0)); children.clear();
  rmSync(root, { recursive: true, force: true });
});
function start(operation: string, pause = '') {
  const child = spawn(workerNode, [...(runtimeRoot ? [] : ['--import', 'tsx']), fixture,
    moduleDirectory, runtimeRoot ? 'js' : 'ts', root, operation, pause], {
    env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '', stderr = '';
  let readyResolve: () => void, readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  child.stdout!.on('data', data => { output += data.toString(); if (output.includes('"ready":')) readyResolve(); });
  child.stderr!.on('data', data => { stderr += data.toString(); });
  const done = new Promise<{ code: number | null; output: string; stderr: string }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fixture exit deadline')); }, 14000);
    child.once('error', error => { clearTimeout(timer); readyReject(error); reject(error); });
    child.once('close', code => { clearTimeout(timer); readyReject(new Error('fixture exited')); resolve({ code, output, stderr }); });
  });
  completions.push(done);
  return { ready, done, release: () => writeFileSync(join(root, `release-${child.pid}`), '') };
}

it.each(['verify', 'enable', 'delete', 'replace'])('serializes %s against verification after comparison but before atomic save', async operation => {
  const owner = start('verify', 'commit'); await owner.ready;
  const before = readFileSync(statePath, 'utf8');
  const contender = await start(operation).done;
  expect(contender.code, contender.output + contender.stderr).toBe(1);
  expect(contender.output).toContain('being updated');
  expect(readFileSync(statePath, 'utf8')).toBe(before);
  owner.release();
  const committed = await owner.done; expect(committed.code, committed.output + committed.stderr).toBe(0);
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  expect(saved.codexPath).toContain('/codex-cli/CodexCLI.app/');
  expect(saved.fingerprint).toBe('c'.repeat(64)); expect(saved.verificationGeneration).toBeTruthy();
  const stale = await start('verify').done;
  expect(stale.code).toBe(1); expect(stale.output).toContain('installation changed');
  expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual(saved);
}, 20000);

it.each(['delete', 'replace'])('does not hold the lock during a probe or overwrite a concurrent %s', async operation => {
  const probe = start('verify', 'probe'); await probe.ready;
  const mutation = await start(operation).done;
  expect(mutation.code, mutation.output + mutation.stderr).toBe(0);
  probe.release();
  const rejected = await probe.done;
  expect(rejected.code).toBe(1); expect(rejected.output).toContain('installation changed');
  if (operation === 'delete') expect(existsSync(statePath)).toBe(false);
  else expect(JSON.parse(readFileSync(statePath, 'utf8')).token).toBe('d'.repeat(64));
}, 20000);
