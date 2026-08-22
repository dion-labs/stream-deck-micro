import { afterEach, describe, expect, it } from 'vitest';
import { startAdminServer, type AdminServer } from './server.js';

let server: AdminServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('Control Room server', () => {
  it('serves a tokenized page with hardened response headers', async () => {
    server = await startAdminServer(0, async () => ({}));
    const response = await fetch(server.url);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(html).toMatch(/meta name="sdm-api-token" content="[^"]+"/);
    expect(html).toMatch(/script nonce="[^"]+"/);
  });

  it('rejects API calls without the page token', async () => {
    server = await startAdminServer(0, async () => ({}));
    const response = await fetch(`${server.url}/api/status`);
    expect(response.status).toBe(401);
  });

  it('rejects cross-origin mutation attempts', async () => {
    server = await startAdminServer(0, async () => ({}));
    const page = await fetch(server.url);
    const html = await page.text();
    const token = html.match(/meta name="sdm-api-token" content="([^"]+)"/)?.[1];
    expect(token).toBeTruthy();

    const response = await fetch(`${server.url}/api/stop`, {
      method: 'POST',
      headers: {
        origin: 'https://malicious.example',
        'content-type': 'application/json',
        'x-stream-deck-micro-token': token as string,
      },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('accepts authenticated same-origin API calls', async () => {
    const calls: string[] = [];
    server = await startAdminServer(0, async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    });
    const page = await fetch(server.url);
    const html = await page.text();
    const token = html.match(/meta name="sdm-api-token" content="([^"]+)"/)?.[1];

    const response = await fetch(`${server.url}/api/stop`, {
      method: 'POST',
      headers: {
        origin: server.url,
        'content-type': 'application/json',
        'x-stream-deck-micro-token': token as string,
      },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual(['stop']);
  });

  it('ships safe configure mode and sends STOP as a mutation', async () => {
    server = await startAdminServer(0, async () => ({}));
    const response = await fetch(server.url);
    const html = await response.text();

    expect(html).toContain("var controlMode = 'configure'");
    expect(html).toContain("api('stop', {})");
    expect(html).toContain('drag to reorder');
    expect(html).toContain('Live control');
    expect(html).toContain('slotIndex: targetIndex');
    expect(html).toContain("replacing ? 'Replace' : 'Attach'");
    expect(html).toContain("s.detail === 'session attached' ? 'attached'");
    expect(html).toContain('Refresh titles');
    expect(html).toContain("label:'Session slot ' + (slot.index + 1)");
  });

  it('forwards a targeted replacement attachment to the daemon', async () => {
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    server = await startAdminServer(0, async (cmd, args) => {
      calls.push({ cmd, args });
      return { index: 3, mode: 'writer', name: 'replacement' };
    });
    const page = await fetch(server.url);
    const html = await page.text();
    const token = html.match(/meta name="sdm-api-token" content="([^"]+)"/)?.[1];

    const response = await fetch(`${server.url}/api/attach`, {
      method: 'POST',
      headers: {
        origin: server.url,
        'content-type': 'application/json',
        'x-stream-deck-micro-token': token as string,
      },
      body: JSON.stringify({ id: 'session-new', slotIndex: 3 }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{
      cmd: 'attach',
      args: { id: 'session-new', slotIndex: 3 },
    }]);
  });
});
