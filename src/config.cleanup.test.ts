import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const faults = vi.hoisted(() => ({ close: false, stagingClose: false, stagingCloses: 0, stagingFd: -1, closeAttempts: [] as number[], write: false, unsupported: false, wrongOwner: false, descriptors: new Map<number, string>(), leaked: [] as number[], closes: 0 }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      if (faults.unsupported && String(args[0]).endsWith('.lock')) throw Object.assign(new Error('unsupported fixture'), { code: 'EOPNOTSUPP' });
      const fd = fs.openSync(...args); faults.descriptors.set(fd, String(args[0])); return fd;
    },
    fstatSync: (fd: number) => {
      const result = fs.fstatSync(fd);
      if (faults.wrongOwner) Object.defineProperty(result, 'uid', { value: -1 });
      return result;
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (faults.write && typeof args[0] === 'number') throw new Error('primary write fixture');
      return fs.writeFileSync(...args);
    },
    closeSync: (fd: number) => {
      faults.closeAttempts.push(fd);
      if (faults.stagingClose && faults.descriptors.get(fd)?.endsWith('.tmp')) {
        faults.stagingCloses++; faults.stagingFd = fd; faults.descriptors.delete(fd); fs.closeSync(fd); throw new Error('staging close fixture');
      }
      if (faults.descriptors.get(fd)?.endsWith('.lock')) {
        faults.closes++;
        if (faults.close) { faults.leaked.push(fd); throw new Error('cleanup fixture'); }
      }
      faults.descriptors.delete(fd); return fs.closeSync(fd);
    },
  };
});
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DECK_SETTINGS, createConfigIfAbsent, saveAppServerUrl, saveDeckSettings, saveWorkflows, saveDeckLayout } from './config.js';
import { CONFIG_LOCK_NAME, withConfigTransaction } from './configTransaction.js';
import { persistDeckSettings } from './core/persistDeckSettings.js';
let root: string, path: string;
let warning: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sdm-cleanup-')); path = join(root, 'config.json');
  faults.stagingClose = false; faults.stagingCloses = 0; faults.stagingFd = -1; faults.closeAttempts.length = 0;
  faults.close = faults.write = faults.unsupported = faults.wrongOwner = false; faults.closes = 0;
  writeFileSync(path, JSON.stringify({ deck: DEFAULT_DECK_SETTINGS, fixture: 'preserve' }));
  warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
});
afterEach(async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  for (const fd of faults.leaked.splice(0)) { real.closeSync(fd); faults.descriptors.delete(fd); }
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
it('publishes committed disk state through the actual main settings helper despite lock-close failure', () => {
  const state = { deck: DEFAULT_DECK_SETTINGS };
  const candidate = { ...state.deck, brightness: 42 };
  const publish = vi.fn(); faults.close = true;
  expect(persistDeckSettings(state, path, candidate, publish)).toBe(path);
  expect(state.deck).toBe(candidate); expect(publish).toHaveBeenCalledWith(candidate);
  expect(JSON.parse(readFileSync(path, 'utf8')).deck).toEqual(candidate);
  expect(warning).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Completed writes remain saved'), { code: 'SDM_CONFIG_LOCK_CLEANUP' });
  expect(faults.closes).toBe(1);
});
it('preserves original error, disk and memory when both precommit write and lock cleanup fail', () => {
  const state = { deck: DEFAULT_DECK_SETTINGS }, before = readFileSync(path, 'utf8'), publish = vi.fn();
  faults.write = faults.close = true;
  expect(() => persistDeckSettings(state, path, { ...state.deck, brightness: 42 }, publish)).toThrow('primary write fixture');
  expect(state.deck).toBe(DEFAULT_DECK_SETTINGS); expect(publish).not.toHaveBeenCalled();
  expect(readFileSync(path, 'utf8')).toBe(before); expect(warning).toHaveBeenCalledOnce(); expect(faults.closes).toBe(1);
});
it('cannot turn a committed save into failure when diagnostic delivery itself throws', () => {
  faults.close = true; warning.mockImplementation(() => { throw new Error('warning fixture'); });
  expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).not.toThrow();
});
it.each(['unsupported', 'wrong-owner'])('fails closed for %s lock', kind => {
  const before = readFileSync(path, 'utf8'); faults.unsupported = kind === 'unsupported'; faults.wrongOwner = kind === 'wrong-owner';
  expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).toThrow();
  expect(readFileSync(path, 'utf8')).toBe(before);
});
it.each(['symlink', 'hardlink', 'public', 'directory'])('preserves unsafe %s sidecars and config', kind => {
  const lock = join(root, CONFIG_LOCK_NAME), other = join(root, 'other');
  writeFileSync(other, 'untouched');
  if (kind === 'symlink') symlinkSync(other, lock);
  else if (kind === 'hardlink') linkSync(other, lock);
  else if (kind === 'directory') mkdirSync(lock);
  else { writeFileSync(lock, 'untouched'); chmodSync(lock, 0o644); }
  const before = readFileSync(path, 'utf8');
  expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).toThrow();
  expect(readFileSync(path, 'utf8')).toBe(before); expect(existsSync(lock)).toBe(true); expect(readFileSync(other, 'utf8')).toBe('untouched');
});
it('rejects hardlinked configs without modifying either name', () => {
  const alias = join(root, 'hardlink'); linkSync(path, alias);
  const before = readFileSync(path, 'utf8'); expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).toThrow(/one link/);
  expect(readFileSync(alias, 'utf8')).toBe(before);
});
it('releases ownership after an update callback fails', () => {
  expect(() => withConfigTransaction(path, false, () => { throw new Error('callback fixture'); })).toThrow('callback fixture');
  expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).not.toThrow();
});
it('endpoint removal does not create an absent config or parent', () => {
  const absent = join(root, 'absent', 'config.json'); saveAppServerUrl(absent, null); expect(existsSync(join(root, 'absent'))).toBe(false);
  rmSync(path); saveAppServerUrl(path, null); expect(existsSync(path)).toBe(false);
});
it.each(['{broken', '{"custom":true}'])('initializer preserves existing content %s', value => {
  writeFileSync(path, value); expect(createConfigIfAbsent(path, { defaults: true })).toBe(false); expect(readFileSync(path, 'utf8')).toBe(value);
});
it('initializer preserves even a read-only existing file', () => {
  const before = readFileSync(path, 'utf8'); chmodSync(path, 0o400);
  expect(createConfigIfAbsent(path, {})).toBe(false); expect(readFileSync(path, 'utf8')).toBe(before);
});

