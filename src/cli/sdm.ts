#!/usr/bin/env node
/** sdm — companion CLI for the stream-deck-micro daemon (free-text input, status, control). */
import { IPC_SOCKET } from '../config.js';
import { ipcCall } from '../ipc.js';

interface SlotView {
  index: number;
  state: string;
  sessionId: string | null;
  label: string;
  cwd: string;
  detail: string;
}

const USAGE = `sdm — control stream-deck-micro from the terminal

usage:
  sdm status                 show slots, states and workflows
  sdm send <text...>         send a prompt to the selected slot
  sdm new [cwd]              create a session in the first free slot
  sdm select <1-6>           select a slot
  sdm stop                   interrupt the selected slot
  sdm sleep                  put the physical deck to sleep
  sdm wake                   wake and repaint the physical deck
  sdm clear [1-6]            clear a slot (default: selected)
  sdm rename <1-6> <label|-> set or clear a custom slot label
  sdm workflow <id>          run a workflow on the selected slot
  sdm sessions               list codex sessions (app-server harness)
  sdm attach [id]            attach newest (or given) session to a free slot
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'status': {
        const status = await ipcCall<{
          selectedIndex: number;
          slots: SlotView[];
          workflows: { id: string; name: string }[];
          deck: {
            mode: string;
            attention: unknown[];
            settings: { autoSleep: { enabled: boolean; timeoutMinutes: number } };
          };
        }>(IPC_SOCKET, 'status');
        console.log(`selected: ${status.selectedIndex}`);
        for (const s of status.slots) {
          const marker = s.index === status.selectedIndex ? '>' : ' ';
          const id = s.sessionId ? s.sessionId.slice(0, 8) : '--------';
          console.log(
            `${marker} ${s.index + 1} [${s.state.padEnd(7)}] ${id} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`,
          );
        }
        const auto = status.deck.settings.autoSleep;
        console.log(
          `deck: ${status.deck.mode} · auto sleep ${auto.enabled ? `${auto.timeoutMinutes}m` : 'off'}`
          + (status.deck.attention.length ? ` · ${status.deck.attention.length} attention` : ''),
        );
        console.log(`workflows: ${status.workflows.map((w) => w.id).join(', ')}`);
        return;
      }
      case 'send': {
        const text = rest.join(' ').trim();
        if (!text) throw new Error('no text given');
        await ipcCall(IPC_SOCKET, 'send', { text });
        console.log('sent.');
        return;
      }
      case 'new': {
        const { index } = await ipcCall<{ index: number }>(IPC_SOCKET, 'new', {
          cwd: rest[0],
        });
        console.log(`new session in slot ${index + 1}.`);
        return;
      }
      case 'select': {
        const { selectedIndex } = await ipcCall<{ selectedIndex: number }>(IPC_SOCKET, 'select', {
          index: Number(rest[0]) - 1,
        });
        console.log(`selected slot ${selectedIndex + 1}.`);
        return;
      }
      case 'stop':
        await ipcCall(IPC_SOCKET, 'stop');
        console.log('interrupt sent.');
        return;
      case 'sleep':
        await ipcCall(IPC_SOCKET, 'deck.sleep');
        console.log('deck asleep. press any physical key once to wake.');
        return;
      case 'wake':
        await ipcCall(IPC_SOCKET, 'deck.wake');
        console.log('deck awake.');
        return;
      case 'clear': {
        const { cleared } = await ipcCall<{ cleared: number }>(IPC_SOCKET, 'clear', {
          index: rest[0] === undefined ? undefined : Number(rest[0]) - 1,
        });
        console.log(`cleared slot ${cleared + 1}.`);
        return;
      }
      case 'workflow': {
        if (!rest[0]) {
          const status = await ipcCall<{ workflows: { id: string }[] }>(IPC_SOCKET, 'status');
          throw new Error(`workflow id required. available: ${status.workflows.map((w) => w.id).join(', ')}`);
        }
        await ipcCall(IPC_SOCKET, 'workflow', { id: rest[0] });
        console.log('workflow dispatched.');
        return;
      }
      case 'rename': {
        if (rest.length < 2) throw new Error('usage: sdm rename <1-6> <label | ->');
        const label = rest.slice(1).join(' ') === '-' ? null : rest.slice(1).join(' ');
        await ipcCall(IPC_SOCKET, 'rename', { index: Number(rest[0]) - 1, label });
        console.log(label ? `renamed to "${label}".` : 'custom label cleared.');
        return;
      }
      case 'sessions': {
        const sessions = await ipcCall<{ id: string; name?: string; updatedAt?: string }[]>(
          IPC_SOCKET,
          'sessions',
        );
        for (const s of sessions) {
          console.log(`${s.id.slice(0, 8)}  ${s.updatedAt ?? '??'}  ${s.name ?? ''}`);
        }
        return;
      }
      case 'attach': {
        const result = await ipcCall<{ index: number; mode: string; name: string | null }>(
          IPC_SOCKET,
          'attach',
          { id: rest[0] },
        );
        console.log(
          `attached "${result.name ?? result.index + 1}" to slot ${result.index + 1} (${result.mode === 'monitor' ? 'monitor-only, writer is elsewhere' : 'owned'}).`,
        );
        return;
      }
      default:
        process.stdout.write(USAGE);
        process.exitCode = cmd ? 1 : 0;
    }
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  }
}

void main();
