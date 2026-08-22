import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

/**
 * Minimal JSON-RPC 2.0 client over a child process's stdio, speaking the codex
 * app-server protocol (newline-delimited JSON). Supports requests, client
 * notifications, server notifications and server→client requests.
 */
export interface RpcConnectionEvents {
  notification: (method: string, params: unknown) => void;
  /** Server-initiated request; respond with respondToServer(id, result) or rejectServer(id, message). */
  serverRequest: (id: string | number, method: string, params: unknown) => void;
  exit: (code: number | null) => void;
}

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: any) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export class RpcConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly emitter = new EventEmitter();
  private sendPayload: ((payload: unknown) => void) | null = null;
  private closeTransport: (() => void) | null = null;
  private closed = false;

  private constructor() {}

  static spawn(command: string, args: string[]): RpcConnection {
    const connection = new RpcConnection();
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    connection.bindChild(child);
    return connection;
  }

  /** Connect to an App Server WebSocket. Requests made while connecting are queued. */
  static webSocket(
    url: string,
    factory: WebSocketFactory = (endpoint) => new WebSocket(endpoint),
  ): RpcConnection {
    const connection = new RpcConnection();
    connection.bindWebSocket(factory(url));
    return connection;
  }

  private bindChild(child: ChildProcessWithoutNullStreams): void {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // server may print non-protocol noise to stdout
      }
      this.dispatch(msg);
    });
    child.on('exit', (code) => {
      this.fail(new Error(`app-server exited (code ${code})`));
      this.emitter.emit('exit', code);
    });
    child.stderr.on('data', () => {
      // diagnostics only; surfaced nowhere to keep key output clean
    });
    this.sendPayload = (payload) => {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    };
    this.closeTransport = () => child.kill();
  }

  private bindWebSocket(socket: WebSocketLike): void {
    const queued: string[] = [];
    this.sendPayload = (payload) => {
      const encoded = JSON.stringify(payload);
      if (socket.readyState === 1) socket.send(encoded);
      else if (socket.readyState === 0) queued.push(encoded);
      else this.fail(new Error('app-server WebSocket is closed'));
    };
    this.closeTransport = () => socket.close();
    socket.addEventListener('open', () => {
      for (const payload of queued.splice(0)) socket.send(payload);
    });
    socket.addEventListener('message', (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.dispatch(msg);
    });
    socket.addEventListener('error', () => {
      this.fail(new Error('app-server WebSocket failed'));
    });
    socket.addEventListener('close', () => {
      this.fail(new Error('app-server WebSocket closed'));
      this.emitter.emit('exit', null);
    });
  }

  on<K extends keyof RpcConnectionEvents>(event: K, listener: RpcConnectionEvents[K]): void {
    this.emitter.on(event, listener);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(method: string, params?: unknown, timeoutMs = 60000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  respondToServer(id: string | number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  rejectServer(id: string | number, message: string): void {
    this.send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (typeof msg.method === 'string') {
      if (msg.id !== undefined) {
        this.emitter.emit('serverRequest', msg.id, msg.method, msg.params);
      } else {
        this.emitter.emit('notification', msg.method, msg.params);
      }
      return;
    }
    if (typeof msg.id === 'number') {
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        const err = msg.error as { code?: number; message?: string } | undefined;
        if (err) {
          waiter.reject(
            new Error(`rpc error ${String(err.code ?? '')} ${String(err.message ?? '')}`.trim()),
          );
        } else {
          waiter.resolve(msg.result);
        }
      }
    }
  }

  private send(payload: unknown): void {
    if (this.closed) return;
    this.sendPayload?.(payload);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  close(): void {
    if (this.closed) return;
    this.fail(new Error('connection closed'));
    this.closeTransport?.();
    this.emitter.removeAllListeners();
  }
}
