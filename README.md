# Stream Deck Micro

Turn an Elgato Stream Deck MK.2 into a local command center for Codex sessions.
Six live slot keys show what your agents are doing; the remaining keys select,
interrupt, attach, and launch reusable workflows. A localhost Control Room keeps
the physical deck, Codex sessions, and workflow configuration in sync.

[Project site](https://deck.dionlabs.ai) ·
[Sponsor Dion Labs](https://github.com/sponsors/dion-labs)

> [!IMPORTANT]
> Stream Deck Micro is an independent, unofficial interoperability project. It
> is not affiliated with or endorsed by OpenAI, Work Louder, or Elgato. Codex,
> Codex Micro, Stream Deck, and related marks belong to their respective owners.

## What it does

- Shares six recent Codex sessions with the desktop app while it remains open.
- Shows idle, thinking, working, complete, and error states on physical RGB keys.
- Sends one-tap workflows such as Review, Debug, Refactor, and Tests.
- Interrupts the selected turn and attaches recent sessions without leaving the deck.
- Provides a local Control Room for session assignment, labels, and workflow editing.
- Keeps session bindings and custom labels across daemon restarts.

The project uses the
[Codex App Server](https://developers.openai.com/codex/app-server) interface for
rich-client events and conversation history. Codex Desktop and Stream Deck
Micro connect to one local WebSocket App Server, so both can read and control
the same session without competing for its writer lock.

```text
Codex Desktop ─┐
               ├── ws://127.0.0.1:17532 ── Codex sessions
Stream Deck ───┘
```

## Requirements

- macOS
- Node.js 22 or newer
- Codex Desktop, installed and authenticated
- Elgato Stream Deck MK.2, 15-key model

Quit the Elgato Stream Deck application before starting. It normally owns the
HID device exclusively, so two applications cannot drive the deck at once.

## Install

```bash
git clone https://github.com/dion-labs/stream-deck-micro.git
cd stream-deck-micro
npm ci
npm run build
npm link
stream-deck-micro shared install
```

The npm package is not published yet. Until it is, install from source as shown
above so every command in this guide works as written.

After `shared install`, fully quit Codex Desktop with **Codex → Quit Codex** and
open it again. Closing only the window is not enough. This one-time restart
makes Desktop inherit the shared App Server endpoint.

Then verify the complete setup and start the deck daemon:

```bash
stream-deck-micro doctor
stream-deck-micro start
```

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

Shared mode adds this section:

```json
{
  "harness": "codex-app-server",
  "appServer": {
    "url": "ws://127.0.0.1:17532"
  }
}
```

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
│ AG6 │DO IT│STOP │ ATCH │ WF  │
├─────┼─────┼─────┼─────┼─────┤
│REVIEW│DEBUG│REFACTOR│TESTS│ SEL │
└─────┴─────┴─────┴─────┴─────┘
```

- **AG1–AG6** select the target session. Empty slots are inert.
- **DO IT** sends `lets do it` to the selected session.
- **STOP** interrupts the selected turn.
- **ATCH** attaches the newest unassigned Codex session.
- **SEL** cycles the selected slot.
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

## Control Room

The Control Room is served only on `127.0.0.1`. It mirrors the physical 5×3
deck and lets you:

- inspect and rename slots;
- stop or remove a bound session;
- search Codex sessions and attach one to a free slot;
- edit, reorder, run, park, and reactivate workflow prompts;
- review recent state changes.

Its API rejects unexpected hosts and origins and requires a fresh process-local
token embedded in the page. It is not designed for LAN or internet exposure.

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
sdm clear [1-6]
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
```

The current suite covers the state machine, slot manager, both Codex adapters,
deck layout/rendering, and Control Room request security.

```text
src/
  core/                     harness-neutral sessions, slots, and state
  harness/codex/            Codex SDK execution adapter
  harness/codex-app-server/ App Server transports, adapter, and fallback monitor
  deck/                     Stream Deck MK.2 layout, rendering, and HID control
  admin/                    localhost Control Room and API boundary
  cli/                      installer-facing commands and sdm companion CLI
  ipc.ts                    local Unix-socket control plane
  main.ts                   daemon wiring and persistence
```

To add another agent harness, implement `HarnessAdapter`. To add another device,
provide a compatible deck driver and layout rather than changing the core state
machine.

## Known limitations

- v1 supports only the 15-key Stream Deck MK.2 on macOS.
- The Elgato application must be closed while the daemon owns the device.
- Codex Desktop must be fully restarted after shared mode is installed or
  removed. A Desktop version that does not support its WebSocket endpoint hook
  can still be observed through the polling fallback, but cannot share writes.
- There is no approval, voice, reasoning-effort, or new-chat key in v1.
- The legacy exec harness can leave descendant shell processes behind after an
  interrupt; the app-server harness uses graceful turn interruption.

## License and support

MIT licensed. Contributions are welcome; read `CONTRIBUTING.md` and
`SECURITY.md` before opening a pull request or reporting a vulnerability.

If this saves you context switches, you can
[sponsor Dion Labs](https://github.com/sponsors/dion-labs).
