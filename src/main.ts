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
import type { AgentSession, AgentSlotSnapshot } from './core/types.js';
import { openCodexThread } from './codexDesktop.js';
import {
  AppServerAdapter,
  WriterHeldError,
  type MonitoredThread,
} from './harness/codex-app-server/adapter.js';
import {
  CodexUnreadAttentionSync,
  CodexUnreadMonitor,
} from './harness/codex-app-server/unread.js';
import { DeckController, type AttentionState } from './deck/controller.js';
import { VirtualDeckDriver } from './deck/virtualDriver.js';
import { serveIpc } from './ipc.js';
import { startAdminServer, type AdminServer } from './admin/server.js';
import { macNotificationArgs } from './notifications.js';
import {
  desktopConnectionStatus,
  restartCodexDesktop,
  type DesktopConnectionStatus,
} from './sharedServer.js';

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
  const adapter = new AppServerAdapter({
    approvalPolicy: config.codex.approvalPolicy,
    sandbox: config.codex.sandboxMode,
    endpoint: config.appServer.url,
  });
  const appServer = adapter;
  const manager = new SlotManager(adapter, {
    slotCount: config.slots.count,
    defaultCwd: config.slots.cwd,
  });
  const workflows = config.workflows.map(({ id, name }) => ({ id, name }));
  const virtualDeck = surfaceMode === 'marketplace' ? new VirtualDeckDriver() : null;
  const deck = virtualDeck
    ? new DeckController(virtualDeck, workflows, config.deck, config.layout)
    : DeckController.open(workflows, config.deck, config.layout);

  const assignedSlotIndexes = (): number[] => [...new Set(
    deck.status().layout
      .filter((entry): entry is typeof entry & { action: { kind: 'slot'; index: number } } =>
        entry.action.kind === 'slot')
      .map((entry) => entry.action.index),
  )].sort((a, b) => a - b);

  // daemon-internal errors (failed sends etc.) are logged; failures also reach the key via turn-failed
  const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);
  const persisted = loadState();
  const sharedEndpoint = config.appServer.url;
  let desktopConnection: DesktopConnectionStatus = sharedEndpoint
    ? desktopConnectionStatus(sharedEndpoint)
    : {
        state: 'not-required',
        endpoint: null,
        message: 'This daemon owns its private Codex App Server.',
      };
  let stateHydrated = false;
  let restorePromise: Promise<void> | null = null;
  let restoreError: string | null = null;
  let desktopRestartPromise: Promise<void> | null = null;
  const unreadAttentionSync = new CodexUnreadAttentionSync();
  const unreadMonitor = sharedEndpoint ? new CodexUnreadMonitor() : null;

  const persistState = () => {
    // Do not replace saved bindings with an empty startup snapshot while
    // Desktop is still joining the shared server.
    if (stateHydrated) saveState(manager, config.slots.cwd, deck);
  };

  function assertDesktopReady(): void {
    if (!sharedEndpoint) return;
    if (desktopConnection.state !== 'connected') throw new Error(desktopConnection.message);
    if (!stateHydrated) throw new Error('Shared control is connected; session bindings are still restoring.');
  }

  function openSlotInCodex(index: number): { selectedIndex: number; sessionId: string } {
    const snapshot = manager.snapshot(index);
    if (snapshot.state === 'empty' || !snapshot.sessionId) {
      throw new Error(`slot ${index + 1} is empty`);
    }
    manager.select(index);
    deck.acknowledge(index);
    void openCodexThread(snapshot.sessionId).catch((error) => {
      log(`slot ${index + 1}: could not open Codex Desktop:`, String(error));
    });
    return { selectedIndex: index, sessionId: snapshot.sessionId };
  }

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
    persistState();
  });
  manager.on('select', (index) => {
    deck.updateSelection(index);
    persistState();
  });
  deck.on('attention', () => {
    unreadAttentionSync.track(deck.status().attention);
    persistState();
  });
  deck.on('mode', (mode) => log(`deck mode → ${mode}`));
  deck.on('restartCodex', () => {
    void beginDesktopRestart().catch(() => {
      // The detailed failure is logged and the recovery key is restored.
    });
  });
  deck.on('action', (action) => {
    switch (action.kind) {
      case 'slot':
        // empty slots are inert: sessions are created elsewhere and pulled in via ATTACH
        if (manager.snapshot(action.index).state !== 'empty') openSlotInCodex(action.index);
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
        try {
          assertDesktopReady();
        } catch (error) {
          log('workflow blocked:', error instanceof Error ? error.message : String(error));
          break;
        }
        manager.sendSelected(workflow.prompt).catch((e) => log('workflow failed:', String(e)));
        break;
      }
    }
  });

  async function hydrateSessions(): Promise<void> {
    // Calling thread/resume before Desktop joins this exact App Server can take
    // every persisted writer lock and leave Desktop read-only.
    if (persisted) {
      const configuredSlots = new Set(assignedSlotIndexes());
      const currentRecords = await appServer
        .listThreadRecords()
        .catch(() => [] as MonitoredThread[]);
      const currentRecordsById = new Map(currentRecords.map((record) => [record.id, record]));
      const restoredSessionIds = new Set<string>();
      for (const slot of persisted.slots) {
        if (slot.index >= config.slots.count || !configuredSlots.has(slot.index)) continue;
        if (restoredSessionIds.has(slot.sessionId)) {
          log(`slot ${slot.index + 1}: skipped duplicate session ${slot.sessionId}`);
          continue;
        }
        const currentRecord = currentRecordsById.get(slot.sessionId);
        const currentLabel = currentRecord?.name ?? slot.label;
        try {
          await manager.resumeSession(slot.index, slot.sessionId, slot.cwd, currentLabel ?? undefined);
        } catch (e) {
          if (e instanceof WriterHeldError) {
            await attachMonitor(appServer, manager, slot.index, {
              ...currentRecord,
              id: slot.sessionId,
              name: currentLabel ?? null,
              cwd: currentRecord?.cwd ?? slot.cwd,
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
      const restoredSelection = configuredSlots.has(persisted.selectedIndex)
        ? persisted.selectedIndex
        : assignedSlotIndexes()[0];
      if (restoredSelection !== undefined) manager.select(restoredSelection);
    }

    // Fill remaining visible slots with the newest external sessions.
    if (config.attachExternal) {
      try {
        const records = await appServer.listThreadRecords();
        const alreadyBound = new Set(manager.snapshots().map((s) => s.sessionId));
        const visibleSlots = assignedSlotIndexes();
        for (const record of records) {
          if (visibleSlots.every((index) => manager.snapshot(index).state !== 'empty')) break;
          if (record.ephemeral || alreadyBound.has(record.id)) continue;
          const index = visibleSlots.find((slotIndex) => manager.snapshot(slotIndex).state === 'empty');
          if (index === undefined) break;
          await bindThreadRecord(appServer, manager, index, record);
        }
      } catch (e) {
        log('external attach failed:', String(e));
      }
    }

    stateHydrated = true;
    restoreError = null;
    if (persisted?.attention?.length) deck.restoreAttention(persisted.attention);
    deck.render(manager.snapshots(), manager.selectedIndex);
    persistState();
    log('session bindings ready');
  }

  function ensureSessionsHydrated(): Promise<void> {
    if (stateHydrated) return Promise.resolve();
    if (restorePromise) return restorePromise;
    restorePromise = hydrateSessions().catch((error) => {
      restoreError = error instanceof Error ? error.message : String(error);
      restorePromise = null;
      log('session restore failed:', restoreError);
      throw error;
    });
    return restorePromise;
  }

  async function refreshDesktopConnection(): Promise<void> {
    if (!sharedEndpoint) {
      await ensureSessionsHydrated();
      return;
    }
    const next = desktopConnectionStatus(sharedEndpoint);
    if (next.state !== desktopConnection.state) {
      log(`desktop shared control → ${next.state}`);
    }
    desktopConnection = next;
    if (next.state === 'connected') await ensureSessionsHydrated();
    syncDesktopRecoverySurface();
  }

  function syncDesktopRecoverySurface(): void {
    deck.setDesktopRecovery(
      desktopRestartPromise
        ? 'restarting'
        : desktopConnection.state === 'restart-required'
          ? 'restart-required'
          : null,
    );
  }

  function beginDesktopRestart(): Promise<void> {
    if (desktopRestartPromise) return desktopRestartPromise;
    if (!sharedEndpoint || desktopConnection.state !== 'restart-required') {
      return Promise.reject(new Error('Codex Desktop does not currently require a shared-mode restart'));
    }
    desktopRestartPromise = (async () => {
      syncDesktopRecoverySurface();
      log('Codex Desktop restart requested from the deck');
      await restartCodexDesktop();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await refreshDesktopConnection();
        if (desktopConnection.state === 'connected' && stateHydrated) {
          log('Codex Desktop reconnected; session buttons restored');
          return;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      }
      throw new Error('Codex Desktop reopened but did not join the shared server');
    })().catch((error) => {
      log('Codex Desktop restart failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }).finally(() => {
      desktopRestartPromise = null;
      desktopConnection = sharedEndpoint
        ? desktopConnectionStatus(sharedEndpoint)
        : desktopConnection;
      syncDesktopRecoverySurface();
    });
    syncDesktopRecoverySurface();
    return desktopRestartPromise;
  }

  syncDesktopRecoverySurface();
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

  await refreshDesktopConnection().catch(() => {
    // The detailed restore/routing failure is already logged and exposed in status.
  });
  const desktopPoll = sharedEndpoint
    ? setInterval(() => {
        void refreshDesktopConnection().catch(() => {});
      }, 1500)
    : null;
  desktopPoll?.unref();

  unreadMonitor?.start((unreadThreadIds) => {
    if (!stateHydrated || desktopConnection.state !== 'connected') return;
    const attention = deck.status().attention;
    for (const index of unreadAttentionSync.acknowledgeable(attention, unreadThreadIds)) {
      const sessionId = manager.snapshot(index).sessionId;
      if (deck.acknowledge(index, false)) {
        log(`slot ${index + 1}: attention acknowledged in Codex Desktop (${sessionId})`);
      }
    }
  });

  /** Attach the newest (or a specific) unattached session; free slot unless slotIndex given. */
  async function attachNewest(
    wantedId?: string,
    slotIndex?: number,
  ): Promise<{ index: number; mode: string; name: string | null }> {
    assertDesktopReady();
    const records = await appServer.listThreadRecords();
    const record = wantedId
      ? records.find((r) => r.id === wantedId)
      : records.find((r) => !manager.snapshots().some((s) => s.sessionId === r.id));
    if (!record) throw new Error(wantedId ? `no such thread: ${wantedId}` : 'no unattached thread available');
    const index =
      slotIndex !== undefined
        ? slotIndex
        : (assignedSlotIndexes().find((candidate) => manager.snapshot(candidate).state === 'empty') ?? -1);
    if (index < 0 || index >= config.slots.count) throw new Error('no free session button');
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
    manager.confirmAttachment(index);
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
          desktop: {
            ...desktopConnection,
            sessionsReady: stateHydrated,
            restoreError,
          },
        };
      case 'send': {
        assertDesktopReady();
        const text = String(args.text ?? '');
        if (!text) throw new Error('text required');
        // fire and forget: state arrives via slot events; don't hold the ipc for a whole turn
        manager.sendSelected(text).catch((e) => log('send failed:', String(e)));
        return { accepted: true };
      }
      case 'new': {
        assertDesktopReady();
        const target = assignedSlotIndexes().find((index) => manager.snapshot(index).state === 'empty');
        if (target === undefined) throw new Error('no free session button');
        const index = await manager.createSession(args.cwd ? String(args.cwd) : undefined, target);
        if (index < 0) throw new Error('no free session button');
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
      case 'desktop.open': {
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 0 || index >= config.slots.count) {
          throw new Error(`index must be 0..${config.slots.count - 1}`);
        }
        return openSlotInCodex(index);
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
        persistState();
        return { renamed: index };
      }
      case 'slots.swap': {
        const firstIndex = Number(args.firstIndex);
        const secondIndex = Number(args.secondIndex);
        for (const index of [firstIndex, secondIndex]) {
          if (!Number.isInteger(index) || index < 0 || index >= config.slots.count) {
            throw new Error(`index must be 0..${config.slots.count - 1}`);
          }
        }
        const attention = deck.status().attention
          .filter((entry): entry is typeof entry & { sessionId: string } => Boolean(entry.sessionId))
          .map(({ sessionId, state }) => ({ sessionId, state }));
        manager.swapBindings(firstIndex, secondIndex);
        deck.restoreAttention(attention);
        persistState();
        return { firstIndex, secondIndex, selectedIndex: manager.selectedIndex };
      }
      case 'workflow': {
        assertDesktopReady();
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
        const outOfRangeSlot = layout.find(({ action }) =>
          action.kind === 'slot' && action.index >= config.slots.count);
        if (outOfRangeSlot?.action.kind === 'slot') {
          throw new Error(`session slot ${outOfRangeSlot.action.index + 1} exceeds configured capacity ${config.slots.count}`);
        }
        const workflowIds = new Set(config.workflows.map((workflow) => workflow.id));
        const unknownWorkflow = layout.find(({ action }) =>
          action.kind === 'workflow' && !workflowIds.has(action.id));
        if (unknownWorkflow?.action.kind === 'workflow') {
          throw new Error(`unknown workflow: ${unknownWorkflow.action.id}`);
        }
        const previousSlots = new Set(assignedSlotIndexes());
        const nextSlots = new Set(layout
          .filter((entry): entry is typeof entry & { action: { kind: 'slot'; index: number } } =>
            entry.action.kind === 'slot')
          .map((entry) => entry.action.index));
        const path = saveDeckLayout(sourcePath, layout);
        config.layout = layout;
        deck.setLayout(layout);
        for (const index of previousSlots) {
          if (!nextSlots.has(index) && manager.snapshot(index).state !== 'empty') {
            deck.acknowledge(index, false);
            manager.clear(index);
          }
        }
        if (!nextSlots.has(manager.selectedIndex)) {
          const nextSelection = [...nextSlots].find((index) => manager.snapshot(index).state !== 'empty')
            ?? [...nextSlots][0];
          if (nextSelection !== undefined) manager.select(nextSelection);
        }
        log(`deck layout saved to ${path}`);
        return { ...deck.status(), path };
      }
      case 'deck.sleep':
        deck.sleep();
        return deck.status();
      case 'deck.wake':
        deck.wake();
        return deck.status();
      case 'desktop.restart':
        void beginDesktopRestart().catch(() => {});
        return { accepted: true };
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
    if (desktopPoll) clearInterval(desktopPoll);
    unreadMonitor?.close();
    persistState();
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
