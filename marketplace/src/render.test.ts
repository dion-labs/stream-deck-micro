import { describe, expect, it } from 'vitest';
import { renderKey } from './render.js';
import type { DaemonStatus } from './types.js';

const status: DaemonStatus = {
  selectedIndex: 0,
  surface: 'marketplace',
  slots: Array.from({ length: 6 }, (_, index) => ({
    index,
    state: index === 0 ? 'running' : 'idle',
    sessionId: `s${index}`,
    label: index === 0 ? 'Release prep' : `Agent ${index + 1}`,
    detail: '',
  })),
  workflows: [{ id: 'do-it', name: 'DO IT', prompt: 'lets do it' }],
  deck: {
    mode: 'awake',
    settings: {
      autoSleep: { enabled: true, timeoutMinutes: 15 },
      sleepKey: 'sleep',
    },
    layout: [
      { keyIndex: 0, action: { kind: 'slot', index: 0 } },
      { keyIndex: 13, action: { kind: 'sleep' } },
      { keyIndex: 14, action: { kind: 'workflow', id: 'do-it' } },
    ],
    attention: [],
  },
};

describe('Marketplace key rendering', () => {
  it('shows actionable setup feedback only on the center key when offline', () => {
    expect(renderKey(null, 7, false)).toContain('BRIDGE');
    expect(renderKey(null, 0, false)).not.toContain('BRIDGE');
  });

  it('renders live session state and selected emphasis', () => {
    const image = renderKey(status, 0, true);
    expect(image).toContain('RELEASE');
    expect(image).toContain('WORKING');
    expect(image).toContain('#F6F4FF');
  });

  it('blacks out every action while simulated sleep is active', () => {
    const asleep = { ...status, deck: { ...status.deck, mode: 'asleep' as const } };
    expect(renderKey(asleep, 14, false)).not.toContain('DO IT');
    expect(renderKey(asleep, 14, false)).toContain('#000000');
  });

  it('keeps only attention slots visible in attention mode', () => {
    const attention = {
      ...status,
      deck: {
        ...status.deck,
        mode: 'attention' as const,
        attention: [{ index: 0, state: 'done' as const, sessionId: 's0' }],
      },
    };
    expect(renderKey(attention, 0, true)).toContain('ATTENTION');
    expect(renderKey(attention, 14, true)).not.toContain('DO IT');
  });
});
