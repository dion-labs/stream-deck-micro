import { describe, expect, it } from 'vitest';
import { renderKey, svgDataUrl } from './render.js';
import type { DaemonStatus } from './types.js';

const status: DaemonStatus = {
  selectedIndex: 0,
  surface: 'marketplace',
  capabilities: {
    mode: 'live',
    label: 'Live control',
    reason: 'Shared sessions are ready.',
    canNavigateSessions: true,
    canConfigure: true,
    canControlSessions: true,
    canListSessions: true,
  },
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
    capabilityMode: 'live',
    actionFeedback: null,
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

  it('distinguishes navigation-only sessions and disables control actions', () => {
    const navigation = {
      ...status,
      capabilities: {
        ...status.capabilities!,
        mode: 'navigation-only' as const,
        canControlSessions: false,
        canListSessions: false,
      },
    };
    expect(renderKey(navigation, 0, true)).toContain('NAV ONLY');
    expect(renderKey(navigation, 0, true)).toContain('#185B64');
    expect(renderKey(navigation, 14, true)).toContain('LIVE OFF');
  });

  it('renders immediate blocked-action feedback', () => {
    const blocked = {
      ...status,
      deck: {
        ...status.deck,
        actionFeedback: {
          keyIndex: 14,
          outcome: 'blocked' as const,
          message: 'LIVE OFF',
          expiresAt: Date.now() + 1_000,
        },
      },
    };
    expect(renderKey(blocked, 14, false)).toContain('BLOCKED');
    expect(renderKey(blocked, 14, false)).toContain('LIVE OFF');
  });

  it('keeps rendering with a pre-heartbeat bridge during rolling upgrades', () => {
    const legacy = {
      ...status,
      capabilities: undefined,
      deck: { ...status.deck, capabilityMode: undefined, actionFeedback: undefined },
    };
    expect(renderKey(legacy, 0, true)).toContain('WORKING');
    expect(renderKey(legacy, 14, true)).toContain('PROMPT');
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

  it('offers shared retry and a clearly labelled private Codex fallback', () => {
    const recovery = {
      ...status,
      deck: { ...status.deck, desktopRecovery: 'restart-required' as const },
    };
    expect(renderKey(recovery, 6, false)).toContain('RETRY');
    expect(renderKey(recovery, 6, false)).toContain('SHARED');
    expect(renderKey(recovery, 7, false)).toContain('PRIVATE');
    expect(renderKey(recovery, 7, false)).toContain('CODEX');
    expect(renderKey(recovery, 0, false)).not.toContain('RESTART');

    const restarting = {
      ...status,
      deck: { ...status.deck, desktopRecovery: 'restarting' as const },
    };
    expect(renderKey(restarting, 7, false)).toContain('OPENING');
  });

  it('renders update/recovery choices and collapses to one busy key', () => {
    for (const state of ['update-required', 'updating'] as const) {
      const recovery = { ...status, deck: { ...status.deck, desktopRecovery: state } };
      expect(renderKey(recovery, 7, false)).toContain(state === 'updating' ? 'UPDATING' : 'PRIVATE');
      if (state === 'update-required') expect(renderKey(recovery, 6, false)).toContain('UPDATE');
      for (let key = 0; key < 15; key += 1) {
        if (key !== 7 && !(key === 6 && state === 'update-required')) {
          expect(renderKey(recovery, key, false)).not.toContain('<text');
        }
      }
    }
  });

  it('distinguishes Codex verification from an ordinary shared retry', () => {
    const required = {
      ...status,
      deck: { ...status.deck, desktopRecovery: 'verification-required' as const },
    };
    expect(renderKey(required, 6, false)).toContain('VERIFY');
    expect(renderKey(required, 6, false)).toContain('CODEX');
    expect(renderKey(required, 7, false)).toContain('PRIVATE');

    const verifying = {
      ...status,
      deck: { ...status.deck, desktopRecovery: 'verifying' as const },
    };
    expect(renderKey(verifying, 7, false)).toContain('VERIFYING');
    expect(renderKey(verifying, 6, false)).not.toContain('<text');
  });

  it('shows private recovery failure, progress, and success states', () => {
    expect(renderKey({ ...status, deck: { ...status.deck, desktopRecovery: 'shared-error' } }, 7, false)).toContain('PRIVATE');
    expect(renderKey({ ...status, deck: { ...status.deck, desktopRecovery: 'recovering-private' } }, 7, false)).toContain('RECOVERING');
    const ready = renderKey({ ...status, deck: { ...status.deck, desktopRecovery: 'private-ready' } }, 7, false);
    expect(ready).toContain('READY');
    expect(ready).toContain('PRIVATE');
  });
});
