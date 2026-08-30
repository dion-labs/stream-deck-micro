import type { DesktopRecoveryState } from './deck/controller.js';
import type { DesktopConnectionState } from './sharedServer.js';

export interface DesktopRecoveryInputs {
  privateRecovering: boolean;
  privateComplete: boolean;
  serverUpdating: boolean;
  updateRequired: boolean;
  sharedRestarting: boolean;
  connectionState: DesktopConnectionState;
  restoreError: string | null;
  privateRecoveryError: string | null;
}

/** Pure priority table for the deck/Control Room fail-safe surface. */
export function desktopRecoveryState(input: DesktopRecoveryInputs): DesktopRecoveryState | null {
  if (input.privateRecovering) return 'recovering-private';
  if (input.privateComplete) return 'private-ready';
  if (input.serverUpdating) return 'updating';
  if (input.updateRequired) return 'update-required';
  if (input.sharedRestarting) return 'restarting';
  if (input.connectionState === 'restart-required') return 'restart-required';
  if (input.restoreError || input.privateRecoveryError) return 'shared-error';
  return null;
}
