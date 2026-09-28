import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyDesktopServer } from './desktopCompatibility.js';
import { desktopBuildFingerprint, DESKTOP_ARCHIVE, type DesktopSharedInstall } from './sharedRuntime.js';
import { resolveDesktopExecutable } from './desktopExecutable.js';
import { updateSharedInstall } from './sharedInstall.js';

/** Transport/startup failures can be transient; failed compatibility assertions cannot. */
export function isTransientVerificationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:ECONNRESET|ECONNREFUSED|EADDRINUSE|ETIMEDOUT|EPIPE)\b|timed?\s*out|No ephemeral listener announced|Desktop changed during compatibility verification|^shared server exited during startup$/i.test(message);
}

interface VerificationOptions {
  fingerprint?: (files: string[]) => Promise<string>;
  resolveBinary?: () => string;
  verify?: typeof verifyDesktopServer;
  updateInstall?: typeof updateSharedInstall;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown) => void;
}

/** Each attempt uses a fresh isolated probe. Never approves a failed check. */
export async function verifyAutomaticDesktop(
  install: DesktopSharedInstall,
  options: VerificationOptions = {},
): Promise<string> {
  const fingerprint = options.fingerprint ?? desktopBuildFingerprint;
  const verify = options.verify ?? verifyDesktopServer;
  const updateInstall = options.updateInstall ?? updateSharedInstall;
  const resolveBinary = options.resolveBinary ?? resolveDesktopExecutable;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const binary = resolveBinary();
      const files = [binary, DESKTOP_ARCHIVE];
      const before = await fingerprint(files);
      options.signal?.throwIfAborted();
      const result = await verify(binary);
      options.signal?.throwIfAborted();
      if (before !== await fingerprint(files) || resolveBinary() !== binary) throw new Error('Desktop changed during compatibility verification');
      options.signal?.throwIfAborted();
      updateInstall(current => {
        if (!current || !current.autoConnect || current.token !== install.token
          || current.url !== install.url || current.fingerprint !== install.fingerprint
          || current.codexPath !== install.codexPath || current.verificationGeneration !== install.verificationGeneration
          || current.configPath !== install.configPath || current.launcherPath !== install.launcherPath) {
          throw new Error('Shared installation changed during verification');
        }
        if (resolveBinary() !== binary) throw new Error('Desktop changed during compatibility verification');
        return { ...current, codexPath: binary, fingerprint: before, version: result.version, verificationGeneration: randomUUID() };
      });
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