it('never retries staging close after a failure that already released its fd', () => {
  const before = readFileSync(path, 'utf8'); faults.stagingClose = true;
  expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).toThrow('staging close fixture');
  expect(faults.stagingCloses).toBe(1);
  expect(faults.closeAttempts.filter(fd => fd === faults.stagingFd)).toHaveLength(1);
  expect(readFileSync(path, 'utf8')).toBe(before);
  faults.stagingClose = false;
  expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).not.toThrow();
});

it('actual settings caller retains memory on a busy lock and succeeds on explicit retry', () => {
  const state = { deck: DEFAULT_DECK_SETTINGS }, candidate = { ...DEFAULT_DECK_SETTINGS, brightness: 42 }, publish = vi.fn();
  const before = readFileSync(path, 'utf8');
  withConfigTransaction(path, false, () => {
    expect(() => persistDeckSettings(state, path, candidate, publish)).toThrow(/being updated/);
    expect(state.deck).toBe(DEFAULT_DECK_SETTINGS); expect(publish).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
  persistDeckSettings(state, path, candidate, publish);
  expect(state.deck).toBe(candidate); expect(publish).toHaveBeenCalledOnce();
});
it.each(['workflows', 'layout'])('%s save preserves committed success for post-save caller publication', field => {
  faults.close = true;
  const value = field === 'workflows' ? [{ id: 'fixture', name: 'FIXTURE', prompt: 'Synthetic' }] : [{ keyIndex: 0, action: { kind: 'slot' as const, index: 0 } }];
  let published = false;
  if (field === 'workflows') saveWorkflows(path, value as Parameters<typeof saveWorkflows>[1], []);
  else saveDeckLayout(path, value as Parameters<typeof saveDeckLayout>[1]);
  published = true;
  expect(published).toBe(true); expect(JSON.parse(readFileSync(path, 'utf8'))[field]).toEqual(value); expect(warning).toHaveBeenCalledOnce();
});
it('rejects unsupported platforms before mutation', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const before = readFileSync(path, 'utf8');
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(() => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)).toThrow(/require macOS/);
  } finally { Object.defineProperty(process, 'platform', platform); }
  expect(readFileSync(path, 'utf8')).toBe(before); expect(existsSync(join(root, CONFIG_LOCK_NAME))).toBe(false);
});
