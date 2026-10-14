import { isTransientVerificationFailure, verifyAutomaticDesktop } from './automaticVerification.js';
import { desktopBuildFingerprint, readSharedInstall, readSharedRuntime, type DesktopSharedInstall, type DesktopSharedRuntime } from './sharedRuntime.js';

interface Dependencies {
  install(): DesktopSharedInstall | null;
  runtime(): DesktopSharedRuntime | null;
  fingerprint(): Promise<string>;
  verify: typeof verifyAutomaticDesktop;
  now(): number;
}
const defaults: Dependencies = {
  install: readSharedInstall, runtime: readSharedRuntime,
  fingerprint: desktopBuildFingerprint, verify: verifyAutomaticDesktop, now: Date.now,
};

/** Preparation only. This component has no open, quit, signal or RPC operation. */
export class AutomaticRecovery {
  status = { state: 'idle', message: '' };
  private pending: Promise<void> | null = null;
  private nextCheck = 0;
  private key = '';
  private attempts = 0;
  private finished = false;
  private abort = new AbortController();
  constructor(private endpoint: string, private deps: Dependencies = defaults) {}
  stop(): void { this.abort.abort(); }
  tick(connected: boolean): Promise<void> {
    if (this.pending) return this.pending;
    if (this.abort.signal.aborted || connected || this.deps.now() < this.nextCheck) return Promise.resolve();
    this.nextCheck = this.deps.now() + 30_000;
    this.pending = this.prepare().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async prepare(): Promise<void> {
    const install = this.deps.install();
    if (!install?.autoConnect || install.url !== this.endpoint) {
      this.status = { state: 'idle', message: '' }; return;
    }
    const runtime = this.deps.runtime();
    if (runtime?.url === this.endpoint && runtime.mode === 'blocked') {
      this.status = { state: 'blocked', message: 'A previous connection failed after requests were sent. Automatic recovery will not replay them; manual recovery is required.' }; return;
    }
    try {
      const fingerprint = await this.deps.fingerprint();
      this.abort.signal.throwIfAborted();
      const transient = runtime?.url === this.endpoint && runtime.mode === 'private'
        && runtime.verificationGeneration === install.verificationGeneration
        && isTransientVerificationFailure(runtime.reason);
      const key = JSON.stringify([install.token, install.url, install.codexPath, install.verificationGeneration, fingerprint]);
      if (key !== this.key) { this.key = key; this.attempts = 0; this.finished = false; }
      if (this.finished) return;
      if (fingerprint === install.fingerprint && !transient) {
        if (runtime?.url === this.endpoint && runtime.mode === 'private'
          && runtime.fingerprint === fingerprint && runtime.verificationGeneration === install.verificationGeneration) {
          this.status = { state: 'blocked', message: 'Shared startup needs attention: ' + (runtime.reason ?? 'Compatibility must be verified manually.') }; return;
        }
        this.status = { state: 'verified', message: 'Compatibility check passed, but shared control is not connected. Existing sessions remain running. Connection can only be confirmed after Codex joins the shared backend on a future launch.' }; return;
      }
      this.attempts++;
      this.status = { state: 'checking', message: 'Checking compatibility automatically. Existing Codex sessions remain running.' };
      await this.deps.verify(install, { signal: this.abort.signal });
      this.finished = true;
      this.status = { state: 'verified', message: 'Compatibility check passed, but shared control is not connected. Existing sessions remain running. Connection can only be confirmed after Codex joins the shared backend on a future launch.' };
    } catch (error) {
      if (this.abort.signal.aborted) return;
      const retry = isTransientVerificationFailure(error) && this.attempts < 3;
      this.finished = !retry;
      this.nextCheck = this.deps.now() + 30_000 * Math.max(1, this.attempts);
      this.status = { state: retry ? 'retrying' : 'blocked', message: retry
        ? 'Temporary compatibility check failure; Micro will retry automatically. Existing sessions remain running.'
        : 'Automatic compatibility check stopped: ' + (error instanceof Error ? error.message : String(error)) };
    }
  }
}
