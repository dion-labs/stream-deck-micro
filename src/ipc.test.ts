import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ipcCall } from './ipc.js';

let child: ChildProcess;
let directory: string;
let socketPath: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sdm-ipc-'));
  socketPath = join(directory, 'control.sock');
  // Separate disposable daemon: malformed input cannot terminate the test runner.
  child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { serveIpc } from ${JSON.stringify(new URL('./ipc.ts', import.meta.url).href)};
    await serveIpc(process.argv[1], (cmd, args) => {
      if (cmd === 'fail') throw new Error('fixture failure');
      return { cmd, args };
    });
    setInterval(() => {}, 1000);
    process.stdout.write('ready');
  `, socketPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([
    once(child.stdout!, 'data'),
    once(child, 'exit').then(([code]) => { throw new Error(`Fixture exited ${code}`); }),
  ]);
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  rmSync(directory, { recursive: true, force: true });
});

function rawCall(line: string, splitAt?: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setEncoding('utf8');
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('fixture response timeout')); }, 1000);
    socket.on('connect', () => {
      const frame = Buffer.from(line + '\n');
      if (splitAt === undefined) socket.write(frame);
      else {
        socket.write(frame.subarray(0, splitAt));
        setTimeout(() => socket.write(frame.subarray(splitAt)), 20);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); reject(new Error('fixture disconnected before reply')); });
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;
      try { resolve(JSON.parse(buffer.split('\n')[0])); } catch (error) { reject(error); }
      socket.destroy();
    });
  });
}

describe('isolated local IPC recovery', () => {
  it('keeps socket private and round trips synthetic arguments', async () => {
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    expect(await ipcCall(socketPath, 'echo', { text: 'fixture' })).toEqual({ cmd: 'echo', args: { text: 'fixture' } });
  });
  it.each(['null', '[]', '42', '"text"', '{', '{"id":7}', '{"id":7,"cmd":"echo","args":[]}', '{"cmd":"echo","args":null}', '{"cmd":"echo","args":true}'])('rejects %s and accepts the next request', async line => {
    expect(await rawCall(line)).toMatchObject({ ok: false });
    expect(await ipcCall(socketPath, 'echo')).toEqual({ cmd: 'echo', args: {} });
  });
  it.each(['è', '👩', '漢'])('preserves split multibyte prompt character %s', async marker => {
    const text = 'caffè 👩‍💻 漢字';
    const line = JSON.stringify({ id: 7, cmd: 'echo', args: { text } });
    const splitAt = Buffer.from(line).indexOf(Buffer.from(marker)) + 1;
    expect(await rawCall(line, splitAt)).toMatchObject({ ok: true, data: { args: { text } } });
  });
  it('reports handler errors without poisoning subsequent requests', async () => {
    await expect(ipcCall(socketPath, 'fail')).rejects.toThrow('fixture failure');
    expect(await ipcCall(socketPath, 'echo')).toEqual({ cmd: 'echo', args: {} });
  });
});
