import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_CLI, MODERN_CLI, resolveDesktopExecutable } from './desktopExecutable.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'micro-executable-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function executable(relative: string): string {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'synthetic executable, never launched', { mode: 0o700 });
  return path;
}

describe('fixed Desktop executable discovery', () => {
  it.each([['modern', MODERN_CLI], ['legacy', LEGACY_CLI]])('selects the %s layout', (_name, relative) => {
    const binary = executable(relative);
    expect(resolveDesktopExecutable(root)).toBe(binary);
  });
  it('prefers modern when both valid layouts exist', () => {
    executable(LEGACY_CLI);
    const modern = executable(MODERN_CLI);
    expect(resolveDesktopExecutable(root)).toBe(modern);
  });
  it('rejects absence without searching PATH', () => {
    executable('bin/codex');
    expect(() => resolveDesktopExecutable(root)).toThrow('not found');
  });
  it.each(['directory', 'non-executable', 'symlink', 'dangling-symlink', 'intermediate-file', 'intermediate-symlink'])
    ('fails closed on an invalid modern %s even with a valid legacy file', kind => {
      executable(LEGACY_CLI);
      const modern = join(root, MODERN_CLI);
      mkdirSync(dirname(modern), { recursive: true });
      if (kind === 'directory') mkdirSync(modern);
      if (kind === 'non-executable') { executable(MODERN_CLI); chmodSync(modern, 0o600); }
      if (kind === 'symlink') symlinkSync(executable('external'), modern);
      if (kind === 'dangling-symlink') symlinkSync(join(root, 'absent'), modern);
      if (kind.startsWith('intermediate-')) {
        const intermediate = join(root, 'Contents/Resources/codex-cli');
        rmSync(intermediate, { recursive: true });
        if (kind === 'intermediate-file') writeFileSync(intermediate, 'invalid');
        else { mkdirSync(join(root, 'external')); symlinkSync(join(root, 'external'), intermediate); }
      }
      expect(() => resolveDesktopExecutable(root)).toThrow();
    });
  it('rejects a symlinked configured bundle root', () => {
    const actual = join(root, 'actual'); mkdirSync(actual);
    const alias = join(root, 'alias'); symlinkSync(actual, alias);
    expect(() => resolveDesktopExecutable(alias)).toThrow('symlink');
  });
  it('rejects an external executable reached by a legacy symlink', () => {
    const external = executable('outside/codex');
    const legacy = join(root, LEGACY_CLI); mkdirSync(dirname(legacy), { recursive: true });
    symlinkSync(external, legacy);
    expect(() => resolveDesktopExecutable(root)).toThrow('symlink');
  });
});
