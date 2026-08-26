import { execFile } from 'node:child_process';
import { RpcConnection } from './harness/codex-app-server/rpc.js';
import { DESKTOP_CODEX, isManagedDesktopServer } from './sharedServer.js';

export interface ServerVersionStatus {
  state: 'unknown' | 'current' | 'update-required';
  runningVersion: string | null;
  bundledVersion: string | null;
}

export interface ServerVersionSource {
  managed(endpoint: string): boolean;
  running(endpoint: string): Promise<string | null>;
  bundled(): Promise<string | null>;
}

/** Accept full prerelease versions; do not reduce them to just major/minor. */
export function parseCodexVersion(text: string): string | null {
  return text.match(/^(?:codex-cli |Codex Desktop\/|codex_cli_rs\/)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)(?:\s|$)/)?.[1] ?? null;
}

export const serverVersionSource: ServerVersionSource = {
  managed: isManagedDesktopServer,
  async running(endpoint) {
    // A separate initialize-only connection never resumes or owns a thread.
    const connection = RpcConnection.webSocket(endpoint);
    try {
      const result = await connection.request('initialize', {
        clientInfo: { name: 'micro-version-check', version: '0.1.0' },
      }, 3000) as { userAgent?: string };
      return parseCodexVersion(result.userAgent ?? '');
    } finally {
      connection.close();
    }
  },
  bundled: () => new Promise((resolve) => {
    execFile(DESKTOP_CODEX, ['--version'], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : parseCodexVersion(stdout.trim()));
    });
  }),
};

/** Read-only, throttled detection. A missing version is not proof of a mismatch. */
export class SharedServerVersionMonitor {
  private value: ServerVersionStatus = {
    state: 'unknown', runningVersion: null, bundledVersion: null,
  };
  private checkedAt = -Infinity;
  private pending: Promise<ServerVersionStatus> | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly source = serverVersionSource,
    private readonly intervalMs = 15_000,
  ) {}

  get status(): ServerVersionStatus { return { ...this.value }; }

  refresh(force = false): Promise<ServerVersionStatus> {
    if (this.pending) return this.pending;
    if (!force && Date.now() - this.checkedAt < this.intervalMs) return Promise.resolve(this.status);
    this.pending = this.check().finally(() => {
      this.checkedAt = Date.now();
      this.pending = null;
    });
    return this.pending;
  }

  private async check(): Promise<ServerVersionStatus> {
    try {
      if (!this.source.managed(this.endpoint)) {
        this.value = { state: 'unknown', runningVersion: null, bundledVersion: null };
        return this.status;
      }
      const [runningVersion, bundledVersion] = await Promise.all([
        this.source.running(this.endpoint), this.source.bundled(),
      ]);
      if (runningVersion && bundledVersion) {
        this.value = {
          state: runningVersion === bundledVersion ? 'current' : 'update-required',
          runningVersion, bundledVersion,
        };
        return this.status;
      }
      // Preserve a confirmed mismatch across temporary socket/update failures.
    } catch {
      // Never offer recovery solely because a probe failed.
    }
    if (this.value.state !== 'update-required') {
      this.value = { state: 'unknown', runningVersion: null, bundledVersion: null };
    }
    return this.status;
  }
}
