import { spawn } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let fixtureHome: string;
let server: Server;
let selectedIndex = 0;
const requests: { cmd: string; args: Record<string, unknown> }[] = [];
const connections = new Set<Socket>();
beforeEach(async () => {
  fixtureHome = mkdtempSync(join(tmpdir(), 'sdm-cli-'));
  const appDirectory = join(fixtureHome, '.stream-deck-micro');
  mkdirSync(appDirectory, { mode: 0o700 });
  requests.length = 0;
  selectedIndex = 0;
  server = createServer(socket => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', part => {
      buffer += part;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.split('\n')[0]);
      requests.push(request);
      const index = request.args.index === undefined ? selectedIndex : Number(request.args.index);
      const data = request.cmd === 'status' ? {
        selectedIndex, capabilities: { label: 'Fixture', reason: 'Synthetic only' },
        slots: [{ index: selectedIndex, state: 'idle', sessionId: 'fixture', label: 'Fixture', cwd: '/synthetic', detail: '' }],
        workflows: [], deck: { mode: 'awake', attention: [], settings: { autoSleep: { enabled: false, timeoutMinutes: 15 } } },
      } : { selectedIndex: index, cleared: index, renamed: index };
      socket.end(JSON.stringify({ id: request.id, ok: true, data }) + '\n');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(join(appDirectory, 'daemon.sock'), resolve);
  });
});
afterEach(async () => {
  for (const socket of connections) socket.destroy();
  connections.clear();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(fixtureHome, { recursive: true, force: true });
});

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Child-only HOME isolates the actual CLI from all installed sockets/data.
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./sdm.ts', import.meta.url)), ...args], {
      env: { PATH: '/usr/bin:/bin', HOME: fixtureHome, TMPDIR: fixtureHome }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic CLI timeout')); }, 4000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.on('close', code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
}

describe.each(['select', 'clear', 'rename'])('sdm %s slot arguments', cmd => {
  it.each(['bad', 'Infinity', '0', '16', '1.5', ''])('rejects %j before contacting the daemon', async value => {
    const result = await cli([cmd, value, ...(cmd === 'rename' ? ['Fixture'] : [])]);
    expect(requests).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/slot|usage/);
  });
  it.each([1, 15])('maps human slot %s to its exact zero-based index', async number => {
    const result = await cli([cmd, String(number), ...(cmd === 'rename' ? ['Fixture'] : [])]);
    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ cmd, args: { index: number - 1 } });
  });
});
it('rejects a missing select argument without touching a slot', async () => {
  expect((await cli(['select'])).code).toBe(1);
  expect(requests).toEqual([]);
});
it('retains omitted clear as the selected-slot operation', async () => {
  selectedIndex = 3;
  const result = await cli(['clear']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('cleared slot 4');
  expect(requests[0]).toMatchObject({ cmd: 'clear', args: {} });
  expect(requests[0].args).not.toHaveProperty('index');
});
it('retains explicit custom-label clearing', async () => {
  expect((await cli(['rename', '2', '-'])).code).toBe(0);
  expect(requests[0]).toMatchObject({ cmd: 'rename', args: { index: 1, label: null } });
});
it.each([0, 14])('prints selected slot %s using human numbering', async index => {
  selectedIndex = index;
  const result = await cli(['status']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`selected: ${index + 1}\n`);
});
