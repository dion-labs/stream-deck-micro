import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { platform, release } from 'node:os';
import { listStreamDecks } from 'elgato-stream-deck';
import { APP_DIR, IPC_SOCKET, loadConfig } from '../config.js';
import { DESKTOP_ENDPOINT_ENV, desktopUsesPrivateAppServer } from '../sharedServer.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

function commandOutput(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function elgatoAppIsRunning(): boolean {
  const processes = commandOutput('/bin/ps', ['-ax', '-o', 'command=']);
  return Boolean(processes?.includes('/Applications/Elgato Stream Deck.app/'));
}

export function collectDoctorChecks(explicitConfigPath?: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js',
    status: major >= 22 ? 'pass' : 'fail',
    detail: `${process.version}${major >= 22 ? '' : ' — version 22 or newer is required'}`,
  });

  checks.push({
    name: 'Operating system',
    status: platform() === 'darwin' ? 'pass' : 'fail',
    detail: `${platform()} ${release()}${platform() === 'darwin' ? '' : ' — v1 supports macOS only'}`,
  });

  const codexVersion = commandOutput('codex', ['--version']);
  checks.push({
    name: 'Codex CLI',
    status: codexVersion ? 'pass' : 'fail',
    detail: codexVersion ?? 'not found in PATH',
  });

  try {
    const { config, sourcePath } = loadConfig(explicitConfigPath);
    checks.push({
      name: 'Configuration',
      status: 'pass',
      detail: sourcePath ?? 'using built-in defaults',
    });
    checks.push({
      name: 'Codex permissions',
      status:
        config.codex.sandboxMode === 'danger-full-access'
        && config.codex.approvalPolicy === 'never'
          ? 'warn'
          : 'pass',
      detail: `${config.codex.sandboxMode} / approvals ${config.codex.approvalPolicy}`,
    });
    if (config.appServer.url) {
      const healthUrl = new URL(config.appServer.url);
      healthUrl.protocol = healthUrl.protocol === 'wss:' ? 'https:' : 'http:';
      healthUrl.pathname = '/healthz';
      const healthy = commandOutput('/usr/bin/curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--max-time',
        '2',
        healthUrl.toString(),
      ]);
      checks.push({
        name: 'Shared App Server',
        status: healthy !== null ? 'pass' : 'fail',
        detail: healthy !== null ? config.appServer.url : `not reachable at ${config.appServer.url}`,
      });
      const desktopEndpoint = commandOutput('/bin/launchctl', ['getenv', DESKTOP_ENDPOINT_ENV]);
      checks.push({
        name: 'Codex Desktop routing',
        status: desktopEndpoint === config.appServer.url ? 'pass' : 'fail',
        detail: desktopEndpoint === config.appServer.url
          ? desktopEndpoint
          : `expected ${config.appServer.url}; reinstall shared mode`,
      });
      const restartRequired = desktopUsesPrivateAppServer();
      checks.push({
        name: 'Codex Desktop connection',
        status: restartRequired ? 'fail' : 'pass',
        detail: restartRequired
          ? 'fully quit and reopen Codex Desktop to join the shared server'
          : 'no private Desktop App Server detected',
      });
    }
  } catch (error) {
    checks.push({
      name: 'Configuration',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
    accessSync(APP_DIR, constants.R_OK | constants.W_OK);
    checks.push({ name: 'Runtime directory', status: 'pass', detail: APP_DIR });
  } catch (error) {
    checks.push({
      name: 'Runtime directory',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const devices = listStreamDecks();
    const supported = devices.filter((device) => device.model === 'original-mk2');
    checks.push({
      name: 'Stream Deck MK.2',
      status: supported.length ? 'pass' : 'fail',
      detail: supported.length
        ? `${supported.length} compatible device${supported.length === 1 ? '' : 's'} detected`
        : devices.length
          ? `detected ${devices.map((device) => device.model).join(', ')}, but v1 requires the 15-key MK.2`
          : 'no Stream Deck detected',
    });
  } catch (error) {
    checks.push({
      name: 'Stream Deck MK.2',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const elgatoRunning = elgatoAppIsRunning();
  checks.push({
    name: 'Elgato Stream Deck app',
    status: elgatoRunning ? 'fail' : 'pass',
    detail: elgatoRunning
      ? 'quit the Elgato app so Stream Deck Micro can open the HID device'
      : 'not holding the device',
  });

  checks.push({
    name: 'Daemon',
    status: existsSync(IPC_SOCKET) ? 'warn' : 'pass',
    detail: existsSync(IPC_SOCKET) ? `socket exists at ${IPC_SOCKET}` : 'not running',
  });

  return checks;
}

export function printDoctorReport(checks: DoctorCheck[], json = false): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
    return;
  }
  process.stdout.write('Stream Deck Micro doctor\n\n');
  for (const check of checks) {
    const marker = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    process.stdout.write(`${marker} ${check.name}: ${check.detail}\n`);
  }
  const failures = checks.filter((check) => check.status === 'fail').length;
  process.stdout.write(
    failures
      ? `\n${failures} blocking check${failures === 1 ? '' : 's'} must be fixed before start.\n`
      : '\nReady to start.\n',
  );
}
