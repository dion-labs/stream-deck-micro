# Shared App Server hardening

## Incident and decision (2026-08-26)

Desktop new/resumed sessions failed with `invalid transport` under
`mcp_servers.codex_app`. Micro previously launched a bare bundled App Server
and globally set `CODEX_APP_SERVER_WS_URL` through launchd. Desktop's normal
startup supplies additional MCP configuration; its per-thread tool selection
assumes that base definition exists. A healthy listener and matching CLI version
did not prove Desktop compatibility. An editor inherited the global override
and could reintroduce it when reopening Desktop after cleanup.

Decision: retain shared App Server sessions and the existing deck features,
but harden startup, containment, compatibility checks, and recovery. Do not use
Micro-owned substitute sessions. Revisit the architecture if updates continue
to cause disruption.

## Startup contract

1. `shared install` runs an isolated compatibility probe and fingerprints the
   installed server **and Desktop archive**. It prepares a scoped CLI launcher
   without restarting Desktop or setting global environment variables.
2. `shared open` starts Desktop with a process-local `CODEX_CLI_PATH` pointing
   to the launcher. The old WebSocket override is explicitly cleared.
3. Desktop constructs its normal server arguments and environment. The launcher
   forwards them unchanged to the bundled server, adding an authenticated
   loopback listener. Desktop continues speaking stdio through a transport-only
   adapter; Micro joins the same server over WebSocket.
4. The adapter preserves RPC IDs, notifications, server-initiated requests and
   responses. It never injects prompts, assumes Desktop's identity independently,
   disables its app tools, or rewrites tool approvals.
5. Desktop's successful initialization and the owned server process are required
   before Micro restores saved bindings. A new server generation reconnects the
   Micro adapter and restores those bindings again.

This is still an experimental integration. The scoped CLI override was verified
in the installed Desktop source, not established as a stable public extension
contract. Public protocol reference: [OpenAI App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Failure boundaries

- Unknown build, launch flags, or absent setup: native Desktop stdio, no shared
  session control. Normal Dock/Spotlight launches remain native too.
- Server startup failure before forwarding: stop only the child we created,
  then native fallback with the original arguments.
- Failure after forwarding: never replay a request (especially `turn/start`).
  Stop unsafe shared control; a clean Desktop relaunch may be needed. There is
  no claim of seamless failover for in-flight tasks.
- Configuration RPC errors trip the shared-control circuit breaker without
  silently deleting MCP config or disabling Desktop tools.
- Updated artifacts require explicit re-verification. The deck checks this
  **before** quitting Desktop; the old UPDATE key cannot approve a new build.
- Marketplace bridge install/update does not install shared mode. Missing
  configuration does not spawn a private, Micro-owned server.
- Uninstall remains usable from Terminal even when Desktop is broken. It removes
  legacy launchd routing and installation state, preserving saved deck bindings.
- The launcher is kept as a native passthrough after uninstall. Removing the
  project/package later does not strand a running Desktop's CLI override.

## Validation and release gate

Automated tests cover argument/environment preservation, build changes, native
fallback, pre-quit rejection, and the original missing-MCP-base regression.
Real-server probes use temporary HOME/CODEX_HOME/XDG directories, a local dummy
model provider, and a harmless MCP fixture. They must never use the real Desktop
pipe, user credentials, user task IDs, or send a model turn.

```bash
npm run check
SDM_TEST_CODEX=/Applications/ChatGPT.app/Contents/Resources/codex npm test -- src/desktopBridge.integration.test.ts
node dist/cli/stream-deck-micro.js shared verify
```

Before calling a build production-ready, test in an explicitly activated Desktop
with disposable tasks:

- new task and resume, including a fresh project;
- a harmless **real Desktop app-tool** call (fixture discovery alone does not
  prove native peer authorization or all Desktop-provided services work);
- send from Desktop and Micro into the same task; interrupt from the deck;
- focused task navigation, unread/attention acknowledgement;
- Desktop quit/relaunch and saved bindings restored without writer takeover;
- changed build/occupied port/startup failure and a clean native launch;
- Marketplace bridge restart, with no Codex routing change.

Do not upgrade the live setup merely to run tests in the coding task that is
implementing recovery. Keep a Terminal recovery route and avoid interrupting
unrelated active tasks. Record which acceptance steps were actually performed
in the PR; do not substitute unit tests for this gate.

### Recorded isolated result: 2026-08-26

Bundled `codex-cli 0.150.0-alpha.8` reproduced the exact original error without
the base configuration. With startup configuration preserved, the real transport
adapter passed initialization/notification forwarding, new ephemeral task
creation, tool discovery, authenticated second-client attachment, and same-ID
resume of generated durable test history. Missing/wrong tokens were rejected.
The durable fixture is assistant-only generated data in a temporary home; this
does not prove persistence of a newly created no-turn task. No model turns or
live Desktop app-tool calls were sent. Real Desktop/deck acceptance remains
pending; the healthy private Desktop setup was not changed.

## Elgato deployment

This change is in the local Micro bridge and its Control Room, not the Elgato
plugin payload. **No new Marketplace plugin upload is required for this
hardening.** Update/build the bridge, migrate the legacy shared setup, and
explicitly activate the verified launcher. Installing the bridge alone does not
enable shared control. Preserve existing plugin version/review state.
