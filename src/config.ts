import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { DeckLayoutEntry } from './deck/layout.js';

export const DEFAULT_WORKFLOWS = [
  // 'do-it' is pinned to its own action-style key next to the slots
  { id: 'do-it', name: 'DO IT', prompt: 'lets do it' },
  {
    id: 'review',
    name: 'REVIEW',
    prompt:
      'Review the current diff (git diff + recent commits) and report issues by severity. Do not modify files.',
  },
  {
    id: 'debug',
    name: 'DEBUG',
    prompt:
      'Find the root cause of the most recent failure (check test output, logs, git status). Explain the cause, then propose a minimal fix.',
  },
  {
    id: 'tests',
    name: 'TESTS',
    prompt: 'Run the test suite, then fix any failing tests. Report what you changed and why.',
  },
  {
    id: 'status',
    name: 'STATUS',
    prompt: 'Summarize the state of the working tree: changed files, staged work, and TODOs you find.',
  },
];

const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(10),
  prompt: z.string().min(1),
});
export { WorkflowSchema };

export const DeckSettingsSchema = z.object({
  /** Brightness used while the deck is awake (the device accepts 0–100). */
  brightness: z.number().int().min(10).max(100).default(70),
  autoSleep: z
    .object({
      enabled: z.boolean().default(true),
      timeoutMinutes: z.number().int().min(1).max(1440).default(15),
    })
    .default({}),
  /** What the bottom-right hardware key does while the deck is awake. */
  sleepKey: z.enum(['sleep', 'toggle-auto']).default('sleep'),
});

export type DeckSettings = z.infer<typeof DeckSettingsSchema>;
export const DEFAULT_DECK_SETTINGS: DeckSettings = DeckSettingsSchema.parse({});

const KeyActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slot'), index: z.number().int().min(0).max(14) }),
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('sleep') }),
  z.object({ kind: z.literal('attach') }),
  z.object({ kind: z.literal('workflow'), id: z.string().min(1) }),
]);

export const DeckLayoutSchema = z.array(z.object({
  keyIndex: z.number().int().min(0).max(14),
  action: KeyActionSchema,
})).max(15).superRefine((layout, context) => {
  const keys = new Set<number>();
  const actions = new Set<string>();
  for (const entry of layout) {
    const actionId = entry.action.kind === 'slot'
      ? `slot:${entry.action.index}`
      : entry.action.kind === 'workflow'
        ? `workflow:${entry.action.id}`
        : entry.action.kind;
    if (keys.has(entry.keyIndex)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `key ${entry.keyIndex} is assigned more than once` });
    }
    if (actions.has(actionId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${actionId} is assigned more than once` });
    }
    keys.add(entry.keyIndex);
    actions.add(actionId);
  }
});

const AppServerUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  const loopback =
    url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  return url.protocol === 'ws:' && loopback && Boolean(url.port) && !url.username && !url.password;
}, 'must use an unauthenticated loopback ws:// URL with an explicit port');

export const ConfigSchema = z.object({
  /** Who owns key input/output: this process over HID, or the official Elgato plugin. */
  surface: z
    .object({
      mode: z.enum(['independent', 'marketplace']).default('independent'),
    })
    .default({}),
  harness: z.enum(['codex', 'codex-app-server']).default('codex'),
  slots: z
    .object({
      count: z.number().int().min(1).max(15).default(15),
      cwd: z.string().default(join(homedir(), 'dev')),
    })
    .default({}),
  /** app-server only: fill free slots with recent sessions (incl. desktop/VS Code ones). */
  attachExternal: z.boolean().default(true),
  appServer: z
    .object({
      /** Connect to a shared App Server instead of spawning a private process. */
      url: AppServerUrlSchema.optional(),
    })
    .default({}),
  /** Localhost web admin panel. */
  admin: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).default(17531),
    })
    .default({}),
  deck: DeckSettingsSchema.default({}),
  /** Optional complete key map. Omitted uses the standard 15-key layout. */
  layout: DeckLayoutSchema.optional(),
  codex: z
    .object({
      model: z.string().optional(),
      sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('danger-full-access'),
      approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).default('never'),
      modelReasoningEffort: z.string().optional(),
    })
    .default({}),
  workflows: z.array(WorkflowSchema).default(DEFAULT_WORKFLOWS),
  /** Stored-but-not-assigned prompts the active set can pull from (admin UI). */
  workflowsLibrary: z.array(WorkflowSchema).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type SurfaceMode = Config['surface']['mode'];

export interface LoadedConfig {
  config: Config;
  /** File the config was read from; null when running on defaults. */
  sourcePath: string | null;
}

export const APP_DIR = join(homedir(), '.stream-deck-micro');
export const IPC_SOCKET = join(APP_DIR, 'daemon.sock');
export const STATE_FILE = join(APP_DIR, 'state.json');

/** Load config: explicit path → ./config.json → defaults. Throws on invalid JSON shape. */
export function loadConfig(explicitPath?: string): LoadedConfig {
  const candidates = [explicitPath, 'config.json', join(APP_DIR, 'config.json')].filter(
    Boolean,
  ) as string[];
  for (const path of candidates) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      return { config: ConfigSchema.parse(raw), sourcePath: path };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(`invalid config at ${path}: ${String(e)}`);
    }
  }
  return { config: ConfigSchema.parse({}), sourcePath: null };
}

/** Persist the workflow sets back into the config file, preserving other keys. */
export function saveWorkflows(
  sourcePath: string | null,
  workflows: Config['workflows'],
  workflowsLibrary: Config['workflowsLibrary'],
): string {
  const path = sourcePath ?? 'config.json';
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    // missing or unreadable file → start from the other defaults
  }
  raw.workflows = workflows;
  raw.workflowsLibrary = workflowsLibrary;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Persist device settings while preserving every unrelated config key. */
export function saveDeckSettings(
  sourcePath: string | null,
  settings: DeckSettings,
): string {
  const path = sourcePath ?? 'config.json';
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    // missing or unreadable file → start from defaults
  }
  raw.deck = settings;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Persist the physical/virtual key map while preserving all unrelated settings. */
export function saveDeckLayout(
  sourcePath: string | null,
  layout: DeckLayoutEntry[],
): string {
  const path = sourcePath ?? 'config.json';
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    // missing or unreadable file → start from defaults
  }
  raw.layout = layout;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Set or clear the shared App Server endpoint while preserving the rest of the config. */
export function saveAppServerUrl(explicitPath: string | undefined, url: string | null): string {
  const path = explicitPath
    ?? (existsSync('config.json') ? 'config.json' : join(APP_DIR, 'config.json'));
  if (!url && !existsSync(path)) return path;
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`cannot update invalid config at ${path}: ${String(error)}`);
    }
  }
  if (url) {
    raw.harness = 'codex-app-server';
    raw.appServer = { ...(isRecord(raw.appServer) ? raw.appServer : {}), url };
  } else if (isRecord(raw.appServer)) {
    const appServer = { ...raw.appServer };
    delete appServer.url;
    if (Object.keys(appServer).length) raw.appServer = appServer;
    else delete raw.appServer;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Select an edition without discarding any user-owned configuration keys. */
export function saveSurfaceMode(
  explicitPath: string | undefined,
  mode: SurfaceMode,
): string {
  const path = explicitPath
    ?? (existsSync('config.json') ? 'config.json' : join(APP_DIR, 'config.json'));
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`cannot update invalid config at ${path}: ${String(error)}`);
    }
  }
  raw.surface = { ...(isRecord(raw.surface) ? raw.surface : {}), mode };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
