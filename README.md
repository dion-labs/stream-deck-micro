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
Codex Desktop ───────────────┐
                            ├── ws://127.0.0.1:17532 ── Codex sessions
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

## Requirements

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

`marketplace install` also installs shared Codex mode, selects the Marketplace
surface in the config, and starts a per-user LaunchAgent. Inspect it at any time:

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

After `shared install`, fully quit Codex Desktop with **Codex → Quit Codex** and
open it again. Closing only the window is not enough. This one-time restart
makes Desktop inherit the shared App Server endpoint.

At login, Stream Deck Micro waits until Desktop is connected to that shared
endpoint before restoring or attaching any session. If Desktop wins the startup
race with a private server, Micro keeps the saved bindings untouched and replaces
the deck with one central **RESTART CODEX** key. Pressing it gracefully quits and
reopens Desktop, then restores the saved session buttons after shared control
reconnects. The same recovery action appears in Control Room's Live mode.

The installer:

- starts a loopback-only Codex App Server at `ws://127.0.0.1:17532`;
- keeps it running with a per-user macOS LaunchAgent;
- points Codex Desktop and Stream Deck Micro at that endpoint;
- updates the selected project configuration without discarding other settings.

The deck daemon prints the local Control Room URL when it starts. By default it
is `http://127.0.0.1:17531`.

Check or completely remove the integration at any time:

```bash
stream-deck-micro shared status
stream-deck-micro shared uninstall
```

After uninstalling, fully quit and reopen Codex Desktop. The uninstall command
stops the shared server, removes both LaunchAgents, clears Desktop routing, and
removes only the shared endpoint from the Stream Deck Micro configuration.
Removing the Marketplace bridge does not remove shared mode, because the
Independent edition uses the same shared server.

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
- Codex Desktop must be fully restarted after shared mode is installed or
  removed. Micro detects private-server startup races, leaves session writers
  untouched, and offers a one-key graceful Desktop restart.
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
