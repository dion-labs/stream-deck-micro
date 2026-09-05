import { desktopAppIsRunning, installSharedServer, restartSharedCodexDesktop } from './sharedServer.js';

export interface SharedReconnectDependencies {
  running(): boolean;
  verify(configPath: string | undefined, endpoint: string): Promise<unknown>;
  restart(endpoint: string): Promise<void>;
}
/** Explicit recovery only: verify and rearm the failed launch before any restart. */
export async function reconnectSharedDesktop(configPath: string | undefined, endpoint: string,
  restartApproved: boolean, deps: SharedReconnectDependencies = {
    running: desktopAppIsRunning, verify: installSharedServer, restart: restartSharedCodexDesktop,
  }): Promise<void> {
  if (deps.running() && !restartApproved) throw new Error('Reconnecting requires reopening Codex. Confirm when active work can be interrupted.');
  await deps.verify(configPath, endpoint);
  // Codex may have opened while the isolated compatibility check was running.
  if (deps.running() && !restartApproved) throw new Error('Codex opened during verification. Confirm before reconnecting; it was left untouched.');
  await deps.restart(endpoint);
}
