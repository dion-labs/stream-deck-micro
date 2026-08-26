import { describe, expect, it } from 'vitest';
import { renderKey, svgDataUrl } from './render.js';
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
    desktopRecovery: null,
  },
};

describe('Marketplace key rendering', () => {
  it('encodes generated SVG in the format accepted by setImage', () => {
    const svg = renderKey(status, 0, true);
    const image = svgDataUrl(svg);
    expect(image).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(decodeURIComponent(image.slice('data:image/svg+xml,'.length))).toBe(svg);
  });

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

  it('confirms a replacement even when the session label and state are unchanged', () => {
    const attached = {
      ...status,
      slots: status.slots.map((slot, index) => index === 0
        ? { ...slot, detail: 'session attached' }
        : slot),
    };
    expect(renderKey(attached, 0, true)).toContain('ATTACHED');
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
    expect(renderKey(attention, 0, true)).toContain('#FFD84A');
    expect(renderKey(attention, 0, true)).toContain('#16130A');
    expect(renderKey(attention, 0, true)).toContain('DONE · OPEN');
    expect(renderKey(attention, 0, true)).not.toContain('#16A34A');
    expect(renderKey(attention, 0, false)).toContain('#5A4708');
    expect(renderKey(attention, 14, true)).not.toContain('DO IT');
  });

  it('replaces the surface with one central Codex recovery key', () => {
    const recovery = {
      ...status,
      deck: { ...status.deck, desktopRecovery: 'restart-required' as const },
    };
    expect(renderKey(recovery, 7, false)).toContain('RESTART');
    expect(renderKey(recovery, 7, false)).toContain('CODEX');
    expect(renderKey(recovery, 0, false)).not.toContain('RESTART');

    const restarting = {
      ...status,
      deck: { ...status.deck, desktopRecovery: 'restarting' as const },
    };
    expect(renderKey(restarting, 7, false)).toContain('OPENING');
  });

  it('renders update and updating labels only on the central recovery key', () => {
    for (const state of ['update-required', 'updating'] as const) {
      const recovery = { ...status, deck: { ...status.deck, desktopRecovery: state } };
      expect(renderKey(recovery, 7, false)).toContain(state === 'updating' ? 'UPDATING' : 'UPDATE');
      expect(renderKey(recovery, 7, false)).toContain('CODEX');
      for (let key = 0; key < 15; key += 1) {
        if (key !== 7) expect(renderKey(recovery, key, false)).not.toContain('<text');
      }
    }
  });
});
