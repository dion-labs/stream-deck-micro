import { describe, expect, it } from 'vitest';
import { RpcConnection } from './rpc.js';

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, ((event: any) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  private emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('RpcConnection WebSocket transport', () => {
  it('queues requests until open and resolves JSON-RPC responses', async () => {
    const socket = new FakeSocket();
    const connection = RpcConnection.webSocket('ws://127.0.0.1:17532', () => socket);
    const pending = connection.request('thread/list', { limit: 10 });
    expect(socket.sent).toEqual([]);

    socket.open();
    const request = JSON.parse(socket.sent[0]) as { id: number; method: string };
    expect(request.method).toBe('thread/list');
    socket.receive({ jsonrpc: '2.0', id: request.id, result: { data: [] } });

    await expect(pending).resolves.toEqual({ data: [] });
    connection.close();
  });

  it('routes server notifications', () => {
    const socket = new FakeSocket();
    const connection = RpcConnection.webSocket('ws://127.0.0.1:17532', () => socket);
    const received: unknown[] = [];
    connection.on('notification', (method, params) => received.push({ method, params }));
    socket.open();
    socket.receive({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: 't-1' } });

    expect(received).toEqual([{ method: 'turn/started', params: { threadId: 't-1' } }]);
    connection.close();
  });

  it('rejects pending requests when the socket closes', async () => {
    const socket = new FakeSocket();
    const connection = RpcConnection.webSocket('ws://127.0.0.1:17532', () => socket);
    socket.open();
    const pending = connection.request('thread/list');
    socket.close();

    await expect(pending).rejects.toThrow('WebSocket closed');
  });
});
