import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, loadConfig, saveAppServerUrl } from './config.js';
import { verifyDesktopServer } from './desktopCompatibility.js';
import {
  DESKTOP_CODEX, DESKTOP_LAUNCHER, DEFAULT_SHARED_SERVER_URL,
  SHARED_INSTALL_STATE, SHARED_RUNTIME_STATE, cleanDesktopEnvironment,
  desktopBuildFingerprint, readSharedInstall, readSharedRuntime, validateSharedEndpoint,
  type DesktopSharedInstall,
} from './sharedRuntime.js';
export { DESKTOP_CODEX, DEFAULT_SHARED_SERVER_URL } from './sharedRuntime.js';

export const SHARED_SERVER_LABEL = 'ai.dionlabs.stream-deck-micro.codex-app-server';
export const DESKTOP_ENV_LABEL = 'ai.dionlabs.stream-deck-micro.desktop-environment';
export const DESKTOP_ENDPOINT_ENV = 'CODEX_APP_SERVER_WS_URL';

const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const SERVER_PLIST = join(LAUNCH_AGENTS_DIR, `${SHARED_SERVER_LABEL}.plist`);
const ENV_PLIST = join(LAUNCH_AGENTS_DIR, `${DESKTOP_ENV_LABEL}.plist`);
const INSTALL_STATE = SHARED_INSTALL_STATE;
const DESKTOP_APP = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';

export type DesktopConnectionState =
  | 'not-required'
  | 'waiting'
  | 'connecting'
  | 'restart-required'
  | 'unavailable'
  | 'connected';

export interface DesktopConnectionStatus {
  state: DesktopConnectionState;
  endpoint: string | null;
  message: string;
  generation?: string;
}

interface SharedInstallState {
  url: string;
  codexPath: string;
  configPath: string;
}

export interface CodexDesktopLifecycle {
  requestQuit(): Promise<void>;
  isRunning(): boolean;
  open(): Promise<void>;
  wait(ms: number): Promise<void>;
}

export interface PrivateCodexRecoveryLifecycle extends CodexDesktopLifecycle {
  uninstall(configPath?: string): Promise<void>;
  readProcesses(): string;
  signal(pid: number, signal: NodeJS.Signals): void;
}

export interface SharedServerStatus {
  installed: boolean;
  healthy: boolean;
  desktopRestartRequired: boolean;
  url: string;
  desktopEndpoint: string | null;
  codexPath: string | null;
  configPath: string | null;
  desktopConnection: DesktopConnectionStatus;
}

export async function installSharedServer(
  configPath?: string,
  requestedUrl = DEFAULT_SHARED_SERVER_URL,
): Promise<SharedServerStatus> {
  const url = validateSharedEndpoint(requestedUrl);
  // Validate BEFORE any config, launchd or application mutation.
  loadConfig(configPath);
  if (readSharedRuntime()?.mode === 'shared' || existsSync(SERVER_PLIST)) {
    throw new Error('Quit shared Codex Desktop and run shared uninstall before migrating/reinstalling; active tasks are never stopped by install');
  }
  if (launchctlOutput(['getenv', DESKTOP_ENDPOINT_ENV])) {
    throw new Error('Legacy global Desktop routing is still set. Run shared uninstall before installing scoped shared control');
  }
  const fingerprint = await desktopBuildFingerprint();
  const verification = await verifyDesktopServer(DESKTOP_CODEX);
  if (fingerprint !== await desktopBuildFingerprint()) throw new Error('Desktop changed during verification; retry after its update finishes');
  const bridgePath = join(dirname(fileURLToPath(import.meta.url)), 'cli', 'codex-desktop-bridge.js');
  accessSync(bridgePath, constants.R_OK);
  mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  // The launcher remains as a native passthrough after uninstall so an already
  // running Desktop never loses the executable it was launched with.
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  writePrivateFile(DESKTOP_LAUNCHER, `#!/bin/sh
if [ -f ${quote(INSTALL_STATE)} ] && [ -x ${quote(process.execPath)} ] && [ -f ${quote(bridgePath)} ]; then
  exec ${quote(process.execPath)} ${quote(bridgePath)} "$@"
fi
unset CODEX_CLI_PATH CODEX_APP_SERVER_WS_URL CODEX_APP_SERVER_FORCE_CLI CODEX_APP_SERVER_USE_LOCAL_DAEMON
exec ${quote(DESKTOP_CODEX)} "$@"
`);
  chmodSync(DESKTOP_LAUNCHER, 0o700);
  const savedConfigPath = resolve(saveAppServerUrl(configPath, url));
  const state: DesktopSharedInstall = {
    mode: 'desktop-launch', url, codexPath: DESKTOP_CODEX, configPath: savedConfigPath,
    launcherPath: DESKTOP_LAUNCHER, fingerprint, version: verification.version,
    token: randomBytes(32).toString('hex'),
  };
  writePrivateFile(INSTALL_STATE, `${JSON.stringify(state, null, 2)}\n`);
  if (existsSync(SHARED_RUNTIME_STATE)) unlinkSync(SHARED_RUNTIME_STATE);
  return sharedServerStatus();
}

