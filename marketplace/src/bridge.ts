import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DaemonStatus, PluginHeartbeat } from './types.js';

const SOCKET_PATH = process.env.STREAM_DECK_MICRO_SOCKET
  ?? join(homedir(), '.stream-deck-micro', 'daemon.sock');

export class BridgeClient {
  status(): Promise<DaemonStatus> {
    return this.call<DaemonStatus>('status');
  }

  heartbeat(value: PluginHeartbeat): Promise<DaemonStatus> {
    return this.call<DaemonStatus>('plugin.heartbeat', { ...value });
  }

  press(index: number): Promise<DaemonStatus['deck']> {
    return this.call<DaemonStatus['deck']>('deck.key', { index });
  }

  private call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = connect(SOCKET_PATH);
      const id = Date.now();
      let buffer = '';
      let settled = false;
      const finish = (error?: Error, data?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve(data as T);
      };
      const timeout = setTimeout(
        () => finish(new Error(`local bridge did not answer ${cmd}`)),
        1200,
      );
      socket.on('error', () => finish(new Error('local bridge is not running')));
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ id, cmd, args })}\n`);
      });
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as {
            ok: boolean;
            data?: T;
            error?: string;
          };
          if (response.ok) finish(undefined, response.data);
          else finish(new Error(response.error ?? 'local bridge rejected the request'));
        } catch {
          finish(new Error('local bridge returned an invalid response'));
        }
      });
    });
  }
}
