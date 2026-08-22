import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APP_DIR,
  IPC_SOCKET,
  STATE_FILE,
  DeckSettingsSchema,
  DeckLayoutSchema,
  loadConfig,
  saveDeckSettings,
  saveDeckLayout,
  saveWorkflows,
  WorkflowSchema,
  type SurfaceMode,
} from './config.js';
import { SlotManager } from './core/slotManager.js';
import type { AgentSession, AgentSlotSnapshot, HarnessAdapter } from './core/types.js';
import { CodexAdapter } from './harness/codex/adapter.js';
import {
  AppServerAdapter,
  WriterHeldError,
  type MonitoredThread,
} from './harness/codex-app-server/adapter.js';
import { DeckController, type AttentionState } from './deck/controller.js';
import { VirtualDeckDriver } from './deck/virtualDriver.js';
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
  attention?: {
    sessionId: string;
    state: AttentionState;
  }[];
}

function saveState(manager: SlotManager, defaultCwd: string, deck: DeckController): void {
  const attention = deck.status().attention
    .filter((entry): entry is typeof entry & { sessionId: string } => Boolean(entry.sessionId))
    .map(({ sessionId, state }) => ({ sessionId, state }));
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
    attention,
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

export interface RunDaemonOptions {
  surfaceMode?: SurfaceMode;
}

export async function runDaemon(
  explicitConfigPath?: string,
  options: RunDaemonOptions = {},
): Promise<void> {
  const { config, sourcePath } = loadConfig(explicitConfigPath);
  const surfaceMode = options.surfaceMode ?? config.surface.mode;
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
  const workflows = config.workflows.map(({ id, name }) => ({ id, name }));
  const virtualDeck = surfaceMode === 'marketplace' ? new VirtualDeckDriver() : null;
  const deck = virtualDeck
    ? new DeckController(virtualDeck, workflows, config.deck, config.layout)
    : DeckController.open(workflows, config.deck, config.layout);

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
    saveState(manager, config.slots.cwd, deck);
  });
  manager.on('select', (index) => {
    deck.updateSelection(index);
    saveState(manager, config.slots.cwd, deck);
  });
  deck.on('attention', () => saveState(manager, config.slots.cwd, deck));
  deck.on('mode', (mode) => log(`deck mode → ${mode}`));
  deck.on('action', (action) => {
    switch (action.kind) {
      case 'slot':
        // empty slots are inert: sessions are created elsewhere and pulled in via ATTACH
        if (manager.snapshot(action.index).state !== 'empty') manager.select(action.index);
        break;
      case 'stop':
        manager.interrupt();
        break;
      case 'sleep':
        if (config.deck.sleepKey === 'sleep') {
          deck.sleep();
        } else {
          config.deck.autoSleep.enabled = !config.deck.autoSleep.enabled;
          const path = saveDeckSettings(sourcePath, config.deck);
          deck.setSettings(config.deck);
          log(`auto sleep ${config.deck.autoSleep.enabled ? 'enabled' : 'disabled'} — saved to ${path}`);
        }
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
    saveState(manager, config.slots.cwd, deck);
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
  if (persisted?.attention?.length) deck.restoreAttention(persisted.attention);
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
  log(
    `daemon up — ${surfaceMode} surface, ${config.slots.count} slots, `
    + `${config.workflows.length} workflows, ipc at ${IPC_SOCKET}`,
  );

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
          surface: surfaceMode,
          slots: manager.snapshots(),
          workflows: config.workflows,
          deck: deck.status(),
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
        deck.acknowledge(index);
        return { selectedIndex: index };
      }
      case 'stop':
        manager.interrupt();
        return { stopped: true };
      case 'clear': {
        const index = args.index === undefined ? manager.selectedIndex : Number(args.index);
        deck.acknowledge(index, false);
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
        saveState(manager, config.slots.cwd, deck);
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
      case 'deck.settings.get':
        return deck.status();
      case 'deck.settings.set': {
        const settings = DeckSettingsSchema.parse(args);
        const path = saveDeckSettings(sourcePath, settings);
        config.deck = settings;
        deck.setSettings(settings);
        log(`deck settings saved to ${path}`);
        return { ...deck.status(), path };
      }
      case 'deck.layout.set': {
        const layout = DeckLayoutSchema.parse(args.layout);
        const workflowIds = new Set(config.workflows.map((workflow) => workflow.id));
        const unknownWorkflow = layout.find(({ action }) =>
          action.kind === 'workflow' && !workflowIds.has(action.id));
        if (unknownWorkflow?.action.kind === 'workflow') {
          throw new Error(`unknown workflow: ${unknownWorkflow.action.id}`);
        }
        const path = saveDeckLayout(sourcePath, layout);
        config.layout = layout;
        deck.setLayout(layout);
        log(`deck layout saved to ${path}`);
        return { ...deck.status(), path };
      }
      case 'deck.sleep':
        deck.sleep();
        return deck.status();
      case 'deck.wake':
        deck.wake();
        return deck.status();
      case 'deck.key': {
        if (!virtualDeck) throw new Error('deck.key is only available in marketplace surface mode');
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 0 || index >= virtualDeck.NUM_KEYS) {
          throw new Error(`index must be 0..${virtualDeck.NUM_KEYS - 1}`);
        }
        virtualDeck.press(index);
        return deck.status();
      }
      default:
        throw new Error(`unknown cmd: ${cmd}`);
    }
  }

  const shutdown = () => {
    saveState(manager, config.slots.cwd, deck);
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
