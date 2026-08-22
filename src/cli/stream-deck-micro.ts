#!/usr/bin/env node
import { collectDoctorChecks, printDoctorReport } from './doctor.js';

const HELP = `stream-deck-micro — a local Codex command center for Stream Deck

usage:
  stream-deck-micro doctor [config] [--json] [--marketplace]
                                               verify the machine and configuration
  stream-deck-micro shared install [config]   install the shared Codex App Server
  stream-deck-micro shared status             inspect shared-server health and Desktop routing
  stream-deck-micro shared uninstall [config] remove shared mode and restore private sessions
  stream-deck-micro marketplace install [config]
                                               install the background Marketplace bridge
  stream-deck-micro marketplace status        inspect Marketplace bridge health
  stream-deck-micro marketplace uninstall [config]
                                               remove the bridge and select Independent mode
  stream-deck-micro start [config] [--marketplace]
                                               start the daemon and Control Room
  stream-deck-micro help                      show this help

While the daemon is running, use the sdm command for session control:
  sdm status | send | select | stop | workflow | sessions | attach
`;

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'doctor') {
    const json = args.includes('--json');
    const marketplace = args.includes('--marketplace');
    const configPath = args.find((arg) => arg !== '--json' && arg !== '--marketplace');
    const checks = collectDoctorChecks(configPath, marketplace ? 'marketplace' : undefined);
    printDoctorReport(checks, json);
    if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
    return;
  }
  if (command === 'start') {
    const { runDaemon } = await import('../main.js');
    const marketplace = args.includes('--marketplace');
    const configPath = args.find((arg) => arg !== '--marketplace');
    await runDaemon(configPath, { surfaceMode: marketplace ? 'marketplace' : undefined });
    return;
  }
  if (command === 'shared') {
    const { installSharedServer, sharedServerStatus, uninstallSharedServer } = await import(
      '../sharedServer.js'
    );
    const [action = 'status', ...sharedArgs] = args;
    const urlIndex = sharedArgs.indexOf('--url');
    if (urlIndex >= 0 && !sharedArgs[urlIndex + 1]) throw new Error('--url requires a value');
    const url = urlIndex >= 0 ? sharedArgs[urlIndex + 1] : undefined;
    const configPath = sharedArgs.find((arg, index) => arg !== '--url' && index !== urlIndex + 1);
    const status = action === 'install'
      ? await installSharedServer(configPath, url)
      : action === 'uninstall'
        ? await uninstallSharedServer(configPath)
        : action === 'status'
          ? await sharedServerStatus()
          : null;
    if (!status) throw new Error(`unknown shared action: ${action}`);
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (action === 'install') {
      process.stdout.write('\nShared mode installed. Fully quit and reopen Codex Desktop once.\n');
    } else if (action === 'uninstall') {
      process.stdout.write('\nShared mode removed. Fully quit and reopen Codex Desktop once.\n');
    }
    return;
  }
  if (command === 'marketplace') {
    const {
      installMarketplaceService,
      marketplaceServiceStatus,
      uninstallMarketplaceService,
    } = await import('../marketplaceService.js');
    const [action = 'status', configPath] = args;
    const status = action === 'install'
      ? await installMarketplaceService(configPath)
      : action === 'uninstall'
        ? await uninstallMarketplaceService(configPath)
        : action === 'status'
          ? await marketplaceServiceStatus()
          : null;
    if (!status) throw new Error(`unknown marketplace action: ${action}`);
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (action === 'install' && status.desktopRestartRequired) {
      process.stdout.write('\nFully quit and reopen Codex Desktop once to join the shared server.\n');
    }
    return;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }
  process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
