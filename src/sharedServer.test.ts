import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigSchema, DeckLayoutSchema, saveAppServerUrl, saveSurfaceMode } from './config.js';
import {
  launchAgentPlist,
  processListHasDesktopPrivateAppServer,
  validateLoopbackEndpoint,
} from './sharedServer.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('shared App Server setup', () => {
  it('rejects duplicate layout positions and actions', () => {
    expect(DeckLayoutSchema.safeParse([
      { keyIndex: 0, action: { kind: 'stop' } },
      { keyIndex: 0, action: { kind: 'attach' } },
    ]).success).toBe(false);
    expect(DeckLayoutSchema.safeParse([
      { keyIndex: 0, action: { kind: 'stop' } },
      { keyIndex: 1, action: { kind: 'stop' } },
    ]).success).toBe(false);
  });

  it('accepts only explicit loopback WebSocket endpoints', () => {
    expect(validateLoopbackEndpoint('ws://127.0.0.1:17532')).toBe('ws://127.0.0.1:17532');
    expect(
      ConfigSchema.safeParse({ appServer: { url: 'ws://example.com:17532' } }).success,
    ).toBe(false);
    expect(() => validateLoopbackEndpoint('ws://example.com:17532')).toThrow('loopback');
    expect(() => validateLoopbackEndpoint('http://127.0.0.1:17532')).toThrow('loopback');
    expect(() => validateLoopbackEndpoint('ws://127.0.0.1')).toThrow('explicit port');
  });

  it('escapes launch-agent values', () => {
    const plist = launchAgentPlist({
      label: 'test<&',
      args: ['/tmp/Codex & Friends', '--listen', 'ws://127.0.0.1:17532'],
      keepAlive: true,
      stdoutPath: '/tmp/out.log',
      stderrPath: '/tmp/error.log',
    });
    expect(plist).toContain('<string>test&lt;&amp;</string>');
    expect(plist).toContain('<string>/tmp/Codex &amp; Friends</string>');
    expect(plist).toContain('<true/>');
  });

  it('writes and removes the endpoint without discarding other configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdm-shared-'));
    tempDirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ slots: { count: 4 }, custom: 'kept' }));

    saveAppServerUrl(path, 'ws://127.0.0.1:17532');
    const installed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(installed.custom).toBe('kept');
    expect(installed.harness).toBe('codex-app-server');
    expect(installed.appServer.url).toBe('ws://127.0.0.1:17532');
    expect(ConfigSchema.parse(installed).appServer.url).toBe('ws://127.0.0.1:17532');

    saveAppServerUrl(path, null);
    const removed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(removed.custom).toBe('kept');
    expect(removed.appServer).toBeUndefined();
  });

  it('does not overwrite malformed configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdm-shared-bad-'));
    tempDirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, '{ not-json');

    expect(() => saveAppServerUrl(path, 'ws://127.0.0.1:17532')).toThrow('invalid config');
    expect(readFileSync(path, 'utf8')).toBe('{ not-json');
  });

  it('selects an edition without discarding unrelated configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdm-surface-'));
    tempDirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ custom: 'kept', surface: { note: 'kept' } }));

    saveSurfaceMode(path, 'marketplace');
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(saved.custom).toBe('kept');
    expect(saved.surface).toEqual({ note: 'kept', mode: 'marketplace' });
    expect(ConfigSchema.parse(saved).surface.mode).toBe('marketplace');
  });

  it('only treats a private stdio server owned by Desktop as restart evidence', () => {
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const desktop = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
    expect(processListHasDesktopPrivateAppServer([
      `100 1 ${desktop}`,
      '110 100 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
      `120 110 ${codex} app-server --listen stdio://`,
    ].join('\n'))).toBe(true);
    expect(processListHasDesktopPrivateAppServer([
      `200 1 ${codex} app-server --listen ws://127.0.0.1:17532`,
      '210 200 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
      `220 210 ${codex} app-server --listen stdio://`,
    ].join('\n'))).toBe(false);
  });
});
