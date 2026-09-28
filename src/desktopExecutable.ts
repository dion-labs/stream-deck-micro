import { accessSync, constants, lstatSync } from 'node:fs';
import { join } from 'node:path';

export const DESKTOP_BUNDLE = '/Applications/ChatGPT.app';
export const LEGACY_CLI = 'Contents/Resources/codex';
export const MODERN_CLI = 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
export const DESKTOP_CODEX = join(DESKTOP_BUNDLE, LEGACY_CLI);
export const MODERN_DESKTOP_CODEX = join(DESKTOP_BUNDLE, MODERN_CLI);

export function isKnownDesktopExecutable(path: unknown): path is string {
  return path === DESKTOP_CODEX || path === MODERN_DESKTOP_CODEX;
}

/** The bundle argument exists for disposable tests; production uses the fixed root. */
export function resolveDesktopExecutable(bundle = DESKTOP_BUNDLE): string {
  const root = lstatSync(bundle);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Desktop bundle must be a directory, not a symlink');
  for (const relative of [MODERN_CLI, LEGACY_CLI]) {
    let candidate = bundle;
    const components = relative.split('/');
    let absent = false;
    for (const [index, component] of components.entries()) {
      candidate = join(candidate, component);
      let info;
      try { info = lstatSync(candidate); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { absent = true; break; }
        throw error;
      }
      if (info.isSymbolicLink() || (index < components.length - 1 ? !info.isDirectory() : !info.isFile())) {
        throw new Error('Desktop executable layout contains an invalid file or symlink; wait for the update or repair Desktop');
      }
    }
    if (absent) continue;
    accessSync(candidate, constants.X_OK);
    return candidate;
  }
  throw new Error('Desktop bundled Codex executable was not found; install or finish updating Desktop');
}
