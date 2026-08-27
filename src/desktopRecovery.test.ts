import { describe, expect, it } from 'vitest';
import { desktopRecoveryState, type DesktopRecoveryInputs } from './desktopRecovery.js';

const healthy: DesktopRecoveryInputs = {
  privateRecovering: false,
  privateComplete: false,
  serverUpdating: false,
  updateRequired: false,
  sharedRestarting: false,
  connectionState: 'connected',
  restoreError: null,
  privateRecoveryError: null,
};

describe('desktop recovery surface decision', () => {
  it('offers fail-safe recovery when session hydration fails on a connected server', () => {
    expect(desktopRecoveryState({ ...healthy, restoreError: 'already has an active writer' }))
      .toBe('shared-error');
  });

  it('keeps shared retry available when Desktop is running privately', () => {
    expect(desktopRecoveryState({ ...healthy, connectionState: 'restart-required' }))
      .toBe('restart-required');
  });

  it('makes private recovery progress and completion authoritative', () => {
    expect(desktopRecoveryState({
      ...healthy, privateRecovering: true, serverUpdating: true, restoreError: 'stale',
    })).toBe('recovering-private');
    expect(desktopRecoveryState({
      ...healthy, privateComplete: true, updateRequired: true,
    })).toBe('private-ready');
  });
});
