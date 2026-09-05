import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyDesktopServer } from './desktopCompatibility.js';
import { desktopBuildFingerprint, readSharedInstall, SHARED_INSTALL_STATE, type DesktopSharedInstall } from './sharedRuntime.js';

/** Transport/startup failures can be transient; failed compatibility assertions cannot. */
export function isTransientVerificationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:ECONNRESET|ECONNREFUSED|EADDRINUSE|ETIMEDOUT|EPIPE)\b|timed?\s*out|No ephemeral listener announced|Desktop changed during compatibility verification/i.test(message);
}

interface VerificationOptions {
  fingerprint?: () => Promise<string>;
  verify?: typeof verifyDesktopServer;
  readInstall?: typeof readSharedInstall;
  save?: (install: DesktopSharedInstall) => void;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown) => void;
}

function saveVerifiedInstall(install: DesktopSharedInstall): void {
  const temporary = `${SHARED_INSTALL_STATE}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(install, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, SHARED_INSTALL_STATE);
  } finally { rmSync(temporary, { force: true }); }
}

/** Each attempt uses a fresh isolated probe. Never approves a failed check. */
export async function verifyAutomaticDesktop(
  install: DesktopSharedInstall,
  options: VerificationOptions = {},
): Promise<string> {
  const fingerprint = options.fingerprint ?? desktopBuildFingerprint;
  const verify = options.verify ?? verifyDesktopServer;
  const readInstall = options.readInstall ?? readSharedInstall;
  const save = options.save ?? saveVerifiedInstall;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const before = await fingerprint();
      options.signal?.throwIfAborted();
      const result = await verify(install.codexPath);
      options.signal?.throwIfAborted();
      if (before !== await fingerprint()) throw new Error('Desktop changed during compatibility verification');
      options.signal?.throwIfAborted();
      const current = readInstall();
      if (!current || !current.autoConnect || current.token !== install.token
        || current.url !== install.url || current.fingerprint !== install.fingerprint) {
        throw new Error('Shared installation changed during verification');
      }
      save({ ...current, fingerprint: before, version: result.version, verificationGeneration: randomUUID() });
      return before;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (attempt === 2 || !isTransientVerificationFailure(error)) throw error;
      options.onRetry?.(attempt + 1, error);
      await wait(500 * (attempt + 1), options.signal);
    }
  }
  throw new Error('Automatic verification attempts exhausted');
}
