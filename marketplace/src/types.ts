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
    desktopRecovery: 'restart-required' | 'restarting' | null;
  };
}
