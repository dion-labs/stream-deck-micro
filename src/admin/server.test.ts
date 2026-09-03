import { afterEach, describe, expect, it } from 'vitest';
import { HOSTED_HEALTH_PATH, startAdminServer, type AdminServer } from './server.js';

let server: AdminServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('Control Room server', () => {
  function hostedStatus() {
    const component = (state: string, message: string, extra = {}) => ({ state, message, ...extra });
    return {
      capabilities: {
        mode: 'navigation-only',
        label: 'Navigation only',
        reason: 'Saved buttons can open Codex. SECRET-CAPABILITY-MESSAGE',
        canNavigateSessions: true,
        canConfigure: true,
        canControlSessions: false,
        canListSessions: false,
        secretCapability: 'do not expose',
      },
      health: {
        overall: 'degraded',
        components: {
          bridge: component('ready', 'Local Micro bridge is responding.'),
          surface: component('ready', 'One Stream Deck is connected.'),
          plugin: component('ready', 'Plugin connected. SECRET-COMPONENT-MESSAGE', { version: '0.1.0.5', token: 'secret' }),
          codexDesktop: component('navigation-only', 'Codex remains private.'),
          sharedControl: component('navigation-only', 'Live control is unavailable.'),
          bindings: component('navigation-only', 'Six saved bindings loaded.'),
        },
      },
      slots: [{ id: 'private-task', name: 'Private task', cwd: '/secret/path' }],
      workflows: [{ prompt: 'secret prompt' }],
    };
  }

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

  it('serves the packaged Control Room character assets', async () => {
    server = await startAdminServer(0, async () => ({}));
    const response = await fetch(`${server.url}/assets/console-spirit.webp`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
  });

  it('rejects API calls without the page token', async () => {
    server = await startAdminServer(0, async () => ({}));
    const response = await fetch(`${server.url}/api/status`);
    expect(response.status).toBe(401);
  });

  it('serves a redacted, read-only health contract to the exact hosted origin', async () => {
    const calls: string[] = [];
    server = await startAdminServer(0, async (cmd) => {
      calls.push(cmd);
      return hostedStatus();
    });

    const response = await fetch(`${server.url}${HOSTED_HEALTH_PATH}`, {
      headers: { origin: 'https://deck.dionlabs.ai' },
    });
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://deck.dionlabs.ai');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual(['status']);
    expect(body).toMatchObject({
      schemaVersion: 1,
      bridge: { reachable: true, version: '0.1.0' },
      capabilities: {
        mode: 'navigation-only',
        canNavigateSessions: true,
        canControlSessions: false,
      },
      health: {
        overall: 'degraded',
        components: { plugin: { state: 'ready', version: '0.1.0.5' } },
      },
    });
    expect(serialized).not.toContain('private-task');
    expect(serialized).not.toContain('Private task');
    expect(serialized).not.toContain('/secret/path');
    expect(serialized).not.toContain('secret prompt');
    expect(serialized).not.toContain('secretCapability');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('SECRET-CAPABILITY-MESSAGE');
    expect(serialized).not.toContain('SECRET-COMPONENT-MESSAGE');
  });

  it('supports the local development origin and legacy private-network preflight', async () => {
    let calls = 0;
    server = await startAdminServer(0, async () => {
      calls += 1;
      return hostedStatus();
    });

    const preflight = await fetch(`${server.url}${HOSTED_HEALTH_PATH}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5173',
        'access-control-request-private-network': 'true',
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
    expect(calls).toBe(0);
  });

  it('rejects untrusted hosted origins before reading daemon status', async () => {
    let called = false;
    server = await startAdminServer(0, async () => {
      called = true;
      return hostedStatus();
    });

    const response = await fetch(`${server.url}${HOSTED_HEALTH_PATH}`, {
      headers: { origin: 'https://malicious.example' },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(called).toBe(false);
  });

  it('does not expose a mutation method on the hosted endpoint', async () => {
    server = await startAdminServer(0, async () => hostedStatus());
    const response = await fetch(`${server.url}${HOSTED_HEALTH_PATH}`, {
      method: 'POST',
      headers: { origin: 'https://deck.dionlabs.ai' },
    });
    expect(response.status).toBe(405);
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
    expect(html).toContain("api('slots/swap'");
    expect(html).toContain('slot numbers unchanged');
    expect(html).toContain('Restart ChatGPT Desktop');
    expect(html).toContain('Micro has not attached to your sessions yet');
    expect(html).toContain('Update shared Codex backend');
    expect(html).toContain('may interrupt active turns');
    expect(html).toContain("recovery === 'updating'");
    expect(html).toContain("recovery === 'verification-required'");
    expect(html).toContain("recovery === 'verifying'");
    expect(html).toContain("verificationNeeded ? 'VERIFY'");
    expect(html).toContain("api('desktop/recover'");
    expect(html).toContain("recovery === 'private-ready'");
    expect(html).toContain("privateReady ? 'READY' : 'PRIVATE'");
    expect(html).toContain('stop verified leftover listeners');
    expect(html).toContain('navigation only');
    expect(html).toContain('Copy diagnostics');
    expect(html).toContain("api('diagnostics')");
    expect(html).toContain('canControlSessions');
    expect(html).toContain("Selected key · K' + (selectedKeyIndex + 1)");
  });

  it('serves redacted diagnostics as a read-only API', async () => {
    server = await startAdminServer(0, async (cmd) => ({ cmd, privacy: 'redacted' }));
    const page = await fetch(server.url);
    const html = await page.text();
    const token = html.match(/meta name="sdm-api-token" content="([^"]+)"/)?.[1];

    const response = await fetch(`${server.url}/api/diagnostics`, {
      headers: { 'x-stream-deck-micro-token': token as string },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cmd: 'diagnostics', privacy: 'redacted' });
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
