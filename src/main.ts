import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APP_DIR,
  IPC_SOCKET,
  STATE_FILE,
  loadConfig,
  saveWorkflows,
  WorkflowSchema,
} from './config.js';
import { SlotManager } from './core/slotManager.js';
import type { AgentSession, AgentSlotSnapshot, HarnessAdapter } from './core/types.js';
import { CodexAdapter } from './harness/codex/adapter.js';
import {
  AppServerAdapter,
  WriterHeldError,
  type MonitoredThread,
} from './harness/codex-app-server/adapter.js';
import { DeckController } from './deck/controller.js';
import { serveIpc } from './ipc.js';
import { startAdminServer, type AdminServer } from './admin/server.js';
import { macNotificationArgs } from './notifications.js';

interface PersistedState {
  slots: {
    index: number;
    sessionId: string;
    cwd: string;
    label?: string;
    customLabel?: string;
  }[];
  selectedIndex: number;
}

function saveState(manager: SlotManager, defaultCwd: string): void {
  const state: PersistedState = {
    slots: manager
      .snapshots()
      .filter((s) => s.sessionId)
      .map((s) => ({
        index: s.index,
        sessionId: s.sessionId as string,
        cwd: s.cwd || defaultCwd,
        label: s.label !== String(s.index + 1) ? s.label : undefined,
        customLabel: s.customLabel ?? undefined,
      })),
    selectedIndex: manager.selectedIndex,
  };
  mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function loadState(): PersistedState | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as PersistedState;
  } catch {
    return null;
  }
}

/** Bind a thread to a slot: own it if possible, monitor it if the writer is elsewhere. */
async function bindThreadRecord(
  appServer: AppServerAdapter,
  manager: SlotManager,
  index: number,
  record: MonitoredThread,
): Promise<'owned' | 'monitor'> {
  try {
    const session: AgentSession = await appServer.resumeSession(record.id, {
      cwd: record.cwd ?? manager.snapshot(index).cwd,
    });
    manager.attachSession(index, session, record.name ?? undefined);
    return 'owned';
  } catch (e) {
    if (e instanceof WriterHeldError) {
      await attachMonitor(appServer, manager, index, record);
      return 'monitor';
    }
    throw e;
  }
}

async function attachMonitor(
  appServer: AppServerAdapter,
  manager: SlotManager,
  index: number,
  record: MonitoredThread,
): Promise<void> {
  const session = appServer.monitorSession(record);
  manager.attachSession(index, session, record.name ?? undefined);
}

/** macOS notification with the outcome of a finished turn. */
function notify(title: string, body: string): void {
  execFile(
    'osascript',
    macNotificationArgs(title, body),
    (err) => {
      if (err) console.error(new Date().toISOString(), 'notification failed:', String(err));
    },
  );
}

