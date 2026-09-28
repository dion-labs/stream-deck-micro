import { lstatSync, rmSync } from 'node:fs';
import { withConfigTransaction } from './configTransaction.js';
import { writeConfigAtomically } from './config.js';
import { readSharedInstall, SHARED_INSTALL_STATE, type DesktopSharedInstall } from './sharedRuntime.js';

/** Every same-version installation writer uses this lock, including deletion. */
export function updateSharedInstall(
  update: (current: DesktopSharedInstall | null) => DesktopSharedInstall | null,
): DesktopSharedInstall | null {
  function rejectSymlink(): void {
    try {
      if (lstatSync(SHARED_INSTALL_STATE).isSymbolicLink()) throw new Error('Shared installation state must not be a symlink');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  rejectSymlink();
  return withConfigTransaction(SHARED_INSTALL_STATE, true, target => {
    rejectSymlink();
    const next = update(readSharedInstall(target));
    if (next) writeConfigAtomically(target, { ...next });
    else rmSync(target, { force: true });
    return next;
  });
}

export function enableSharedAutoconnect(): void {
  updateSharedInstall(current => {
    if (!current) throw new Error('Run shared install first');
    return { ...current, autoConnect: true };
  });
}
