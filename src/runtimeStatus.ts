import type { DesktopConnectionState } from './sharedServer.js';

export type CapabilityMode = 'live' | 'navigation-only' | 'offline';
export type HealthState = 'ready' | 'navigation-only' | 'action-required' | 'offline' | 'not-required';

export interface RuntimeCapabilities {
  mode: CapabilityMode;
  label: string;
  reason: string;
  canNavigateSessions: boolean;
  canConfigure: boolean;
  canControlSessions: boolean;
  canListSessions: boolean;
}

export interface HealthComponent {
  state: HealthState;
  message: string;
  lastSeenAt?: number;
  version?: string;
}

export interface MarketplacePluginHeartbeat {
  lastSeenAt: number;
  pluginVersion: string;
  streamDeckVersion: string;
  connectedDevices: number;
  visibleKeys: number;
}

export interface RuntimeHealth {
  overall: 'ready' | 'degraded' | 'action-required';
  components: {
    bridge: HealthComponent;
    surface: HealthComponent;
    plugin: HealthComponent;
    codexDesktop: HealthComponent;
    sharedControl: HealthComponent;
    bindings: HealthComponent;
  };
}

export interface RuntimeStatusInput {
  now: number;
  surface: 'independent' | 'marketplace';
  desktopState: DesktopConnectionState;
  desktopMessage: string;
  sessionsReady: boolean;
  transportClosed: boolean;
  assignedBindings: number;
  pluginHeartbeat: MarketplacePluginHeartbeat | null;
}

const HEARTBEAT_STALE_MS = 3_000;

export function deriveRuntimeStatus(input: RuntimeStatusInput): {
  capabilities: RuntimeCapabilities;
  health: RuntimeHealth;
} {
  const live = input.desktopState === 'connected'
    && input.sessionsReady
    && !input.transportClosed;
  const navigationOnly = !live && input.assignedBindings > 0;
  const mode: CapabilityMode = live ? 'live' : navigationOnly ? 'navigation-only' : 'offline';
  const capabilities: RuntimeCapabilities = {
    mode,
    label: live ? 'Live control' : navigationOnly ? 'Navigation only' : 'Offline',
    reason: live
      ? 'Codex Desktop and Stream Deck Micro are sharing live sessions.'
      : navigationOnly
        ? 'Saved task buttons can open Codex, but prompts, workflows, stop, live state, and attention sync are unavailable.'
        : 'No usable live sessions or saved navigation bindings are available.',
    canNavigateSessions: input.assignedBindings > 0,
    canConfigure: true,
    canControlSessions: live,
    canListSessions: live,
  };

  const heartbeat = input.pluginHeartbeat;
  const heartbeatFresh = Boolean(heartbeat && input.now - heartbeat.lastSeenAt <= HEARTBEAT_STALE_MS);
  const bridge: HealthComponent = { state: 'ready', message: 'Local Micro bridge is responding.' };
  let surface: HealthComponent;
  let plugin: HealthComponent;
  if (input.surface === 'independent') {
    surface = { state: 'ready', message: 'Micro owns the physical Stream Deck directly.' };
    plugin = { state: 'not-required', message: 'Marketplace plugin is not used in Independent mode.' };
  } else if (!heartbeatFresh) {
    surface = { state: 'action-required', message: 'Waiting for the Elgato plugin heartbeat.' };
    plugin = heartbeat
      ? {
          state: 'offline',
          message: 'The Elgato plugin heartbeat is stale.',
          lastSeenAt: heartbeat.lastSeenAt,
          version: heartbeat.pluginVersion,
        }
      : { state: 'offline', message: 'The Elgato plugin has not contacted the bridge.' };
  } else {
    plugin = {
      state: 'ready',
      message: `Plugin connected through Stream Deck ${heartbeat!.streamDeckVersion}.`,
      lastSeenAt: heartbeat!.lastSeenAt,
      version: heartbeat!.pluginVersion,
    };
    surface = heartbeat!.connectedDevices > 0
      ? {
          state: heartbeat!.visibleKeys >= 15 ? 'ready' : 'action-required',
          message: heartbeat!.visibleKeys >= 15
            ? `${heartbeat!.connectedDevices} Stream Deck device connected with all 15 Micro keys visible.`
            : `${heartbeat!.connectedDevices} device connected, but only ${heartbeat!.visibleKeys}/15 Micro keys are visible.`,
          lastSeenAt: heartbeat!.lastSeenAt,
        }
      : {
          state: 'action-required',
          message: 'The plugin is running, but no Stream Deck device is connected.',
          lastSeenAt: heartbeat!.lastSeenAt,
        };
  }

  const codexDesktop: HealthComponent = input.desktopState === 'connected'
    ? { state: 'ready', message: 'Codex Desktop is connected to shared control.' }
    : input.desktopState === 'unavailable' && navigationOnly
      ? { state: 'navigation-only', message: 'Codex remains private; saved buttons can still open its tasks.' }
      : input.desktopState === 'waiting'
        ? { state: 'offline', message: input.desktopMessage }
        : { state: 'action-required', message: input.desktopMessage };
  const sharedControl: HealthComponent = live
    ? { state: 'ready', message: 'Live prompts, workflows, stop, state, focus, and attention sync are available.' }
    : navigationOnly
      ? { state: 'navigation-only', message: capabilities.reason }
      : { state: 'action-required', message: input.desktopMessage };
  const bindings: HealthComponent = input.assignedBindings > 0
    ? {
        state: live ? 'ready' : 'navigation-only',
        message: `${input.assignedBindings} saved session binding${input.assignedBindings === 1 ? '' : 's'} loaded.`,
      }
    : { state: 'action-required', message: 'No saved session bindings are available.' };

  const components = { bridge, surface, plugin, codexDesktop, sharedControl, bindings };
  const states = Object.values(components).map((component) => component.state);
  const overall = states.includes('offline') || (states.includes('action-required') && !navigationOnly)
    ? 'action-required'
    : states.includes('navigation-only') || states.includes('action-required')
      ? 'degraded'
      : 'ready';
  return { capabilities, health: { overall, components } };
}
