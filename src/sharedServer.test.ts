import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigSchema, DeckLayoutSchema, saveAppServerUrl, saveSurfaceMode } from './config.js';
import {
  desktopConnectionFromOutputs,
  launchAgentPlist,
  managedSharedListenerPids,
  processListHasDesktopPrivateAppServer,
  recoverPrivateCodex,
  restartCodexDesktop,
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

  it('supports one distinct session slot per physical key', () => {
    expect(ConfigSchema.parse({}).slots.count).toBe(15);
    expect(ConfigSchema.safeParse({ slots: { count: 15 } }).success).toBe(true);
    expect(DeckLayoutSchema.safeParse([
      { keyIndex: 14, action: { kind: 'slot', index: 14 } },
    ]).success).toBe(true);
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

  it('only treats a private app server owned by Desktop as restart evidence', () => {
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const desktop = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
    expect(processListHasDesktopPrivateAppServer([
      `100 1 ${desktop}`,
      '110 100 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
      `120 110 ${codex} app-server --listen stdio://`,
    ].join('\n'))).toBe(true);
    expect(processListHasDesktopPrivateAppServer([
      `100 1 ${desktop}`,
      `120 100 ${codex} -c features.code_mode_host=true app-server --analytics-default-enabled`,
    ].join('\n'))).toBe(true);
    expect(processListHasDesktopPrivateAppServer([
      `200 1 ${codex} app-server --listen ws://127.0.0.1:17532`,
      '210 200 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
      `220 210 ${codex} app-server --listen stdio://`,
    ].join('\n'))).toBe(false);
  });

  it('identifies only bundled Codex listeners on the exact managed endpoint', () => {
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const endpoint = 'ws://127.0.0.1:17532';
    const processes = [
      `2099 1 ${codex} app-server --listen ${endpoint}`,
      `2100 1 ${codex} app-server --listen=ws://127.0.0.1:17000`,
      `2101 1 /usr/local/bin/codex app-server --listen ${endpoint}`,
      `2102 1 ${codex} app-server`,
      `2103 1 ${codex} exec --listen ${endpoint}`,
    ].join('\n');
    expect(managedSharedListenerPids(processes, endpoint)).toEqual([2099]);
  });

  it('recovers private Desktop by uninstalling shared mode and stopping its orphan listener', async () => {
    const calls: string[] = [];
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const endpoint = 'ws://127.0.0.1:17532';
    const running = [true, false];
    let processes = `2099 1 ${codex} app-server --listen ${endpoint}`;
    await recoverPrivateCodex('/tmp/micro-config.json', endpoint, {
      requestQuit: async () => { calls.push('quit'); },
      isRunning: () => running.shift() ?? false,
      open: async () => { calls.push('open-private'); },
      wait: async () => { calls.push('wait'); },
      uninstall: async (path) => { calls.push(`uninstall:${path}`); },
      readProcesses: () => processes,
      signal: (pid, signal) => {
        calls.push(`${signal}:${pid}`);
        processes = '';
      },
    });
    expect(calls).toEqual([
      'quit', 'wait', 'uninstall:/tmp/micro-config.json', 'SIGTERM:2099',
      'wait', 'open-private',
    ]);
  });

  it('re-resolves process identity before escalating a stuck listener', async () => {
    const calls: string[] = [];
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const endpoint = 'ws://127.0.0.1:17532';
    let reads = 0;
    await recoverPrivateCodex(undefined, endpoint, {
      requestQuit: async () => {},
      isRunning: () => false,
      open: async () => { calls.push('open-private'); },
      wait: async () => {},
      uninstall: async () => {},
      readProcesses: () => {
        reads += 1;
        return reads === 1
          ? `2099 1 ${codex} app-server --listen ${endpoint}`
          : '2099 1 /Applications/Unrelated.app/Contents/MacOS/helper';
      },
      signal: (pid, signal) => { calls.push(`${signal}:${pid}`); },
    });
    expect(calls).toEqual(['open-private']);
  });

  it('uses SIGKILL only when the same verified listener ignores SIGTERM', async () => {
    const calls: string[] = [];
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const endpoint = 'ws://127.0.0.1:17532';
    let processes = `2099 1 ${codex} app-server --listen ${endpoint}`;
    await recoverPrivateCodex(undefined, endpoint, {
      requestQuit: async () => {}, isRunning: () => false,
      open: async () => { calls.push('open-private'); }, wait: async () => {},
      uninstall: async () => {}, readProcesses: () => processes,
      signal: (pid, signal) => {
        calls.push(`${signal}:${pid}`);
        if (signal === 'SIGKILL') processes = '';
      },
    });
    expect(calls).toEqual(['SIGTERM:2099', 'SIGKILL:2099', 'open-private']);
  });

  it('waits for Desktop without acquiring session writers', () => {
    const desktop = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
    const endpoint = 'ws://127.0.0.1:17532';

    expect(desktopConnectionFromOutputs('', '', endpoint)).toMatchObject({
      state: 'waiting',
      endpoint,
    });
    expect(desktopConnectionFromOutputs(`100 1 ${desktop}`, '', endpoint)).toMatchObject({
      state: 'connecting',
      endpoint,
    });
  });

  it('detects Desktop on the shared WebSocket endpoint', () => {
    const desktop = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
    const endpoint = 'ws://127.0.0.1:17532';
    const sockets = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'ChatGPT 100 user 42u IPv4 0x1 0t0 TCP 127.0.0.1:49100->127.0.0.1:17532 (ESTABLISHED)',
    ].join('\n');

    expect(desktopConnectionFromOutputs(`100 1 ${desktop}`, sockets, endpoint)).toMatchObject({
      state: 'connected',
      endpoint,
    });
  });

  it('requires a full restart when Desktop owns a private stdio server', () => {
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const desktop = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
    const status = desktopConnectionFromOutputs([
      `100 1 ${desktop}`,
      '110 100 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
      `120 110 ${codex} app-server --listen stdio://`,
    ].join('\n'), '', 'ws://127.0.0.1:17532');

    expect(status.state).toBe('restart-required');
    expect(status.message).toContain('Refreshing the window is not enough');
  });

  it('gracefully quits, waits for exit, and reopens Desktop', async () => {
    const calls: string[] = [];
    const running = [true, true, false];
    await restartCodexDesktop({
      requestQuit: async () => { calls.push('quit'); },
      isRunning: () => running.shift() ?? false,
      open: async () => { calls.push('open'); },
      wait: async () => { calls.push('wait'); },
    });

    expect(calls).toEqual(['quit', 'wait', 'wait', 'open']);
  });

  it('does not reopen Desktop before it has actually quit', async () => {
    const calls: string[] = [];
    await expect(restartCodexDesktop({
      requestQuit: async () => { calls.push('quit'); },
      isRunning: () => true,
      open: async () => { calls.push('open'); },
      wait: async () => { calls.push('wait'); },
    }, 2)).rejects.toThrow('did not quit');

    expect(calls).toEqual(['quit', 'wait']);
  });

  it('updates the backend only after Desktop exits, then reopens Desktop', async () => {
    const calls: string[] = [];
    const running = [true, false];
    await restartCodexDesktop({
      requestQuit: async () => { calls.push('quit'); },
      isRunning: () => running.shift() ?? false,
      open: async () => { calls.push('open'); },
      wait: async () => { calls.push('wait'); },
    }, 4, async () => { calls.push('update backend'); });
    expect(calls).toEqual(['quit', 'wait', 'update backend', 'open']);
  });

  it('reopens Desktop and surfaces a backend update failure for retry', async () => {
    const calls: string[] = [];
    await expect(restartCodexDesktop({
      requestQuit: async () => { calls.push('quit'); },
      isRunning: () => false,
      open: async () => { calls.push('open'); },
      wait: async () => {},
    }, 4, async () => { throw new Error('backend failed'); })).rejects.toThrow('backend failed');
    expect(calls).toEqual(['quit', 'open']);
  });

  it('never updates the backend if Desktop refuses to quit', async () => {
    let updated = false;
    await expect(restartCodexDesktop({
      requestQuit: async () => {},
      isRunning: () => true,
      open: async () => {},
      wait: async () => {},
    }, 1, async () => { updated = true; })).rejects.toThrow('did not quit');
    expect(updated).toBe(false);
  });
});