export async function uninstallSharedServer(configPath?: string): Promise<SharedServerStatus> {
  const state = readInstallState();
  const domain = launchDomain();
  bootout(domain, ENV_PLIST);
  bootout(domain, SERVER_PLIST);
  try {
    launchctl(['unsetenv', DESKTOP_ENDPOINT_ENV]);
  } catch {
    // Already unset.
  }
  for (const path of [ENV_PLIST, SERVER_PLIST, INSTALL_STATE, SHARED_RUNTIME_STATE]) {
    if (existsSync(path)) unlinkSync(path);
  }
  saveAppServerUrl(configPath ?? state?.configPath, null);
  return sharedServerStatus(state?.url ?? DEFAULT_SHARED_SERVER_URL);
}

export async function sharedServerStatus(
  fallbackUrl = DEFAULT_SHARED_SERVER_URL,
): Promise<SharedServerStatus> {
  const state = readInstallState();
  const url = state?.url ?? fallbackUrl;
  const desktopConnection = desktopConnectionStatus(url);
  return {
    installed: readSharedInstall() !== null && existsSync(DESKTOP_LAUNCHER),
    healthy: await isHealthy(url),
    desktopRestartRequired: desktopConnection.state === 'restart-required',
    url,
    desktopEndpoint: launchctlOutput(['getenv', DESKTOP_ENDPOINT_ENV]),
    codexPath: state?.codexPath ?? null,
    configPath: state?.configPath ?? null,
    desktopConnection,
  };
}

/** Inspect whether ChatGPT Desktop has joined the shared WebSocket endpoint. */
export function desktopConnectionStatus(endpoint: string): DesktopConnectionStatus {
  let processes = '';
  try {
    processes = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    return desktopStatus('waiting', endpoint);
  }

  const install = readSharedInstall();
  if (install?.url === endpoint) {
    const runtime = readSharedRuntime();
    const records = parseProcessList(processes);
    if (runtime?.url === endpoint && runtime.mode === 'shared' && runtime.serverPid
      && records.get(runtime.serverPid)?.ppid === runtime.bridgePid
      && records.get(runtime.serverPid)?.command.startsWith(`${DESKTOP_CODEX} `)
      && records.get(runtime.serverPid)?.command.includes(`--listen ${endpoint}`)
      && hasDesktopAncestor(runtime.bridgePid, records)) {
      return { ...desktopStatus('connected', endpoint), generation: `${runtime.bridgePid}:${runtime.serverPid}` };
    }
    if (runtime && runtime.mode !== 'shared') {
      return { state: 'unavailable', endpoint, message: `Shared control is disabled. ${runtime.reason ?? 'Run shared install to verify compatibility.'}` };
    }
  } else {
    return { state: 'unavailable', endpoint, message: 'Shared control is not installed. Run shared install, then shared open; Codex remains in private mode.' };
  }

  const desktopPids = desktopProcessIds(processes);
  let sockets = '';
  if (desktopPids.length) {
    try {
      const port = new URL(endpoint).port;
      sockets = execFileSync(
        '/usr/sbin/lsof',
        ['-nP', '-a', '-p', desktopPids.join(','), `-iTCP:${port}`, '-sTCP:ESTABLISHED'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
        },
      );
    } catch {
      // lsof exits with status 1 when there are no matching sockets.
    }
  }
  return desktopConnectionFromOutputs(processes, sockets, endpoint);
}

