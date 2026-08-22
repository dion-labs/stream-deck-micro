#!/usr/bin/env node
import { collectDoctorChecks, printDoctorReport } from './doctor.js';

const HELP = `stream-deck-micro — a local Codex command center for Stream Deck

usage:
  stream-deck-micro doctor [config] [--json]  verify the machine and configuration
  stream-deck-micro start [config]            start the daemon and Control Room
  stream-deck-micro help                      show this help

While the daemon is running, use the sdm command for session control:
  sdm status | send | select | stop | workflow | sessions | attach
`;

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'doctor') {
    const json = args.includes('--json');
    const configPath = args.find((arg) => arg !== '--json');
    const checks = collectDoctorChecks(configPath);
    printDoctorReport(checks, json);
    if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
    return;
  }
  if (command === 'start') {
    const { runDaemon } = await import('../main.js');
    await runDaemon(args[0]);
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
