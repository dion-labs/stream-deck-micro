import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, DeckLayoutSchema, DEFAULT_DECK_SETTINGS, loadConfig, saveDeckLayout, saveDeckSettings, saveWorkflows, saveAppServerUrl, saveSurfaceMode } from './config.js';

let directory: string;
let path: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sdm-config-')); path = join(directory, 'config.json'); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const writers = [
  ['endpoint', () => saveAppServerUrl(path, 'ws://127.0.0.1:17532')],
  ['edition', () => saveSurfaceMode(path, 'marketplace')],
  ['workflows', () => saveWorkflows(path, [{ id: 'fixture', name: 'FIXTURE', prompt: 'Synthetic only' }], [])],
  ['settings', () => saveDeckSettings(path, DEFAULT_DECK_SETTINGS)],
  ['layout', () => saveDeckLayout(path, [{ keyIndex: 0, action: { kind: 'slot', index: 0 } }])],
] as const;

describe('configuration persistence safety', () => {
  it.each(writers)('%s preserves unrelated keys and tightens permissions', (_, save) => {
    writeFileSync(path, JSON.stringify({ fixture: { untouched: true }, admin: { port: 18000 } }), { mode: 0o644 });
    save();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ fixture: { untouched: true }, admin: { port: 18000 } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it.each(writers)('%s refuses to overwrite a malformed existing file', (_, save) => {
    const original = '{"fixture":"preserve me",';
    writeFileSync(path, original);
    expect(save).toThrow(/invalid config/);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
  it.each(writers)('%s refuses a non-object existing configuration', (_, save) => {
    writeFileSync(path, '[]');
    expect(save).toThrow(/config.*object/);
    expect(readFileSync(path, 'utf8')).toBe('[]');
  });
  it.each(writers.flatMap(([name, save]) => ['null', '42', '"fixture"', 'true'].map(body => [name, body, save] as const)))('%s preserves non-object %s', (_, body, save) => {
    writeFileSync(path, body);
    expect(save).toThrow(/config.*object/);
    expect(readFileSync(path, 'utf8')).toBe(body);
  });
  it.each(writers)('%s creates a missing fixture file', (_, save) => {
    expect(save()).toBe(path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(expect.any(Object));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it('clears only the shared endpoint and keeps sibling keys', () => {
    writeFileSync(path, JSON.stringify({ appServer: { url: 'ws://127.0.0.1:17532', fixture: true }, other: 'preserved' }));
    saveAppServerUrl(path, null);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ appServer: { fixture: true }, other: 'preserved' });
  });
  it('loads only the explicitly supplied fixture and rejects malformed data', () => {
    writeFileSync(path, JSON.stringify({ slots: { count: 15, cwd: directory } }));
    expect(loadConfig(path)).toMatchObject({ sourcePath: path, config: { slots: { count: 15, cwd: directory } } });
    writeFileSync(path, '{');
    expect(() => loadConfig(path)).toThrow('invalid config');
  });
});

describe('configuration platform boundaries', () => {
  it.each(['ws://127.0.0.1:17532', 'ws://localhost:17532', 'ws://[::1]:17532'])('accepts local endpoint %s', url => {
    expect(ConfigSchema.safeParse({ appServer: { url } }).success).toBe(true);
  });
  it.each(['ws://evil.example:17532', 'ws://127.0.0.1.evil.example:17532', 'ws://user:secret@127.0.0.1:17532', 'wss://127.0.0.1:17532', 'ws://127.0.0.1'])('rejects endpoint %s', url => {
    expect(ConfigSchema.safeParse({ appServer: { url } }).success).toBe(false);
  });
  it.each([0, 16, 1.5])('rejects slot capacity %s', count => {
    expect(ConfigSchema.safeParse({ slots: { count } }).success).toBe(false);
  });
  it('rejects duplicate physical positions or duplicate slot assignment', () => {
    expect(DeckLayoutSchema.safeParse([{ keyIndex: 0, action: { kind: 'stop' } }, { keyIndex: 0, action: { kind: 'sleep' } }]).success).toBe(false);
    expect(DeckLayoutSchema.safeParse([{ keyIndex: 0, action: { kind: 'slot', index: 1 } }, { keyIndex: 1, action: { kind: 'slot', index: 1 } }]).success).toBe(false);
  });
});