export async function runDaemon(explicitConfigPath?: string): Promise<void> {
  const { config, sourcePath } = loadConfig(explicitConfigPath);
  const adapter: HarnessAdapter =
    config.harness === 'codex-app-server'
      ? new AppServerAdapter({
          approvalPolicy: config.codex.approvalPolicy,
          sandbox: config.codex.sandboxMode,
          endpoint: config.appServer.url,
        })
      : new CodexAdapter({
          model: config.codex.model,
          sandboxMode: config.codex.sandboxMode,
          approvalPolicy: config.codex.approvalPolicy,
          modelReasoningEffort: config.codex.modelReasoningEffort,
        });
  const appServer = adapter instanceof AppServerAdapter ? adapter : null;
  const manager = new SlotManager(adapter, {
    slotCount: config.slots.count,
    defaultCwd: config.slots.cwd,
  });
  const deck = DeckController.open(config.workflows.map(({ id, name }) => ({ id, name })));

  // daemon-internal errors (failed sends etc.) are logged; failures also reach the key via turn-failed
  const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

  /** Notify when a slot transitions into done/error (turn finished). */
  const prevStates = new Map<number, string>();
  function maybeNotify(snapshot: AgentSlotSnapshot): void {
    const prev = prevStates.get(snapshot.index);
    prevStates.set(snapshot.index, snapshot.state);
    if (snapshot.state !== 'done' && snapshot.state !== 'error') return;
    if (prev === 'done' || prev === 'error') return;
    const title = `Slot ${snapshot.index + 1}: ${snapshot.label}`;
    if (snapshot.state === 'error') {
      notify(title, snapshot.detail || 'turn failed');
      return;
    }
    const message = snapshot.lastMessage?.replace(/\s+/g, ' ').trim();
    notify(title, message || 'turn completed');
  }

  manager.on('slot', (snapshot) => {
    deck.updateSlot(snapshot);
    maybeNotify(snapshot);
    saveState(manager, config.slots.cwd);
  });
  manager.on('select', (index) => {
    deck.updateSelection(index);
    saveState(manager, config.slots.cwd);
  });
  deck.on('action', (action) => {
    switch (action.kind) {
      case 'slot':
        // empty slots are inert: sessions are created elsewhere and pulled in via ATTACH
        if (manager.snapshot(action.index).state !== 'empty') manager.select(action.index);
        break;
      case 'stop':
        manager.interrupt();
        break;
      case 'select':
        manager.selectNext();
        break;
      case 'attach':
        void attachNewest().catch((e) => log('attach failed:', String(e)));
        break;
      case 'workflow': {
        const workflow = config.workflows.find((w) => w.id === action.id);
        if (!workflow) break;
        manager.sendSelected(workflow.prompt).catch((e) => log('workflow failed:', String(e)));
        break;
      }
    }
  });

  // restore persisted sessions; threads still open in another window fall back
  // to monitor-only bindings so they stay visible on the deck
  const persisted = loadState();
  if (persisted) {
    const restoredSessionIds = new Set<string>();
    for (const slot of persisted.slots) {
      if (slot.index >= config.slots.count) continue;
      if (restoredSessionIds.has(slot.sessionId)) {
        log(`slot ${slot.index + 1}: skipped duplicate session ${slot.sessionId}`);
        continue;
      }
      try {
        await manager.resumeSession(slot.index, slot.sessionId, slot.cwd, slot.label);
      } catch (e) {
        if (appServer && e instanceof WriterHeldError) {
          await attachMonitor(appServer, manager, slot.index, {
            id: slot.sessionId,
            name: slot.label ?? null,
            cwd: slot.cwd,
          });
          log(`slot ${slot.index + 1}: writer held elsewhere → monitor-only`);
        } else {
          log(`resume slot ${slot.index} failed:`, String(e));
          continue;
        }
      }
      restoredSessionIds.add(slot.sessionId);
      if (slot.customLabel) manager.rename(slot.index, slot.customLabel);
    }
    manager.select(Math.min(persisted.selectedIndex, config.slots.count - 1));
    saveState(manager, config.slots.cwd);
  }

  // fill remaining slots with the newest external sessions (desktop/VS Code/TUI)
  if (appServer && config.attachExternal) {
    try {
      const records = await appServer.listThreadRecords();
      const alreadyBound = new Set(manager.snapshots().map((s) => s.sessionId));
      for (const record of records) {
        if (manager.snapshots().every((s) => s.state !== 'empty')) break;
        if (record.ephemeral || alreadyBound.has(record.id)) continue;
        const index = manager.snapshots().find((s) => s.state === 'empty')?.index;
        if (index === undefined) break;
        await bindThreadRecord(appServer, manager, index, record);
      }
    } catch (e) {
      log('external attach failed:', String(e));
    }
  }

  deck.render(manager.snapshots(), manager.selectedIndex);
  try {
    await serveIpc(IPC_SOCKET, (cmd, args) => handleIpc(cmd, args));
  } catch (e) {
    // a stale socket file from an unclean shutdown; verify it's dead and reclaim it
    if (String(e).includes('EADDRINUSE')) {
      await import('./ipc.js').then(({ ipcCall }) =>
        ipcCall(IPC_SOCKET, 'status', {}, 1000).then(
          () => {
            throw new Error('another daemon is already running');
          },
          () => {
            unlinkSync(IPC_SOCKET);
          },
        ),
      );
      await serveIpc(IPC_SOCKET, (cmd, args) => handleIpc(cmd, args));
    } else {
      throw e;
    }
  }
  log(`daemon up — ${config.slots.count} slots, ${config.workflows.length} workflows, ipc at ${IPC_SOCKET}`);

  let adminServer: AdminServer | null = null;
  if (config.admin.enabled) {
    try {
      adminServer = await startAdminServer(config.admin.port, handleIpc);
      log(`Control Room at ${adminServer.url}`);
    } catch (e) {
      log(`admin panel disabled (${String(e)})`);
    }
  }

  /** Attach the newest (or a specific) unattached session; free slot unless slotIndex given. */
  async function attachNewest(
    wantedId?: string,
    slotIndex?: number,
  ): Promise<{ index: number; mode: string; name: string | null }> {
    if (!appServer) throw new Error('only supported with the codex-app-server harness');
    const records = await appServer.listThreadRecords();
    const record = wantedId
      ? records.find((r) => r.id === wantedId)
      : records.find((r) => !manager.snapshots().some((s) => s.sessionId === r.id));
    if (!record) throw new Error(wantedId ? `no such thread: ${wantedId}` : 'no unattached thread available');
    const index =
      slotIndex !== undefined
        ? slotIndex
        : (manager.snapshots().find((s) => s.state === 'empty')?.index ?? -1);
    if (index < 0 || index >= config.slots.count) throw new Error('no free slot');
    const existing = manager.snapshots().find((snapshot) => snapshot.sessionId === record.id);
    if (existing) {
      throw new Error(
        existing.index === index
          ? 'already attached to that slot'
          : `already attached to slot ${existing.index + 1}`,
      );
    }
    if (manager.snapshot(index).state !== 'empty') manager.clear(index);
    const mode = await bindThreadRecord(appServer, manager, index, record);
    return { index, mode, name: record.name ?? null };
  }

  async function handleIpc(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
      case 'status':
        return {
          selectedIndex: manager.selectedIndex,
          harness: adapter.name,
          slots: manager.snapshots(),
          workflows: config.workflows,
        };
      case 'send': {
        const text = String(args.text ?? '');
        if (!text) throw new Error('text required');
        // fire and forget: state arrives via slot events; don't hold the ipc for a whole turn
        manager.sendSelected(text).catch((e) => log('send failed:', String(e)));
        return { accepted: true };
      }
      case 'new': {
        const index = await manager.createSession(args.cwd ? String(args.cwd) : undefined);
        if (index < 0) throw new Error('no free slot');
        manager.select(index);
        return { index };
      }
      case 'select': {
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 0 || index >= config.slots.count) {
          throw new Error(`index must be 0..${config.slots.count - 1}`);
        }
        manager.select(index);
        return { selectedIndex: index };
      }
      case 'stop':
        manager.interrupt();
        return { stopped: true };
      case 'clear': {
        const index = args.index === undefined ? manager.selectedIndex : Number(args.index);
        manager.clear(index);
        return { cleared: index };
      }
      case 'rename': {
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 0 || index >= config.slots.count) {
          throw new Error(`index must be 0..${config.slots.count - 1}`);
        }
        if (manager.snapshot(index).state === 'empty') throw new Error('slot is empty');
        manager.rename(index, args.label === undefined || args.label === null ? null : String(args.label));
        saveState(manager, config.slots.cwd);
        return { renamed: index };
      }
      case 'workflow': {
        const workflow = config.workflows.find((w) => w.id === String(args.id));
        if (!workflow) throw new Error(`unknown workflow: ${String(args.id)}`);
        manager.sendSelected(workflow.prompt).catch((e) => log('workflow failed:', String(e)));
        return { accepted: true };
      }
      case 'sessions': {
        if (!appServer) throw new Error('only supported with the codex-app-server harness');
        return appServer.listSessions();
      }
      case 'attach': {
        return attachNewest(
          args.id === undefined ? undefined : String(args.id),
          args.slotIndex === undefined ? undefined : Number(args.slotIndex),
        );
      }
      case 'workflows.get': {
        return { active: config.workflows, library: config.workflowsLibrary };
      }
      case 'workflows.set': {
        const active = WorkflowSchema.array().max(6).parse(args.workflows);
        const library = WorkflowSchema.array().parse(args.workflowsLibrary ?? []);
        const ids = new Set([...active, ...library].map((w) => w.id));
        if (ids.size !== active.length + library.length) {
          throw new Error('workflow ids must be unique');
        }
        const path = saveWorkflows(sourcePath, active, library);
        config.workflows = active;
        config.workflowsLibrary = library;
        deck.setWorkflows(active.map(({ id, name }) => ({ id, name })));
        log(`workflows saved to ${path}`);
        return { saved: active.length, path };
      }
      default:
        throw new Error(`unknown cmd: ${cmd}`);
    }
  }

  const shutdown = () => {
    saveState(manager, config.slots.cwd);
    deck.close();
    if (existsSync(IPC_SOCKET)) unlinkSync(IPC_SOCKET);
    void adminServer?.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun =
  process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isDirectRun) {
  runDaemon(process.argv[2]).catch((e) => {
    console.error('fatal:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
