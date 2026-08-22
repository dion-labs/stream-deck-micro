import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

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

export const ConfigSchema = z.object({
  harness: z.enum(['codex', 'codex-app-server']).default('codex'),
  slots: z
    .object({
      count: z.number().int().min(1).max(6).default(6),
      cwd: z.string().default(join(homedir(), 'dev')),
    })
    .default({}),
  /** app-server only: fill free slots with recent sessions (incl. desktop/VS Code ones). */
  attachExternal: z.boolean().default(true),
  /** Localhost web admin panel. */
  admin: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).default(17531),
    })
    .default({}),
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
