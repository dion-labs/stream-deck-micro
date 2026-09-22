import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const faults = vi.hoisted(() => ({ stage: '' }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      if (faults.stage === 'open-existing') {
        fs.writeFileSync(args[0], 'existing staging fixture', { flag: 'wx', mode: 0o600 });
        throw Object.assign(new Error('fixture existing file'), { code: 'EEXIST' });
      }
      return fs.openSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (faults.stage === 'write') {
        fs.writeFileSync(args[0], String(args[1]).slice(0, 5), args[2]);
        throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
      }
      return fs.writeFileSync(...args);
    },
    fsyncSync: (fd: number) => {
      if (faults.stage === 'sync') throw new Error('fixture sync failure');
      return fs.fsyncSync(fd);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (faults.stage === 'rename') throw new Error('fixture rename failure');
      return fs.renameSync(...args);
    },
  };
});
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DECK_SETTINGS, saveAppServerUrl, saveDeckLayout, saveDeckSettings, saveSurfaceMode, saveWorkflows } from './config.js';
let directory: string;
let path: string;
const original = JSON.stringify({ fixture: 'Keep every original byte.', admin: { port: 18531 } }, null, 2) + '\n';
beforeEach(() => {
  faults.stage = '';
  directory = mkdtempSync(join(tmpdir(), 'sdm-atomic-'));
  path = join(directory, 'config.json');
  writeFileSync(path, original, { mode: 0o640 });
});
afterEach(() => { faults.stage = ''; rmSync(directory, { recursive: true, force: true }); });
const writers = [
  ['workflows', () => saveWorkflows(path, [{ id: 'fixture', name: 'FIXTURE', prompt: 'Synthetic' }], [])],
  ['settings', () => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)],
  ['layout', () => saveDeckLayout(path, [{ keyIndex: 0, action: { kind: 'slot', index: 0 } }])],
  ['endpoint', () => saveAppServerUrl(path, 'ws://127.0.0.1:17532')],
  ['edition', () => saveSurfaceMode(path, 'marketplace')],
] as const;

describe.each(writers)('%s atomic config persistence', (_, save) => {
  it.each(['write', 'sync', 'rename'])('preserves original after %s failure, cleans temp files, and permits retry', stage => {
    faults.stage = stage;
    expect(save).toThrow(/fixture/);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(readdirSync(directory)).toEqual(['config.json']);
    faults.stage = '';
    save();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ fixture: 'Keep every original byte.', admin: { port: 18531 } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual(['config.json']);
  });
  it('never removes a staging path it failed to create exclusively', () => {
    faults.stage = 'open-existing';
    expect(save).toThrow('fixture existing file');
    expect(readFileSync(path, 'utf8')).toBe(original);
    const retained = readdirSync(directory).filter(name => name.endsWith('.tmp'));
    expect(retained).toHaveLength(1);
    expect(readFileSync(join(directory, retained[0]), 'utf8')).toBe('existing staging fixture');
  });
  it('preserves a config symlink and updates its target privately', () => {
    const target = path;
    path = join(directory, 'linked.json');
    symlinkSync(target, path);
    save();
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).not.toBe(original);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toMatchObject({ fixture: 'Keep every original byte.' });
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
  it('refuses a dangling config symlink without creating or replacing its target', () => {
    const missing = join(directory, 'missing.json');
    path = join(directory, 'linked.json');
    symlinkSync(missing, path);
    expect(save).toThrow();
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(existsSync(missing)).toBe(false);
  });
  it.skipIf(process.getuid?.() === 0)('respects an existing read-only config', () => {
    chmodSync(path, 0o400);
    expect(save).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});


it('preserves original bytes if its owned writer exits before the atomic commit', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const write = fs.writeFileSync;
    fs.writeFileSync = (...args) => {
      write(...args);
      if (typeof args[0] === 'number') {
        fs.writeSync(1, 'staged');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
    };
    syncBuiltinESMExports();
    const { saveWorkflows } = await import(${JSON.stringify(new URL('./config.ts', import.meta.url).href)});
    saveWorkflows(process.argv[1], [], []);
  `, path], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', TMPDIR: directory } });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      once(child.stdout!, 'data'),
      once(child, 'exit').then(() => { throw new Error('Writer exited before staging'); }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Writer staging timeout')), 5000); }),
    ]);
    const exited = once(child, 'exit');
    child.kill('SIGKILL'); // Only the disposable child spawned above.
    await exited;
    expect(readFileSync(path, 'utf8')).toBe(original);
    const staging = readdirSync(directory).filter(name => name.endsWith('.tmp'));
    expect(staging).toHaveLength(1);
    expect(statSync(join(directory, staging[0])).mode & 0o777).toBe(0o600);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
}, 10_000);