/** Pure routing classifier, exported so startup ownership behavior stays regression-tested. */
export function desktopConnectionFromOutputs(
  processes: string,
  sockets: string,
  endpoint: string,
): DesktopConnectionStatus {
  const desktopPids = desktopProcessIds(processes);
  if (!desktopPids.length) return desktopStatus('waiting', endpoint);
  if (processListHasDesktopPrivateAppServer(processes)) {
    return desktopStatus('restart-required', endpoint);
  }
  if (socketListHasSharedDesktop(sockets, endpoint)) {
    return desktopStatus('connected', endpoint);
  }
  return desktopStatus('connecting', endpoint);
}

/** True while a running Desktop instance still owns its old private stdio server. */
export function desktopUsesPrivateAppServer(): boolean {
  try {
    const processes = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return processListHasDesktopPrivateAppServer(processes);
  } catch {
    return false;
  }
}

/** Distinguish Desktop's private server from tool/CLI servers using the same bundled binary. */
export function processListHasDesktopPrivateAppServer(processes: string): boolean {
  const records = parseProcessList(processes);
  for (const record of records.values()) {
    if (
      !record.command.startsWith(`${DESKTOP_CODEX} `)
      || !/(?:^|\s)app-server(?:\s|$)/.test(record.command)
      || /--listen\s+ws:\/\//.test(record.command)
    ) continue;
    let parent = records.get(record.ppid);
    const visited = new Set<number>();
    while (parent && !visited.has(parent.ppid)) {
      if (/--listen\s+ws:\/\//.test(parent.command)) break;
      if (parent.command === DESKTOP_APP) return true;
      visited.add(parent.ppid);
      parent = records.get(parent.ppid);
    }
  }
  return false;
}

/**
 * Gracefully restart Codex Desktop after the user explicitly requests recovery.
 * Default lifecycle always opens a clean, private Desktop. Shared activation is
 * a separate operation with verification BEFORE requesting a quit.
 */
export async function restartCodexDesktop(
  lifecycle: CodexDesktopLifecycle = macCodexDesktopLifecycle,
  pollAttempts = 40,
  whileStopped?: () => Promise<void>,
): Promise<void> {
  await lifecycle.requestQuit();
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (!lifecycle.isRunning()) {
      try {
        await whileStopped?.();
      } finally {
        // Even a failed backend update should not leave Desktop closed.
        await lifecycle.open();
      }
      return;
    }
    if (attempt < pollAttempts - 1) await lifecycle.wait(250);
  }
  throw new Error('ChatGPT Desktop did not quit; close it manually and press RESTART CODEX again');
}

/** Never restart an arbitrary endpoint or a user-supplied Codex executable. */
export function isManagedDesktopServer(endpoint: string): boolean {
  return readSharedInstall()?.url === endpoint && existsSync(DESKTOP_LAUNCHER);
}

export async function assertSharedLaunchCompatible(endpoint: string): Promise<void> {
  const install = readSharedInstall();
  if (!install || install.url !== endpoint) throw new Error('Shared control is not installed; Codex was not changed');
  if (install.fingerprint !== await desktopBuildFingerprint()) {
    throw new Error('Desktop build changed. Shared control is disabled until shared install verifies the new build; Codex was not restarted');
  }
  const runtime = readSharedRuntime();
  if (runtime && runtime.mode !== 'shared') throw new Error('Shared startup previously failed. Run shared install to verify and retry; Codex was not restarted');
}

/** Detect a changed Desktop bundle without quitting or launching either app. */
export async function sharedLaunchNeedsVerification(endpoint: string): Promise<boolean> {
  const install = readSharedInstall();
  if (!install || install.url !== endpoint) return false;
  return install.fingerprint !== await desktopBuildFingerprint();
}

export async function openSharedCodexDesktop(): Promise<void> {
  const install = readSharedInstall();
  await assertSharedLaunchCompatible(install?.url ?? DEFAULT_SHARED_SERVER_URL);
  if (desktopAppIsRunning()) throw new Error('Fully quit Codex Desktop first, or use the explicit deck restart action');
  await execFilePromise('/usr/bin/open', sharedDesktopOpenArguments());
}

export function sharedDesktopOpenArguments(): string[] {
  return ['-a', 'ChatGPT', '--env', `CODEX_CLI_PATH=${DESKTOP_LAUNCHER}`,
    '--env', 'CODEX_APP_SERVER_WS_URL=', '--env', 'CODEX_APP_SERVER_FORCE_CLI=1'];
}

