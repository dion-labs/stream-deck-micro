import { describe, expect, it } from 'vitest';
import { decayState, nextState } from './stateMachine.js';
import type { SessionEvent } from './types.js';

const ev = (e: SessionEvent) => e;

describe('nextState', () => {
  it('starts thinking on turn start', () => {
    expect(nextState('idle', ev({ type: 'turn-started' }))).toBe('thinking');
  });

  it('reasoning keeps thinking', () => {
    expect(nextState('thinking', ev({ type: 'reasoning' }))).toBe('thinking');
  });

  it('tool execution moves thinking → running', () => {
    expect(
      nextState('thinking', ev({ type: 'tool-started', tool: 'shell', detail: 'npm test' })),
    ).toBe('running');
  });

  it('file change is running', () => {
    expect(nextState('running', ev({ type: 'file-change', files: ['a.ts'] }))).toBe('running');
    expect(nextState('thinking', ev({ type: 'file-change', files: ['a.ts'] }))).toBe('running');
  });

  it('reasoning after tools stays running (agent re-plans mid-execution)', () => {
    expect(nextState('running', ev({ type: 'reasoning' }))).toBe('running');
  });

  it('agent message during thinking stays thinking', () => {
    expect(nextState('thinking', ev({ type: 'agent-message', text: 'hi' }))).toBe('thinking');
  });

  it('turn completion → done regardless of prior active state', () => {
    expect(nextState('running', ev({ type: 'turn-completed' }))).toBe('done');
    expect(nextState('thinking', ev({ type: 'turn-completed' }))).toBe('done');
  });

  it('failure → error', () => {
    expect(nextState('running', ev({ type: 'turn-failed', error: 'boom' }))).toBe('error');
  });

  it('ignores tool events outside a turn', () => {
    expect(nextState('idle', ev({ type: 'tool-started', tool: 'x' }))).toBe('idle');
  });
});

describe('decayState', () => {
  it('decays transient states to idle', () => {
    expect(decayState('done')).toBe('idle');
    expect(decayState('error')).toBe('idle');
  });

  it('keeps stable states', () => {
    expect(decayState('idle')).toBe('idle');
    expect(decayState('running')).toBe('running');
    expect(decayState('empty')).toBe('empty');
  });
});
