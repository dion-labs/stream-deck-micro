import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ipcCall } from './ipc.js';
let directory: string;
let socketPath: string;
let server: Server;
const connections = new Set<Socket>();
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sdm-client-')); socketPath = join(directory, 'fixture.sock'); });
afterEach(async () => {
  for (const connection of connections) connection.destroy();
  connections.clear();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(directory, { recursive: true, force: true });
});
async function listen(handler: (socket: Socket) => void) {
  server = createServer(socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); handler(socket); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
}

describe('IPC client stream recovery', () => {
  it.each(['è', '👩', '漢'])('decodes split multibyte response character %s', async marker => {
    const text = 'caffè 👩‍💻 漢字';
    await listen(socket => {
      socket.once('data', () => {
        const response = Buffer.from(JSON.stringify({ id: 1, ok: true, data: { text } }) + '\n');
        const splitAt = response.indexOf(Buffer.from(marker)) + 1;
        socket.write(response.subarray(0, splitAt));
        setTimeout(() => socket.end(response.subarray(splitAt)), 20);
      });
    });
    expect(await ipcCall(socketPath, 'status', {}, 1000)).toEqual({ text });
  });
  it('reports early EOF instead of waiting for the request timeout', async () => {
    await listen(socket => socket.once('data', () => socket.end()));
    await expect(ipcCall(socketPath, 'status', {}, 200)).rejects.toThrow(/disconnected|closed/);
  });
  it('reports truncated JSON on disconnect without claiming success', async () => {
    await listen(socket => socket.once('data', () => socket.end('{"ok":true')));
    await expect(ipcCall(socketPath, 'status', {}, 200)).rejects.toThrow(/disconnected|closed/);
  });
  it('times out a silent peer and can call again after recovery', async () => {
    let calls = 0;
    await listen(socket => socket.once('data', () => {
      if (++calls > 1) socket.end(JSON.stringify({ id: 2, ok: true, data: 'recovered' }) + '\n');
    }));
    await expect(ipcCall(socketPath, 'status', {}, 30)).rejects.toThrow(/timed out/);
    expect(await ipcCall(socketPath, 'status', {}, 1000)).toBe('recovered');
  });
  it('rejects non-serializable arguments without sending a request', async () => {
    let received = false;
    await listen(socket => socket.on('data', () => { received = true; }));
    const args: Record<string, unknown> = {};
    args.self = args;
    await expect(ipcCall(socketPath, 'status', args, 1000)).rejects.toThrow(/circular/i);
    expect(received).toBe(false);
  });
  it('reports connection failure with daemon context', async () => {
    await expect(ipcCall(socketPath, 'status', {}, 200)).rejects.toThrow('cannot reach daemon');
  });
});
