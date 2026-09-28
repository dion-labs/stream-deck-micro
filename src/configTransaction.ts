import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// Darwin sys/fcntl.h. Node's constants omit O_EXLOCK; never use this on another OS.
const DARWIN_O_EXLOCK = 0x20;
export const CONFIG_LOCK_NAME = '.stream-deck-micro-config.lock';

/** A cleanup error cannot turn a committed write into a retryable failure. */
export function reportConfigCleanupFailure(kind: 'lock' | 'initial file' = 'lock'): void {
  try {
    process.emitWarning(
      `Configuration ${kind} descriptor cleanup could not be confirmed. Completed writes remain saved; further saves may be blocked until this process exits.`,
      { code: kind === 'lock' ? 'SDM_CONFIG_LOCK_CLEANUP' : 'SDM_CONFIG_CREATE_CLEANUP' },
    );
  } catch { /* Diagnostic delivery must not change the transaction outcome. */ }
}

function inspectTarget(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.nlink !== 1) throw new Error('Configuration must be a regular file with one link.');
    return info;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Keep a permanent private inode: unlinking a held sidecar would split ownership.
 * Kernel descriptor lifetime handles crashes; timestamps/PIDs never grant access.
 */
export function withConfigTransaction<T>(path: string, createParents: boolean, transaction: (target: string) => T): T {
  if (process.platform !== 'darwin') throw new Error('Configuration transactions require macOS kernel file locking.');
  const requested = resolve(path);
  if (createParents) mkdirSync(dirname(requested), { recursive: true, mode: 0o700 });
  let target = requested;
  try {
    // Pin symlinks and canonical spelling once; dangling links require repair.
    lstatSync(requested);
    target = realpathSync(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Distinguish an absent config from an existing dangling symlink.
    try { if (lstatSync(requested).isSymbolicLink()) throw new Error('Configuration symlink target is missing.'); }
    catch (check) { if ((check as NodeJS.ErrnoException).code !== 'ENOENT') throw check; }
  }
  const parent = realpathSync(dirname(target));
  target = join(parent, basename(target));
  inspectTarget(target);
  let descriptor: number;
  try {
    descriptor = openSync(join(parent, CONFIG_LOCK_NAME), constants.O_CREAT | constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW | DARWIN_O_EXLOCK, 0o600);
  } catch (error) {
    if (['EAGAIN', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw Object.assign(new Error('Configuration is being updated; try again.'), { code: 'SDM_CONFIG_BUSY' });
    }
    throw error;
  }
  try {
    const lock = fstatSync(descriptor);
    if (!lock.isFile() || lock.nlink !== 1 || lock.uid !== process.geteuid?.() || (lock.mode & 0o077) !== 0) {
      throw new Error('Configuration lock must be a private, single-link regular file owned by the current user.');
    }
    inspectTarget(target);
    return transaction(target);
  } finally {
    try { closeSync(descriptor); } catch { reportConfigCleanupFailure(); }
  }
}
