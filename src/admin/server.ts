import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ADMIN_HTML } from './ui.js';

export type ApiHandler = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

const MAX_BODY_BYTES = 1_000_000;
export const HOSTED_HEALTH_PATH = '/api/hosted/health';

const HOSTED_CONTROL_ROOM_ORIGINS = new Set([
  'https://deck.dionlabs.ai',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

const HEALTH_STATES = new Set([
  'ready',
  'navigation-only',
  'action-required',
  'offline',
  'not-required',
]);

const HEALTH_COMPONENTS = [
  'bridge',
  'surface',
  'plugin',
  'codexDesktop',
  'sharedControl',
  'bindings',
] as const;

export interface AdminServer {
  url: string;
  close(): Promise<void>;
}

interface RequestContext {
  apiToken: string;
  nonce: string;
  origin: string;
}

/**
 * Localhost-only HTTP server backing the admin panel: serves the embedded UI
 * and maps /api routes onto the same command handler the IPC socket uses.
 */
export function startAdminServer(port: number, handle: ApiHandler): Promise<AdminServer> {
  const apiToken = randomBytes(32).toString('base64url');
  const nonce = randomBytes(18).toString('base64url');
  const server = createServer((req, res) => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    void route(req, res, handle, {
      apiToken,
      nonce,
      origin: `http://127.0.0.1:${actualPort}`,
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // admin panel is strictly local: never expose slots/prompts to the network
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('admin server did not expose a TCP address'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}`;
      resolve({
        url,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  handle: ApiHandler,
  context: RequestContext,
): Promise<void> {
  setSecurityHeaders(res, context.nonce);

  const expectedHost = new URL(context.origin).host;
  if (req.headers.host !== expectedHost) {
    sendJson(res, 403, { error: 'forbidden host' });
    return;
  }
  const url = new URL(req.url ?? '/', context.origin);
  const path = url.pathname;

  try {
    if (path === HOSTED_HEALTH_PATH) {
      await serveHostedHealth(req, res, handle);
      return;
    }

    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== context.origin) {
      sendJson(res, 403, { error: 'forbidden origin' });
      return;
    }

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderAdminHtml(context.apiToken, context.nonce));
      return;
    }

    const apiMatch = path.match(/^\/api\/([a-z./-]+)$/);
    if (!apiMatch) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (!tokenMatches(req.headers['x-stream-deck-micro-token'], context.apiToken)) {
      sendJson(res, 401, { error: 'invalid control-room token' });
      return;
    }
    const cmd = apiMatch[1];
    const allowedGet = ['status', 'diagnostics', 'sessions', 'workflows.get', 'deck.settings.get'];
    if (req.method === 'GET' && !allowedGet.includes(cmd)) {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    let args: Record<string, unknown> = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        sendJson(res, 415, { error: 'application/json required' });
        return;
      }
      args = (await readBody(req)) as Record<string, unknown>;
    }
    const data = await handle(cmd.replace(/\//g, '.'), args);
    sendJson(res, 200, data ?? {});
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function serveHostedHealth(
  req: IncomingMessage,
  res: ServerResponse,
  handle: ApiHandler,
): Promise<void> {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !HOSTED_CONTROL_ROOM_ORIGINS.has(origin)) {
    sendJson(res, 403, { error: 'hosted Control Room origin not allowed' });
    return;
  }

  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-max-age', '600');
  res.setHeader('cross-origin-resource-policy', 'cross-origin');
  res.setHeader('vary', 'Origin');
  if (req.headers['access-control-request-private-network'] === 'true') {
    // Retain compatibility with Chromium's earlier Private Network Access
    // preflight while the newer permission-based LNA rollout stabilizes.
    res.setHeader('access-control-allow-private-network', 'true');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  const status = await handle('status', {});
  sendJson(res, 200, hostedHealth(status));
}

function hostedHealth(value: unknown): Record<string, unknown> {
  const status = record(value);
  const capabilities = record(status.capabilities);
  const health = record(status.health);
  const components = record(health.components);
  const safeComponents: Record<string, unknown> = {};

  for (const name of HEALTH_COMPONENTS) {
    const component = record(components[name]);
    const state = stringValue(component.state);
    const safeState = state && HEALTH_STATES.has(state) ? state : 'action-required';
    const version = safeVersion(component.version);
    safeComponents[name] = {
      state: safeState,
      message: componentMessage(name, safeState),
      ...(version ? { version } : {}),
    };
  }

  const mode = stringValue(capabilities.mode);
  const overall = stringValue(health.overall);
  const safeMode = ['live', 'navigation-only', 'offline'].includes(mode ?? '') ? mode! : 'offline';
  const capabilityCopy = safeCapabilityCopy(safeMode);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: 'No prompts, task names, task IDs, paths, configuration, or diagnostics are exposed.',
    bridge: {
      reachable: true,
      version: bridgeVersion(),
    },
    capabilities: {
      mode: safeMode,
      label: capabilityCopy.label,
      reason: capabilityCopy.reason,
      canNavigateSessions: capabilities.canNavigateSessions === true,
      canConfigure: capabilities.canConfigure === true,
      canControlSessions: capabilities.canControlSessions === true,
      canListSessions: capabilities.canListSessions === true,
    },
    health: {
      overall: ['ready', 'degraded', 'action-required'].includes(overall ?? '')
        ? overall
        : 'action-required',
      components: safeComponents,
    },
  };
}

function safeCapabilityCopy(mode: string): { label: string; reason: string } {
  if (mode === 'live') {
    return {
      label: 'Live control',
      reason: 'Codex Desktop and Stream Deck Micro are sharing live sessions.',
    };
  }
  if (mode === 'navigation-only') {
    return {
      label: 'Navigation only',
      reason: 'Saved task buttons can open Codex, but live controls and state sync are unavailable.',
    };
  }
  return {
    label: 'Offline',
    reason: 'No live control or saved navigation bindings are currently available.',
  };
}

function componentMessage(name: typeof HEALTH_COMPONENTS[number], state: string): string {
  const available = state === 'ready' || state === 'navigation-only';
  switch (name) {
    case 'bridge':
      return 'Local Micro bridge is responding.';
    case 'surface':
      return available ? 'The Stream Deck surface is connected.' : 'The Stream Deck surface needs attention.';
    case 'plugin':
      return state === 'not-required'
        ? 'The Elgato plugin is not required in this edition.'
        : available ? 'The Elgato plugin is communicating with Micro.' : 'The Elgato plugin is not communicating with Micro.';
    case 'codexDesktop':
      return state === 'ready'
        ? 'Codex Desktop is connected for live control.'
        : state === 'navigation-only' ? 'Codex remains private; saved buttons can still open its tasks.' : 'Codex Desktop needs attention.';
    case 'sharedControl':
      return state === 'ready'
        ? 'Live prompts, state, focus, and attention sync are available.'
        : 'Live session control is unavailable.';
    case 'bindings':
      return available ? 'Saved session buttons are available.' : 'No saved session buttons are available.';
  }
}

function safeVersion(value: unknown): string | null {
  const version = stringValue(value);
  return version && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/.test(version) ? version : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, 500) : null;
}

let cachedBridgeVersion: string | null = null;

function bridgeVersion(): string {
  if (cachedBridgeVersion) return cachedBridgeVersion;
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    cachedBridgeVersion = stringValue(packageJson.version) ?? 'development';
  } catch {
    cachedBridgeVersion = 'development';
  }
  return cachedBridgeVersion;
}

function renderAdminHtml(apiToken: string, nonce: string): string {
  return ADMIN_HTML
    .replace(
      '<title>',
      `<meta name="sdm-api-token" content="${apiToken}">\n<title>`,
    )
    .replace('<script>', `<script nonce="${nonce}">`);
}

function tokenMatches(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function setSecurityHeaders(res: ServerResponse, nonce: string): void {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-security-policy', [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; '));
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
