import type { AgentState } from '../core/types.js';

/** Semantic key identities, independent of physical layout. */
export type KeyAction =
  | { kind: 'slot'; index: number }
  | { kind: 'stop' }
  | { kind: 'sleep' }
  | { kind: 'attach' }
  | { kind: 'workflow'; id: string };

export interface WorkflowKey {
  id: string;
  name: string;
}

/**
 * 15-key (5×3) layout:
 *   row 0: slots 1–5
 *   row 1: slot 6, DO IT (the 'do-it' workflow), STOP, ATTACH, workflow #5
 *   row 2: workflows #1–4, SLEEP in the bottom-right corner
 */
export const SLOT_KEYS = [0, 1, 2, 3, 4, 5];
export const KEY_DO_IT = 6;
export const KEY_STOP = 7;
export const KEY_ATTACH = 8;
export const KEY_WF_EXTRA = 9;
export const KEY_SLEEP = 14;

/** Where each workflow lands: 'do-it' is pinned to its own action-style key. */
export function workflowKeyAssignments(workflows: WorkflowKey[]): {
  key: number;
  workflow: WorkflowKey;
  style: 'action' | 'workflow';
}[] {
  const assignments: { key: number; workflow: WorkflowKey; style: 'action' | 'workflow' }[] = [];
  const rest = workflows.filter((w) => w.id !== 'do-it');
  const doIt = workflows.find((w) => w.id === 'do-it');
  if (doIt) assignments.push({ key: KEY_DO_IT, workflow: doIt, style: 'action' });
  const restKeys = [10, 11, 12, 13, KEY_WF_EXTRA];
  rest.slice(0, restKeys.length).forEach((w, i) => {
    assignments.push({ key: restKeys[i], workflow: w, style: 'workflow' });
  });
  return assignments;
}

export function layoutActions(workflows: WorkflowKey[]): Map<number, KeyAction> {
  const map = new Map<number, KeyAction>();
  SLOT_KEYS.forEach((key, i) => map.set(key, { kind: 'slot', index: i }));
  map.set(KEY_STOP, { kind: 'stop' });
  map.set(KEY_SLEEP, { kind: 'sleep' });
  map.set(KEY_ATTACH, { kind: 'attach' });
  for (const { key, workflow } of workflowKeyAssignments(workflows)) {
    map.set(key, { kind: 'workflow', id: workflow.id });
  }
  return map;
}

/** State → key background color (Codex Micro RGB semantics). */
export function stateColor(state: AgentState, pulsePhase = 0): [number, number, number] {
  const dim = (c: [number, number, number], f: number): [number, number, number] =>
    c.map((v) => Math.round(v * f)) as [number, number, number];
  switch (state) {
    case 'empty':
      return [32, 32, 38];
    case 'idle':
      return [58, 63, 68];
    case 'thinking':
      return pulsePhase ? [124, 58, 237] : dim([124, 58, 237], 0.55); // purple pulse
    case 'running':
      return pulsePhase ? [37, 99, 235] : dim([37, 99, 235], 0.55); // blue pulse
    case 'done':
      return [22, 163, 74]; // green flash
    case 'error':
      return [220, 38, 38]; // red
  }
}

export const ACTION_KEYS_STYLE: Record<'stop' | 'sleep' | 'attach', { title: string; color: [number, number, number] }> = {
  stop: { title: 'STOP', color: [220, 38, 38] },
  sleep: { title: 'SLEEP', color: [45, 55, 72] },
  attach: { title: 'ATCH', color: [180, 108, 20] },
};

export const DO_IT_STYLE: { title: string; color: [number, number, number] } = {
  title: 'DO IT',
  color: [22, 120, 70],
};
