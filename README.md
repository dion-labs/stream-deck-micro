# Stream Deck Micro

Turn an Elgato Stream Deck MK.2 into a local command center for Codex sessions.
Seven live session keys ship by default, and any of the fifteen keys can become
another session, system action, or reusable workflow. Choose the official Elgato
Marketplace surface or the independent direct-HID surface; both use the same
local bridge, Control Room, sessions, and behavior model.

[Project site](https://deck.dionlabs.ai) ·
[Sponsor Dion Labs](https://github.com/sponsors/dion-labs)

> [!IMPORTANT]
> Stream Deck Micro is an independent, unofficial interoperability project. Its
> Marketplace edition uses Elgato's official plugin SDK, but the project is not
> affiliated with or endorsed by OpenAI, Work Louder, or Elgato. Codex,
> Codex Micro, Stream Deck, and related marks belong to their respective owners.

## Download the native macOS app

**[Download the Apple Silicon preview](https://github.com/dion-labs/stream-deck-micro/releases/tag/v0.2.0-alpha.1)** · [Guided setup](https://deck.dionlabs.ai/setup/) · [Install and upgrade notes](docs/native-app.md)

The full Control Center now runs in a native macOS app, with menu-bar status,
optional task notifications, and automatic connection at login. Node and the
Elgato plugin installer are included. Requires Apple Silicon, macOS 14+,
ChatGPT Desktop with Codex, and Elgato Stream Deck 7.1+.
This alpha preview is **unnotarized**; review the installation notes before opening.
Existing sessions are never restarted by setup or the launcher.

## What it does

- Shares up to fifteen Codex sessions with the desktop app while it remains open.
- Detects Codex title changes automatically, with a manual refresh in the Control Room.
- Shows idle, thinking, working, complete, and error states on physical RGB keys.
- Sends one-tap workflows such as Review, Debug, Refactor, and Tests.
- Interrupts the selected turn and attaches recent sessions without leaving the deck.
- Provides a local Control Room for session assignment, labels, and workflow editing.
- Keeps session bindings and custom labels across daemon restarts.
- Wakes for activity, holds completed work for acknowledgement, and sleeps when quiet.
- Runs either inside the Elgato app or as a standalone direct-HID controller.

The project uses the
[Codex App Server](https://developers.openai.com/codex/app-server) interface for
rich-client events and conversation history. Codex Desktop and Stream Deck
Micro connect to one local WebSocket App Server, so both can read and control
the same session without competing for its writer lock.

```text
Codex Desktop ─ stdio shim ─┐
                            ├── authenticated loopback App Server ── shared sessions
Marketplace plugin ─ bridge ┤
Independent HID ──── bridge ┘
```

## Choose an edition

| | Marketplace edition | Independent edition |
| --- | --- | --- |
| Best for | Familiar Elgato app and plugin workflow | Maximum local control and minimal stack |
| Device ownership | Elgato Stream Deck app | Stream Deck Micro opens HID directly |
| Session/workflow parity | Full | Full |
| Sleep behavior | Keys render black; first press wakes and is consumed | Hardware brightness reaches zero; first press wakes and is consumed |
| Profiles | Editable official Elgato profile plus shared Control Room layout | Configurable project-managed 5×3 layout |
| Background operation | Per-user LaunchAgent | Foreground daemon by default |
| Elgato app | Must be running | Must be quit |

See [Edition guide](docs/editions.md) for the detailed tradeoffs and switching
instructions. The Marketplace edition intentionally does not hide its one SDK
gap: Elgato's documented plugin API does not expose device-wide brightness, so
sleep is visually simulated instead of changing hardware brightness.

## Source installation requirements

- macOS
- Node.js 22 or newer
- Codex Desktop, installed and authenticated
- Elgato Stream Deck MK.2, 15-key model

The Marketplace edition also requires Elgato Stream Deck 7.1 or newer. The
Independent edition requires the Elgato app to be quit because the two processes
cannot own the HID device at the same time.

## Install

The npm package and Marketplace listing are not published yet. Until they are,
install the local bridge from source:

```bash
git clone https://github.com/dion-labs/stream-deck-micro.git
cd stream-deck-micro
npm ci
npm run build
npm link
```

### Marketplace edition

Build and link the official Elgato plugin, then install its persistent local
bridge:

```bash
npm run marketplace:install
npm run marketplace:build
npm --prefix marketplace run link
stream-deck-micro marketplace install
open "marketplace/ai.dionlabs.stream-deck-micro.sdPlugin/profiles/Stream Deck Micro.streamDeckProfile"
```

Accept the profile import in the Elgato app. The released Marketplace package
will prompt to install this profile automatically; the explicit `open` command
is only needed for source-linked development installs.

`marketplace install` selects the Marketplace surface and starts its per-user
LaunchAgent. It does **not** install, activate, or restart Codex shared mode.
Set that up separately using the instructions below. Inspect the bridge at any time:

```bash
stream-deck-micro marketplace status
stream-deck-micro doctor --marketplace
```

### Independent edition

Install shared Codex mode, fully quit the Elgato app, and run the direct-HID
daemon:

```bash
stream-deck-micro marketplace uninstall # only when switching from Marketplace
stream-deck-micro shared install
stream-deck-micro doctor
stream-deck-micro start
```

### Shared control: verified, scoped launch

`shared install` runs an isolated, prompt-free compatibility probe and prepares
a launcher. It does **not** quit Desktop or activate shared mode. At a safe
stopping point, fully quit Codex Desktop, then run:

```bash
stream-deck-micro shared open
```

Desktop launches its bundled server through Micro's transport adapter. Desktop's
complete startup arguments and environment—including its per-launch app-tools
connection—are forwarded, rather than copied into a separately managed server.
Both clients still control the same sessions. The listener uses a locally stored
bearer token; it is never exposed beyond `127.0.0.1`.

**By default, normal Dock/Spotlight launches remain private.** To use Micro after quitting
Desktop or rebooting, use `shared open` again. With verified setup, the deck's
explicit **RETRY SHARED** action can also switch a running private Desktop into
shared control. This interrupts active tasks, so use it only at a safe stopping
point. Micro never switches or restarts a running Desktop automatically.

To make shared control the default for future GUI launches and open Codex at login:

```sh
stream-deck-micro shared autoconnect
```

For an ordered startup with a native macOS launcher, install from this checkout:

```sh
npm run launcher:install
```

This builds **Codex + Stream Deck.app** in `~/Applications`, or updates the copy
in `/Applications` if you moved it there, and points the login agent at it.
Use this app instead of ChatGPT directly; you can keep it in the
Dock. The launcher waits for the installed Marketplace service, verifies changed
Codex builds, opens ChatGPT through the bridge, and waits for session buttons to
be ready. It then displays the existing local Control Center in a native WebKit
window: Slots, Sessions, Keys, Library, Device, diagnostics, and recovery use
the same service and controls as the browser. Native text dialogs and clipboard
support preserve editing and copying diagnostics. ChatGPT still owns its session
backend and per-launch app tools.

Closing the window leaves the app available in the menu bar. Clicking its Dock
icon or choosing **Show Control Center** reopens it. Quitting the Control Center
does not quit Codex or the independently managed Stream Deck service. **Reload**
refreshes only the dashboard; **Open in Browser** opens the same local interface.
Task notifications are optional, enabled from the app menu, and only report
observed active-to-finished/error transitions; they do not replay old events.
At login the app stays in the menu bar unless startup fails.

For dashboard-only access that never launches Codex, use:

```sh
open -a 'Codex + Stream Deck' --args --control-center
```

The embedded window accepts only its configured loopback origin. Existing
Control Center authentication remains in place; unrelated websites cannot use
the native clipboard bridge. Actual live controls still depend on Codex having
started in shared mode, exactly as in the browser.
The installer requires Xcode command-line tools, an installed Marketplace bridge,
and shared control configured. It does not start, quit, or restart ChatGPT or the
Stream Deck service. It registers the login entry for the next login.

An already-running ChatGPT is left untouched: the launcher reports either a
ready connection or that a private session needs a later user-initiated relaunch.
Startup failures are shown in the launcher window; it never restarts an app to
repair them. Keep ChatGPT's separate login item disabled so the launcher controls
startup order. macOS independently restoring ChatGPT can still bypass that order.
`shared uninstall` disables the launcher login entry; the app bundle remains in
`~/Applications` and can be removed normally when no longer needed.

This installs a per-user login agent and sets `CODEX_CLI_PATH` and
`CODEX_APP_SERVER_FORCE_CLI` in the GUI launch environment. It does not restart
the current app. Future launches use the bridge; updated Desktop builds run
the compatibility probe automatically before starting shared control. Transient
transport errors and a build changing during verification get up to three isolated
attempts with short delays. Failed compatibility assertions are never approved.
A failed probe or connection still falls back to private mode. A saved transient
failure before requests were forwarded can be reverified on the next natural
launch; failures after forwarding remain blocked for explicit recovery.
Explicit launch environment
overrides can bypass these defaults, and an app restored before the login agent
runs may require one later, user-initiated relaunch. The login agent checks for an
existing Codex process and leaves it alone, including when process inspection
fails; it never quits or restarts an app to repair routing. This detects but does
not eliminate the macOS restore ordering race. `shared uninstall` removes the login agent and
Micro's environment defaults. Other GUI programs can inherit these environment
variables; the bridge passes unrelated CLI commands through to the bundled binary.

If shared control is unhealthy, the recovery surface offers two deliberately
different choices. **RETRY SHARED** attempts the verified integration again.
The prominent **RECOVER CODEX** escape hatch prioritizes Desktop availability:
it gracefully quits ChatGPT, removes Micro's shared routing, stops only bundled
Codex processes verified to be listening on Micro's exact loopback endpoint,
and reopens ChatGPT in private stdio mode. Saved deck bindings are preserved,
but Micro stays paused until shared mode is investigated and explicitly set up
again. The same action is available from Control Room and Terminal:

```bash
stream-deck-micro shared recover ./config.json
```

Recovery may interrupt active turns. It never kills by process name, port alone,
or an unverified executable, and it re-checks command identity before escalating
from graceful termination.

The installed Desktop application and server are fingerprinted. With automatic
connection enabled, changed builds are verified on launch as described above.
Otherwise an unverified build falls back to Desktop's native private server:
at a safe stopping point, quit Desktop, run `shared install` again to verify the
new build, then `shared open`. A version/health response alone is not considered
compatibility proof.

If shared startup fails before a request is forwarded, the adapter falls back
to native stdio. Once a request has been forwarded, it is **never replayed**;
a later failure can require a clean Desktop relaunch. Shared control stays
disabled until explicitly reverified. Your saved session assignments are kept.

Read [the hardening design and validation limits](docs/shared-server-hardening.md)
before enabling this experimental integration. The probe does not replace a
real Desktop app-tools and physical-deck acceptance test.

The deck daemon prints the local Control Room URL when it starts. By default it
is `http://127.0.0.1:17531`.

The local Control Room now reports whether Micro has **Live control**,
**Navigation only**, or is **Offline**, together with component-level bridge,
surface, plugin, Codex, control, and binding health. Its redacted diagnostic
report intentionally omits prompts, task names and IDs, paths, and configuration
values. The staged design for moving onboarding to Dion Labs without turning it
into a cloud control plane is recorded in the
[Hosted Control Room roadmap](docs/hosted-control-room-roadmap.md).

Check or completely remove the integration at any time:

```bash
stream-deck-micro shared status
stream-deck-micro shared uninstall
```

After uninstalling, fully quit and reopen Codex Desktop from Dock/Spotlight.
Uninstall removes Micro's install state, legacy shared-server/environment
LaunchAgents and global routing, and only the shared endpoint from Micro's
configuration. It does not quit Desktop or discard your session bindings. A
small native-passthrough launcher is retained so a running Desktop is not left
referencing a missing executable. Legacy server removal can interrupt its tasks.
Removing the Marketplace bridge does not remove shared mode, because the
Independent edition uses the same shared server.

For an installation made before this hardening, finish active tasks, quit
Desktop, run `shared uninstall`, then `shared install` and `shared open`.
Quit/reopen any terminal or editor that inherited the old
`CODEX_APP_SERVER_WS_URL`; otherwise it may still launch apps with stale routing.

## Configure

Copy `config.example.json` to `~/.stream-deck-micro/config.json`, then change the
default working directory and workflows:

```bash
mkdir -p ~/.stream-deck-micro
cp config.example.json ~/.stream-deck-micro/config.json
```

You can also pass an explicit config file:

```bash
stream-deck-micro shared install ./my-deck.json
stream-deck-micro doctor ./my-deck.json
stream-deck-micro start ./my-deck.json
```

`slots.count` is the available session-slot capacity (`1`–`15`). Set it to
`15` to let every physical position become a distinct session key. Only slots
actually assigned in the Control Room are populated, so unused capacity does
not attach hidden sessions.

Shared mode adds this section:

```json
{
  "harness": "codex-app-server",
  "appServer": {
    "url": "ws://127.0.0.1:17532"
  }
}
```

Device sleep is configured in the same file or from the Control Room's
**Device** tab:

```json
{
  "deck": {
    "brightness": 70,
    "autoSleep": {
      "enabled": true,
      "timeoutMinutes": 15
    },
    "sleepKey": "sleep"
  }
}
```

Set `sleepKey` to `toggle-auto` if the bottom-right key should toggle automatic
sleep instead of sleeping immediately.

The example configuration uses `danger-full-access` with approvals set to
`never`. That is intentional: v1 targets experienced Codex users running
unattended local agents. A workflow key can therefore cause Codex to edit files,
run commands, and access anything allowed by your Codex configuration. Review
every prompt and use a narrower sandbox if this does not match your threat model.

## Deck layout

```text
┌─────┬─────┬─────┬─────┬─────┐
│ AG1 │ AG2 │ AG3 │ AG4 │ AG5 │
├─────┼─────┼─────┼─────┼─────┤
│ AG6 │STATUS│STOP │ AG7  │TESTS│
├─────┼─────┼─────┼─────┼─────┤
│REVIEW│DEBUG│REFACTOR│SLEEP│DO IT│
└─────┴─────┴─────┴─────┴─────┘
```

- **AG1–AG7** select the target session, bring Codex Desktop forward, and open
  that thread. Empty slots are inert; the first press while asleep only wakes.
- Changing threads in Codex Desktop selects the matching assigned session on
  the deck, keeping workflow and control keys pointed at the visible thread.
- **DO IT** sends `lets do it` to the selected session.
- **STOP** interrupts the selected turn.
- Any key can become a distinct session button, up to all fifteen positions.
- **ATCH** remains available as an optional action, but is not in the default layout.
- **SLEEP** puts the surface to sleep immediately. It can instead toggle auto sleep.
- **Workflow keys** send their configured prompts to the selected slot.

There is deliberately no NEW key in v1. Sessions begin where a real first prompt
can be written—the Codex desktop app, IDE, TUI, or `sdm new`—and are then pulled
onto the deck.

### State colors

| State | Color | Meaning |
| --- | --- | --- |
| Empty | Near-black | No session is bound |
| Idle | Slate | Session is ready |
| Thinking | Purple pulse | Codex is reasoning or writing |
| Working | Blue pulse | Codex is running tools or changing files |
| Complete | Green flash | The latest turn completed |
| Error | Red flash | The latest turn failed or stopped |
| Attention | Signal-yellow beacon | A finished turn has not been acknowledged; the label preserves done/error |

### Sleep and attention

Automatic sleep counts from the latest slot status change. Thinking and working
turns always keep the full deck awake. A completion or error becomes a persistent
attention state; after the timeout, non-attention keys turn black and only those
slots remain visible. Press an attention slot to acknowledge it and select that
session. Starting a new turn in the session also acknowledges the previous result.
In shared mode, clearing Codex Desktop's notification dot by viewing the thread
also clears the matching deck attention state.

Focused-session sync is best effort and reads Codex Desktop's local activity
log. It only selects sessions already assigned to a key; unknown threads and
unexpected log formats leave the current deck selection unchanged.

When no slot needs attention, the timeout sleeps the surface. The Independent
edition sets device brightness to zero; the Marketplace edition renders every
plugin key black because global brightness is not available to plugins. In both
editions, the first physical key press restores the surface and is deliberately
consumed, so it cannot accidentally run a workflow. Any later status change also
wakes the deck.

## Control Room

The Control Room is served only on `127.0.0.1`. It mirrors the physical 5×3
deck and lets you:

- start in safe **Configure** mode, where clicks only inspect keys and never run actions;
- drag any key to swap positions and assign session, system, or workflow functions directly;
- turn any key into a distinct session button, with capacity for all fifteen positions;
- opt into **Live control** when the browser deck should execute exactly like the hardware;
- inspect and rename slots;
- stop or remove a bound session;
- search Codex sessions and attach one to the targeted slot, replacing its binding without deleting the underlying Codex task;
- receive renamed Codex titles automatically or force a recovery sync with **Refresh titles**;
- edit, explicitly run, park, and reactivate workflow prompts;
- configure brightness, auto-sleep timing, and the sleep-key behavior;
- sleep or wake the physical deck immediately;
- review recent state changes.

Its API rejects unexpected hosts and origins and requires a fresh process-local
token embedded in the page. It is not designed for LAN or internet exposure.
Layout changes save immediately to the active configuration and repaint both
editions; Configure mode is restored whenever the page is opened or reloaded.
An explicit session attachment briefly shows **ATTACHED** on that slot across
the Control Room and both deck editions, even when the old and new task names match.

The shared Codex endpoint is also bound to loopback only. The installer rejects
non-local or authenticated URLs rather than exposing control of Codex sessions
to the network.

## Companion CLI

```bash
sdm status
sdm send "fix the flaky authentication test"
sdm new [cwd]
sdm select 2
sdm stop
sdm sleep
sdm wake
sdm clear [1-15]
sdm rename 2 "release prep"
sdm workflow review
sdm sessions
sdm attach [session-id]
```

## Development

```bash
npm ci
npm run dev
npm test
npm run build
npm pack --dry-run

npm run marketplace:install
npm run marketplace:build
npm --prefix marketplace test
npm run marketplace:validate
npm run marketplace:pack
```

The current suite covers the state machine, slot manager, shared Codex adapter,
deck layout/rendering, and Control Room request security.

```text
src/
  core/                     harness-neutral sessions, slots, and state
  harness/codex-app-server/ App Server transports, adapter, and fallback monitor
  deck/                     Stream Deck MK.2 layout, rendering, and HID control
  admin/                    localhost Control Room and API boundary
  cli/                      installer-facing commands and sdm companion CLI
  ipc.ts                    local Unix-socket control plane
  main.ts                   daemon wiring and persistence
marketplace/                official Elgato SDK plugin, profile, and package
```

To add another agent harness, implement `HarnessAdapter`. To add another device,
provide a compatible deck driver and layout rather than changing the core state
machine.

## Known limitations

- v1 supports only the 15-key Stream Deck MK.2 on macOS.
- The Marketplace package is implemented and validator-clean but has not yet
  completed Elgato Maker Console review.
- Marketplace sleep blacks out plugin-owned keys but cannot set global device
  brightness; the Independent edition provides true brightness-zero sleep.
- The Elgato application must be closed only while the Independent edition owns
  the device.
- Shared control requires a scoped `shared open` launch; normal Desktop launches
  stay private. A Desktop update disables shared control until reverified.
- WebSocket transport is experimental. New/resumed sessions and Desktop tools
  must be retested after integration changes; compatibility is not guaranteed
  for every future Desktop release.
- There is no approval, voice, reasoning-effort, or new-chat key in v1.
- Codex App Server does not currently expose Desktop's unread state. Shared mode
  therefore mirrors Codex Desktop's read-only persisted notification-dot state
  on a best-effort basis; if that state is unavailable or changes format, Micro
  safely leaves deck attention in place.

## License and support

MIT licensed. Contributions are welcome; read `CONTRIBUTING.md` and
`SECURITY.md` before opening a pull request or reporting a vulnerability.

If this saves you context switches, you can
[sponsor Dion Labs](https://github.com/sponsors/dion-labs).
