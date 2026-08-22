import { execFileSync } from 'node:child_process';
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
import { join, resolve } from 'node:path';
import { APP_DIR, saveAppServerUrl } from './config.js';

export const DEFAULT_SHARED_SERVER_URL = 'ws://127.0.0.1:17532';
export const SHARED_SERVER_LABEL = 'ai.dionlabs.stream-deck-micro.codex-app-server';
export const DESKTOP_ENV_LABEL = 'ai.dionlabs.stream-deck-micro.desktop-environment';
export const DESKTOP_ENDPOINT_ENV = 'CODEX_APP_SERVER_WS_URL';

const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const SERVER_PLIST = join(LAUNCH_AGENTS_DIR, `${SHARED_SERVER_LABEL}.plist`);
const ENV_PLIST = join(LAUNCH_AGENTS_DIR, `${DESKTOP_ENV_LABEL}.plist`);
const INSTALL_STATE = join(APP_DIR, 'shared-server.json');
const DESKTOP_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex';

interface SharedInstallState {
  url: string;
  codexPath: string;
  configPath: string;
}

export interface SharedServerStatus {
  installed: boolean;
  healthy: boolean;
  desktopRestartRequired: boolean;
  url: string;
  desktopEndpoint: string | null;
  codexPath: string | null;
  configPath: string | null;
}

export async function installSharedServer(
  configPath?: string,
  requestedUrl = DEFAULT_SHARED_SERVER_URL,
): Promise<SharedServerStatus> {
  const url = validateLoopbackEndpoint(requestedUrl);
  const codexPath = findCodexBinary();
  const previous = readInstallState();
  const canReuse = previous?.url === url
    && previous.codexPath === codexPath
    && existsSync(SERVER_PLIST)
    && existsSync(ENV_PLIST)
    && await isHealthy(url);
  mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true, mode: 0o700 });

  const stdoutPath = join(APP_DIR, 'codex-app-server.log');
  const stderrPath = join(APP_DIR, 'codex-app-server.error.log');
  writePrivateFile(
    SERVER_PLIST,
    launchAgentPlist({
      label: SHARED_SERVER_LABEL,
      args: [codexPath, 'app-server', '--listen', url],
      keepAlive: true,
      stdoutPath,
      stderrPath,
    }),
  );
  writePrivateFile(
    ENV_PLIST,
    launchAgentPlist({
      label: DESKTOP_ENV_LABEL,
      args: ['/bin/launchctl', 'setenv', DESKTOP_ENDPOINT_ENV, url],
      keepAlive: false,
      stdoutPath,
      stderrPath,
    }),
  );

  const domain = launchDomain();
  if (!canReuse) {
    bootout(domain, ENV_PLIST);
    bootout(domain, SERVER_PLIST);
    launchctl(['bootstrap', domain, SERVER_PLIST]);
    launchctl(['bootstrap', domain, ENV_PLIST]);
  }
  launchctl(['setenv', DESKTOP_ENDPOINT_ENV, url]);

  const savedConfigPath = resolve(saveAppServerUrl(configPath, url));
  const state: SharedInstallState = { url, codexPath, configPath: savedConfigPath };
  writePrivateFile(INSTALL_STATE, `${JSON.stringify(state, null, 2)}\n`);

  await waitForHealth(url);
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
  for (const path of [ENV_PLIST, SERVER_PLIST, INSTALL_STATE]) {
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
  return {
    installed: existsSync(SERVER_PLIST) && existsSync(ENV_PLIST),
    healthy: await isHealthy(url),
    desktopRestartRequired: desktopUsesPrivateAppServer(),
    url,
    desktopEndpoint: launchctlOutput(['getenv', DESKTOP_ENDPOINT_ENV]),
    codexPath: state?.codexPath ?? null,
    configPath: state?.configPath ?? null,
  };
}

/** True while a running Desktop instance still owns its old private stdio server. */
export function desktopUsesPrivateAppServer(): boolean {
  try {
    const processes = execFileSync('/bin/ps', ['-ax', '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return processes.includes(`${DESKTOP_CODEX} app-server --listen stdio://`);
  } catch {
    return false;
  }
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

function findCodexBinary(): string {
  const candidates = [process.env.CODEX_CLI_PATH, DESKTOP_CODEX].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  const fromPath = launchctlOutput(['/usr/bin/which', 'codex']);
  if (fromPath) {
    try {
      accessSync(fromPath, constants.X_OK);
      return fromPath;
    } catch {
      // Fall through to the actionable error.
    }
  }
  throw new Error('Codex executable not found; install Codex Desktop or set CODEX_CLI_PATH');
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

async function waitForHealth(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isHealthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`shared Codex App Server did not become healthy at ${url}`);
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
