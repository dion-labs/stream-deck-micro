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

export class RpcConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly emitter = new EventEmitter();
  private closed = false;

  private constructor(readonly child: ChildProcessWithoutNullStreams) {
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
      this.closed = true;
      const err = new Error(`app-server exited (code ${code})`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.emitter.emit('exit', code);
    });
    child.stderr.on('data', () => {
      // diagnostics only; surfaced nowhere to keep key output clean
    });
  }

  static spawn(command: string, args: string[]): RpcConnection {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    return new RpcConnection(child);
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
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  close(): void {
    this.closed = true;
    for (const { reject } of this.pending.values()) {
      reject(new Error('connection closed'));
    }
    this.pending.clear();
    this.child.kill();
    this.emitter.removeAllListeners();
  }
}
