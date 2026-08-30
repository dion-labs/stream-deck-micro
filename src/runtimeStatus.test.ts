import { describe, expect, it } from 'vitest';
import { deriveRuntimeStatus } from './runtimeStatus.js';

const base = {
  now: 10_000,
  surface: 'marketplace' as const,
  desktopState: 'connected' as const,
  desktopMessage: 'connected',
  sessionsReady: true,
  transportClosed: false,
  assignedBindings: 8,
  pluginHeartbeat: {
    lastSeenAt: 9_900,
    pluginVersion: '0.1.0.5',
    streamDeckVersion: '7.1.0',
    connectedDevices: 1,
    visibleKeys: 15,
  },
};

describe('runtime capability and health model', () => {
  it('reports full live control only after shared sessions hydrate', () => {
    const result = deriveRuntimeStatus(base);
    expect(result.capabilities.mode).toBe('live');
    expect(result.capabilities.canControlSessions).toBe(true);
    expect(result.health.overall).toBe('ready');
  });

  it('labels detached bindings as navigation-only instead of idle/live', () => {
    const result = deriveRuntimeStatus({
      ...base,
      desktopState: 'unavailable',
      desktopMessage: 'Shared control is not installed.',
      sessionsReady: false,
    });
    expect(result.capabilities.mode).toBe('navigation-only');
    expect(result.capabilities.canNavigateSessions).toBe(true);
    expect(result.capabilities.canControlSessions).toBe(false);
    expect(result.health.components.bindings.state).toBe('navigation-only');
    expect(result.health.overall).toBe('degraded');
  });

  it('surfaces a stale Marketplace plugin heartbeat', () => {
    const result = deriveRuntimeStatus({
      ...base,
      pluginHeartbeat: { ...base.pluginHeartbeat, lastSeenAt: 1_000 },
    });
    expect(result.health.components.plugin.state).toBe('offline');
    expect(result.health.components.surface.state).toBe('action-required');
    expect(result.health.overall).toBe('action-required');
  });
});
