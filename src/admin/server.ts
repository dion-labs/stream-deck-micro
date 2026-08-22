import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ADMIN_HTML } from './ui.js';

export type ApiHandler = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

const MAX_BODY_BYTES = 1_000_000;

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
  const requestOrigin = req.headers.origin;
  if (requestOrigin && requestOrigin !== context.origin) {
    sendJson(res, 403, { error: 'forbidden origin' });
    return;
  }

  const url = new URL(req.url ?? '/', context.origin);
  const path = url.pathname;

  try {
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
    const allowedGet = ['status', 'sessions', 'workflows.get'];
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
