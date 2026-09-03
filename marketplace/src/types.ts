export type AgentState = 'empty' | 'idle' | 'thinking' | 'running' | 'done' | 'error';

export type SurfaceAction =
  | { kind: 'slot'; index: number }
  | { kind: 'stop' }
  | { kind: 'sleep' }
  | { kind: 'attach' }
  | { kind: 'workflow'; id: string };

export interface SlotStatus {
  index: number;
  state: AgentState;
  sessionId: string | null;
  label: string;
  detail: string;
}

export interface DaemonStatus {
  selectedIndex: number;
  surface: 'independent' | 'marketplace';
  capabilities?: {
    mode: 'live' | 'navigation-only' | 'offline';
    label: string;
    reason: string;
    canNavigateSessions: boolean;
    canConfigure: boolean;
    canControlSessions: boolean;
    canListSessions: boolean;
  };
  slots: SlotStatus[];
  workflows: { id: string; name: string; prompt: string }[];
  deck: {
    mode: 'awake' | 'attention' | 'asleep';
    settings: {
      autoSleep: { enabled: boolean; timeoutMinutes: number };
      sleepKey: 'sleep' | 'toggle-auto';
    };
    layout: { keyIndex: number; action: SurfaceAction }[];
    attention: { index: number; state: 'done' | 'error'; sessionId: string | null }[];
    desktopRecovery: 'restart-required' | 'restarting' | 'verification-required' | 'verifying'
      | 'update-required' | 'updating'
      | 'shared-error' | 'recovering-private' | 'private-ready' | null;
    capabilityMode?: 'live' | 'navigation-only' | 'offline';
    actionFeedback?: {
      keyIndex: number;
      outcome: 'blocked' | 'failed';
      message: string;
      expiresAt: number;
    } | null;
  };
}

export interface PluginHeartbeat {
  pluginVersion: string;
  streamDeckVersion: string;
  connectedDevices: number;
  visibleKeys: number;
}
