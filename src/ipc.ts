import { createServer, connect } from 'node:net';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Line-delimited JSON IPC over a unix socket: {id, cmd, args} → {id, ok, data|error}. */
export type IpcHandler = (
  cmd: string,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export function serveIpc(socketPath: string, handler: IpcHandler): Promise<void> {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    const server = createServer((conn) => {
      let buffer = '';
      conn.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          void handleLine(line, handler, conn);
        }
      });
      conn.on('error', () => conn.destroy());
    });
    server.on('error', reject);
    server.listen(socketPath, () => {
      chmodSync(socketPath, 0o600);
      resolve();
    });
    server.unref?.();
  });
}

async function handleLine(
  line: string,
  handler: IpcHandler,
  conn: import('node:net').Socket,
): Promise<void> {
  let request: { id?: number; cmd?: string; args?: Record<string, unknown> };
  try {
    request = JSON.parse(line);
  } catch {
    conn.write(`${JSON.stringify({ id: null, ok: false, error: 'malformed JSON' })}\n`);
    return;
  }
  if (typeof request.cmd !== 'string') {
    conn.write(
      `${JSON.stringify({ id: request.id ?? null, ok: false, error: 'missing cmd' })}\n`,
    );
    return;
  }
  try {
    const data = await handler(request.cmd, request.args ?? {});
    conn.write(`${JSON.stringify({ id: request.id ?? null, ok: true, data })}\n`);
  } catch (e) {
    conn.write(
      `${JSON.stringify({
        id: request.id ?? null,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })}\n`,
    );
  }
}

export async function ipcCall<T = unknown>(
  socketPath: string,
  cmd: string,
  args: Record<string, unknown> = {},
  timeoutMs = 120000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = connect(socketPath);
    socket.on('error', (e) =>
      reject(new Error(`cannot reach daemon at ${socketPath}: ${String(e)}`)),
    );
    const id = Date.now();
    let buffer = '';
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as {
          id: number;
          ok: boolean;
          data?: T;
          error?: string;
        };
        if (response.ok) resolve(response.data as T);
        else reject(new Error(response.error ?? 'daemon error'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        socket.destroy();
      }
    });
    setTimeout(() => {
      socket.destroy();
      reject(new Error(`ipc call '${cmd}' timed out after ${timeoutMs}ms`));
    }, timeoutMs).unref?.();
  });
}
