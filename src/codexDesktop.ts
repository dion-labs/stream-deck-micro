import { execFile } from 'node:child_process';
import { cleanDesktopEnvironment } from './sharedRuntime.js';

type CommandRunner = (command: string, args: string[]) => Promise<void>;

export function codexThreadDeepLink(threadId: string): string {
  const normalized = threadId.trim();
  if (!normalized) throw new Error('Codex thread id is required');
  return `codex://threads/${encodeURIComponent(normalized)}`;
}

/** Bring Codex Desktop forward and navigate its main window to one thread. */
export function openCodexThread(
  threadId: string,
  run: CommandRunner = runCommand,
): Promise<void> {
  return run('/usr/bin/open', [
    '-a',
    'ChatGPT',
    codexThreadDeepLink(threadId),
  ]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { timeout: 10_000, env: cleanDesktopEnvironment(process.env) }, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}
