import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const injection = vi.hoisted(() => ({ race: '', sync: false }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === injection.race && args[1] === 'wx') {
        fs.writeFileSync(args[0], '{"external":"preserve"}', { flag: 'wx', mode: 0o600 });
      }
      return fs.openSync(...args);
    },
    fsyncSync: (fd: number) => { if (injection.sync) throw new Error('initial sync fixture'); return fs.fsyncSync(fd); },
  };
});
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigIfAbsent, DEFAULT_DECK_SETTINGS, saveDeckSettings } from './config.js';
import { CONFIG_LOCK_NAME, withConfigTransaction } from './configTransaction.js';
let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'sdm-boundaries-'))); injection.race = ''; injection.sync = false; });
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('retains exclusive no-overwrite semantics against a noncooperating creator', () => {
  const path = join(root, 'config.json'); injection.race = path;
  expect(createConfigIfAbsent(path, { defaults: true })).toBe(false);
  expect(readFileSync(path, 'utf8')).toBe('{"external":"preserve"}');
});
it('does not contend across independent canonical directories', () => {
  const a = join(root, 'a'), b = join(root, 'b'); mkdirSync(a); mkdirSync(b);
  withConfigTransaction(join(a, 'config.json'), false, () => {
    expect(() => saveDeckSettings(join(b, 'config.json'), DEFAULT_DECK_SETTINGS)).not.toThrow();
  });
});
it('refuses a FIFO sidecar without blocking or replacing it', () => {
  const lock = join(root, CONFIG_LOCK_NAME); execFileSync('/usr/bin/mkfifo', [lock]);
  expect(() => saveDeckSettings(join(root, 'config.json'), DEFAULT_DECK_SETTINGS)).toThrow();
  expect(statSync(lock).isFIFO()).toBe(true); expect(existsSync(join(root, 'config.json'))).toBe(false);
});
it('retains complete initial bytes on sync failure and releases the lock', () => {
  const path = join(root, 'config.json'); injection.sync = true;
  expect(() => createConfigIfAbsent(path, { fixture: true })).toThrow('initial sync fixture');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ fixture: true });
  injection.sync = false; expect(createConfigIfAbsent(path, {})).toBe(false);
  saveDeckSettings(path, DEFAULT_DECK_SETTINGS);
  expect(JSON.parse(readFileSync(path, 'utf8')).fixture).toBe(true);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
