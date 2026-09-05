import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IPC_SOCKET } from './config.js';
import { ipcCall } from './ipc.js';
import { ensureMarketplaceService } from './marketplaceService.js';
import { verifyAutomaticDesktop } from './automaticVerification.js';
import { desktopBuildFingerprint, readSharedInstall, type DesktopSharedInstall } from './sharedRuntime.js';
import { desktopAppIsRunning, sharedDesktopOpenArguments } from './sharedServer.js';

export interface LauncherStatus {
  surface: string;
  desktop: { state: string; sessionsReady: boolean; message?: string; restoreError?: string | null };
}
export interface LauncherResult { state: 'connected' | 'already-running'; message: string }
export interface LauncherDependencies {
  install(): DesktopSharedInstall | null;
  running(): boolean;
  ensureService(): Promise<void>;
  fingerprint(): Promise<string>;
  verify(install: DesktopSharedInstall): Promise<string>;
  open(): Promise<void>;
  status(): Promise<LauncherStatus>;
  wait(ms: number): Promise<void>;
}
const defaults: LauncherDependencies = {
  install: readSharedInstall, running: desktopAppIsRunning, ensureService: ensureMarketplaceService,
  fingerprint: desktopBuildFingerprint, verify: verifyAutomaticDesktop,
  open: async () => { await promisify(execFile)('/usr/bin/open', sharedDesktopOpenArguments(), { timeout: 10_000 }); },
  status: () => ipcCall(IPC_SOCKET, 'status', {}, 1000),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Open the dashboard independently of Codex, including while tasks are active. */
export async function prepareControlCenter(
  ensureService: () => Promise<void> = ensureMarketplaceService,
): Promise<{ state: 'dashboard'; message: string }> {
  await ensureService();
  return { state: 'dashboard', message: 'Local Control Center ready. Existing Codex sessions were left untouched.' };
}

/** Only the launcher opens Desktop. There is deliberately no quit/restart operation. */
export async function launchDesktop(
  progress: (message: string) => void = () => {},
  deps: LauncherDependencies = defaults,
): Promise<LauncherResult> {
  const install = deps.install();
  if (!install) throw new Error('Shared control is not installed. Run shared install first.');
  progress('Starting the Stream Deck service…');
  await deps.ensureService();
  async function existing(): Promise<LauncherResult> {
    const status = await deps.status();
    if (status.desktop.state === 'connected' && status.desktop.sessionsReady) {
      return { state: 'connected', message: 'Codex and Stream Deck are connected.' };
    }
    return { state: 'already-running', message: 'ChatGPT is already running. Your sessions were left untouched. When you finish them, quit ChatGPT and open Codex + Stream Deck.' };
  }
  if (deps.running()) return existing();
  progress('Checking Codex compatibility…');
  if (await deps.fingerprint() !== install.fingerprint) {
    if (!install.autoConnect) throw new Error('Enable automatic connection before launching an updated Codex build.');
    await deps.verify(install);
  }
  // Someone may have opened the app during verification. Do not start another instance.
  if (deps.running()) return existing();
  progress('Opening ChatGPT with Stream Deck connected…');
  await deps.open();
  progress('Waiting for Codex and your session buttons…');
  let lastMessage = 'The connection did not become ready.';
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const status = await deps.status();
      if (status.desktop.state === 'connected' && status.desktop.sessionsReady) {
        return { state: 'connected', message: 'Codex and Stream Deck are connected.' };
      }
      lastMessage = status.desktop.restoreError || status.desktop.message || lastMessage;
      if (status.desktop.state === 'restart-required' || status.desktop.state === 'unavailable') {
        throw new Error(`Codex opened but shared control is unavailable. ${lastMessage}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Codex opened')) throw error;
      lastMessage = error instanceof Error ? error.message : String(error);
    }
    await deps.wait(500);
  }
  throw new Error(`${lastMessage} ChatGPT was left running; no sessions were restarted.`);
}