export async function restartSharedCodexDesktop(endpoint: string): Promise<void> {
  // Never quit a healthy Desktop before discovering an invalid installation.
  await assertSharedLaunchCompatible(endpoint);
  let opened = false;
  try {
    await restartCodexDesktop({ ...macCodexDesktopLifecycle,
      open: async () => { await openSharedCodexDesktop(); opened = true; },
    });
    for (let attempt = 0; attempt < 40; attempt++) {
      const status = desktopConnectionStatus(endpoint);
      if (status.state === 'connected') return;
      if (status.state === 'unavailable') throw new Error(status.message);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    throw new Error('Shared Desktop handshake timed out');
  } catch (error) {
    // No task requests have been restored yet. A failed activation returns to
    // clean Desktop, rather than stranding it on a broken endpoint.
    if (opened) await restartCodexDesktop();
    else if (!desktopAppIsRunning()) await macCodexDesktopLifecycle.open();
    throw error;
  }
}

/**
 * Fail-safe escape hatch: remove shared routing, stop only verified bundled
 * listeners for the configured endpoint, and reopen Desktop in private mode.
 */
export async function recoverPrivateCodex(
  configPath?: string,
  requestedEndpoint = DEFAULT_SHARED_SERVER_URL,
  lifecycle: PrivateCodexRecoveryLifecycle = macPrivateRecoveryLifecycle,
): Promise<void> {
  const endpoint = validateSharedEndpoint(requestedEndpoint);
  await restartCodexDesktop(lifecycle, 40, async () => {
    await lifecycle.uninstall(configPath);
    await stopManagedSharedListeners(endpoint, lifecycle);
  });
}

export function managedSharedListenerPids(processes: string, requestedEndpoint: string): number[] {
  const endpoint = validateSharedEndpoint(requestedEndpoint);
  const escapedEndpoint = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const listener = new RegExp(`(?:^|\\s)--listen(?:\\s+|=)${escapedEndpoint}(?:\\s|$)`);
  return [...parseProcessList(processes)]
    .filter(([, record]) => record.command.startsWith(`${DESKTOP_CODEX} `)
      && /(?:^|\s)app-server(?:\s|$)/.test(record.command)
      && listener.test(record.command))
    .map(([pid]) => pid);
}

async function stopManagedSharedListeners(
  endpoint: string,
  lifecycle: PrivateCodexRecoveryLifecycle,
): Promise<void> {
  let remaining = managedSharedListenerPids(lifecycle.readProcesses(), endpoint);
  for (const pid of remaining) signalIfStillManaged(pid, 'SIGTERM', endpoint, lifecycle);
  for (let attempt = 0; attempt < 15 && remaining.length; attempt += 1) {
    await lifecycle.wait(100);
    remaining = managedSharedListenerPids(lifecycle.readProcesses(), endpoint);
  }
  // Re-resolve exact command lines before escalation, so PID reuse cannot make
  // this target an unrelated process.
  for (const pid of remaining) signalIfStillManaged(pid, 'SIGKILL', endpoint, lifecycle);
  for (let attempt = 0; attempt < 10 && remaining.length; attempt += 1) {
    await lifecycle.wait(100);
    remaining = managedSharedListenerPids(lifecycle.readProcesses(), endpoint);
  }
  if (remaining.length) throw new Error('A verified shared Codex listener could not be stopped');
}

function signalIfStillManaged(
  pid: number,
  signal: NodeJS.Signals,
  endpoint: string,
  lifecycle: PrivateCodexRecoveryLifecycle,
): void {
  if (!managedSharedListenerPids(lifecycle.readProcesses(), endpoint).includes(pid)) return;
  try { lifecycle.signal(pid, signal); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function hasDesktopAncestor(pid: number, records: Map<number, { ppid: number; command: string }>): boolean {
  const visited = new Set<number>();
  let record = records.get(pid);
  while (record && !visited.has(record.ppid)) {
    if (record.command === DESKTOP_APP || record.command.startsWith(`${DESKTOP_APP} `)) return true;
    visited.add(record.ppid);
    record = records.get(record.ppid);
  }
  return false;
}

function parseProcessList(processes: string): Map<number, { ppid: number; command: string }> {
  const records = new Map<number, { ppid: number; command: string }>();
  for (const line of processes.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    records.set(Number(match[1]), { ppid: Number(match[2]), command: match[3] });
  }
  return records;
}

function desktopProcessIds(processes: string): number[] {
  return [...parseProcessList(processes)]
    .filter(([, record]) =>
      record.command === DESKTOP_APP || record.command.startsWith(`${DESKTOP_APP} `))
    .map(([pid]) => pid);
}

const macCodexDesktopLifecycle: CodexDesktopLifecycle = {
  async requestQuit() {
    if (!desktopAppIsRunning()) return;
    await execFilePromise('/usr/bin/osascript', ['-e', 'tell application "ChatGPT" to quit']);
  },
  isRunning: desktopAppIsRunning,
  open: () => execFilePromise('/usr/bin/open', ['-a', 'ChatGPT', '--env', 'CODEX_APP_SERVER_WS_URL=',
    '--env', `CODEX_CLI_PATH=${DESKTOP_CODEX}`, '--env', 'CODEX_APP_SERVER_FORCE_CLI=1']),
  wait: (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
};

const macPrivateRecoveryLifecycle: PrivateCodexRecoveryLifecycle = {
  ...macCodexDesktopLifecycle,
  uninstall: async (configPath) => { await uninstallSharedServer(configPath); },
  readProcesses: () => execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
  }),
  signal: (pid, signal) => { process.kill(pid, signal); },
};

function desktopAppIsRunning(): boolean {
  try {
    const processes = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return desktopProcessIds(processes).length > 0;
  } catch {
    return true;
  }
}

function execFilePromise(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { timeout: 10_000, env: cleanDesktopEnvironment(process.env) }, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function socketListHasSharedDesktop(sockets: string, endpoint: string): boolean {
  const port = new URL(endpoint).port.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `->(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}\\s+\\(ESTABLISHED\\)`,
  ).test(sockets);
}

function desktopStatus(
  state: Exclude<DesktopConnectionState, 'not-required'>,
  endpoint: string,
): DesktopConnectionStatus {
  const messages: Record<Exclude<DesktopConnectionState, 'not-required'>, string> = {
    unavailable: 'Shared control is disabled. Codex remains available in private mode.',
    waiting: 'Run stream-deck-micro shared open to launch Codex with shared control. Normal Dock launches stay private.',
    connecting: 'Waiting for ChatGPT Desktop to join the shared session server.',
    'restart-required':
      'Use shared open after quitting Desktop, or the explicit RESTART CODEX action. Refreshing the window is not enough.',
    connected: 'ChatGPT Desktop and Stream Deck Micro are sharing one session server.',
  };
  return { state, endpoint, message: messages[state] };
}

export function validateLoopbackEndpoint(value: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  if (url.protocol !== 'ws:' || !loopback || !url.port || url.username || url.password) {
    throw new Error(
      'shared server URL must be an unauthenticated loopback ws:// URL with an explicit port',
    );
  }
  return url.toString().replace(/\/$/, '');
}

export function launchAgentPlist(options: {
  label: string;
  args: string[];
  keepAlive: boolean;
  stdoutPath: string;
  stderrPath: string;
}): string {
  const args = options.args.map((arg) => `      <string>${xmlEscape(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xmlEscape(options.label)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <${options.keepAlive ? 'true' : 'false'}/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${xmlEscape(options.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(options.stderrPath)}</string>
  </dict>
</plist>
`;
}

function launchDomain(): string {
  if (!process.getuid) throw new Error('shared server setup requires macOS');
  return `gui/${process.getuid()}`;
}

function launchctl(args: string[]): void {
  execFileSync('/bin/launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function launchctlOutput(args: string[]): string | null {
  try {
    const command = args[0]?.startsWith('/') ? args[0] : '/bin/launchctl';
    const commandArgs = args[0]?.startsWith('/') ? args.slice(1) : args;
    return execFileSync(command, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

function bootout(domain: string, plist: string): void {
  try {
    launchctl(['bootout', domain, plist]);
  } catch {
    // Not loaded yet.
  }
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readInstallState(): SharedInstallState | null {
  try {
    return JSON.parse(readFileSync(INSTALL_STATE, 'utf8')) as SharedInstallState;
  } catch {
    return null;
  }
}

async function isHealthy(url: string): Promise<boolean> {
  const endpoint = new URL(url);
  endpoint.protocol = 'http:';
  endpoint.pathname = '/healthz';
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
