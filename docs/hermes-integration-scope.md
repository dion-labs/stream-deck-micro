# Hermes Agent integration scope

Status: **feasible, bridge contract required before implementation**

Last investigated: 2026-08-22

## Acceptance criterion

Stream Deck Micro must attach to, observe, and control the exact Hermes Agent
conversation already open in the user's CLI, TUI, dashboard, or desktop app.
Sharing only the persisted transcript is not sufficient: Micro must never
resume the same database row into a second in-memory agent while the user's
surface is still attached.

## Research outcome

Hermes is a substantially better integration candidate than Cursor ACP because
all of its surfaces share `~/.hermes/state.db`, it exposes structured session
APIs, and its plugin documentation explicitly supports remote-control viewers
injecting messages into the active CLI conversation.

The current Hermes interfaces do not all have the same ownership semantics:

| Surface | Same live agent? | Safe for Micro today? | Finding |
| --- | --- | --- | --- |
| Classic CLI + in-process plugin | Yes | Yes, with limited public controls | `ctx.inject_message()` queues into the active CLI object when idle and interrupts/injects when busy. |
| TUI gateway `session.steer` / `session.interrupt` | Yes | Partly | These methods target the existing in-memory agent and do not replace its event transport. |
| TUI gateway `prompt.submit` | Yes | No | It rebinds the session's event transport to the caller. A Micro WebSocket could send the prompt, but the visible TUI would lose that turn's stream. |
| TUI `session.resume`, ACP, API server, or a second Hermes process | Shared history only | No | They can reopen the same persisted conversation but do not prove safe concurrent ownership of the same in-memory agent. |
| Telegram/Discord/Slack/etc. handoff | Ownership transfer | No | Handoff is useful across surfaces but is not simultaneous control. |

This means an initial classic-CLI integration can satisfy the product rule. Full
TUI/dashboard/desktop support needs a small Hermes bridge addition; it should
not be approximated by launching a second Hermes agent.

## Installed build inspected

The local Hermes installation is a clean source checkout at:

```text
~/.hermes/hermes-agent
commit 66a6b9c930019eeefe0bc089edcf47ff5ce9d0d8
describe v2026.5.29-893-g66a6b9c93
```

The conclusions below are based on that build and should be rechecked after a
Hermes update.

## Relevant native capabilities

The TUI gateway already exposes most of the desired protocol over JSON-RPC:

- `session.active_list` enumerates only live, in-memory TUI sessions;
- `session.activate`, `session.status`, and `session.history` provide current
  state without creating an agent;
- `session.steer` injects text into a running agent after the next tool batch;
- `session.interrupt` performs a true interruption;
- `prompt.submit` starts an idle turn;
- structured events cover message streaming, tools, status, approvals,
  clarifications, secrets, and session lifecycle.

Live session statuses are `starting`, `working`, `waiting`, and `idle`. A live
entry includes both the gateway's internal session ID and the persistent
`session_key`, plus title, model, preview, message count, timestamps, and current
focus.

The classic CLI plugin API has a public `ctx.inject_message()` method and
lifecycle hooks for session, LLM, tool, and approval events. The injection
method deliberately operates on the CLI's existing `_pending_input` and
`_interrupt_queue`, so it meets the same-session requirement. It returns false
in gateway mode, which is why the TUI needs the separate bridge work below.

## Recommended architecture

Build a small, upstream-friendly **Hermes Micro Bridge** and keep Hermes as the
sole owner of its agents.

### Local discovery and security

Each live Hermes host process writes a discovery record under a private
directory such as:

```text
~/.hermes/stream-deck-micro/*.json
```

The record should contain protocol version, PID, surface (`cli` or `tui`),
socket path, random bearer token, Hermes version, and creation time. Use a Unix
socket with owner-only permissions, validate the PID, delete stale records, and
never expose the bridge on LAN interfaces.

### Classic CLI host

A normal opt-in Hermes plugin should:

- start the local bridge when the CLI is ready;
- identify the currently active persistent session;
- inject an idle prompt through the public `ctx.inject_message()` API;
- publish lifecycle snapshots using session, pre/post LLM, and pre/post tool
  hooks;
- read final history/title metadata from the shared session database;
- stop and remove discovery state when the CLI exits.

For full control parity, propose public plugin APIs for `queue`, `steer`, and
`interrupt` instead of depending on private `_cli_ref`, `_pending_input`, or
`_interrupt_queue` fields. Until those APIs exist, advertise only the semantics
that `ctx.inject_message()` actually guarantees: start when idle,
interrupt-and-inject when busy.

### TUI/dashboard/desktop host

Add a non-owning control path to the existing TUI gateway. The smallest safe
change is a method such as `prompt.inject` (or a `claim_transport: false` option)
that targets a live session but preserves its current owner transport. Micro can
then:

- call `session.active_list` to discover real live sessions;
- call the non-owning prompt method when idle;
- use `session.steer` while working and `session.interrupt` for STOP;
- poll `session.status` and `session.history` initially;
- later subscribe as an observer if Hermes adds event fan-out.

The stronger long-term contract is one primary UI transport plus zero or more
read-only observer transports per session. Events continue to stream to the
primary TUI while Micro receives the same structured updates. Disconnecting an
observer must never orphan or reap the session.

A standalone TUI currently owns a stdio gateway that is not independently
discoverable. The bridge therefore belongs inside that gateway process (or in
an upstream broker it starts), not in a second `hermes acp` or API process. The
dashboard's `/api/ws` can reuse the same contract when the dashboard is the
host, but it is not a universal discovery endpoint for standalone TUI sessions.

## Micro adapter contract

Add a `hermes-live` harness only after the bridge handshake succeeds.

- `listSessions()` returns only live bridge-owned sessions, never arbitrary
  closed rows from `state.db`.
- `attach()` stores the persistent `session_key` plus the current bridge
  instance; it never resumes or creates a Hermes agent.
- `send()` starts an idle turn. While working, the configured action must be
  explicit: steer, queue, or interrupt-and-send. Do not silently substitute one
  behavior for another.
- `stop()` maps to a real Hermes interrupt only when the host bridge supports
  it.
- `refresh()` updates titles and state from the host and re-resolves an attached
  session after a host restart.
- every deck key remains eligible to hold a Hermes session, matching the current
  general session-button model.

Suggested status mapping:

| Hermes | Micro |
| --- | --- |
| `starting` | working |
| `working` | working |
| `waiting` | requires attention |
| `idle` after a completed turn | requires attention until acknowledged |
| `idle` after acknowledgement | idle |
| host/socket lost | disconnected, not completed |

Approvals are deliberately out of the first phase. If Hermes requests one,
Micro should show **requires attention** and direct the user to Hermes; it must
not add an approval UI or auto-approve on the user's behalf.

## Implementation phases

1. **Classic CLI proof**
   - Build the opt-in bridge plugin and a tiny protocol client.
   - Attach Micro to an already-open CLI conversation.
   - Send from the deck and prove the prompt and response appear in that same
     terminal session.
   - Verify idle and busy behavior, process restart, stale discovery cleanup,
     and final-response attention state.
2. **Hermes upstream contract**
   - Propose public plugin controls for queue/steer/interrupt.
   - Add a non-owning TUI prompt method and tests proving the owner transport
     remains unchanged.
   - Prefer an observer subscription/fan-out API if Hermes maintainers want a
     more general remote-control contract.
3. **TUI/dashboard integration**
   - Discover live gateway sessions, attach without `session.resume`, and use
     the shared-agent controls.
   - Verify the terminal/web UI continues receiving all events while Micro is
     connected and after Micro disconnects.
4. **Product integration**
   - Add Hermes doctor checks, Control Room labels, session refresh, deck state
     mapping, docs, packaging, and a feature-difference table.

## Required acceptance tests

Do not call the integration complete until all applicable surfaces pass these
tests:

1. Open a Hermes session in the user surface and attach Micro by its existing
   identity.
2. Send a harmless prompt from Micro and see it immediately in that exact
   surface and transcript.
3. Keep the user surface open and verify its live stream, tools, and final text
   continue normally.
4. Send while Hermes is working and verify the selected steer/queue/interrupt
   semantics without message loss or duplicate turns.
5. Press STOP and verify the same live agent is interrupted.
6. Rename, switch, close, and reopen sessions; verify refresh and stale binding
   behavior.
7. Disconnect/restart Micro during a turn; Hermes must continue unaffected.
8. Restart Hermes; Micro must report disconnected until a new live bridge is
   discovered, then reattach only when identity is unambiguous.
9. Confirm no test starts a second agent against an already-live session key.

## Explicit non-goals and rejected fallbacks

- Do not integrate by spawning `hermes acp`, `hermes api`, or another TUI
  gateway and resuming the same database session.
- Do not treat shared SQLite history as proof of shared live ownership.
- Do not write directly to `state.db` to inject messages.
- Do not scrape terminal output or automate keyboard input.
- Do not reach into private plugin manager/CLI fields in a release build.
- Do not implement approvals in phase one.

## Pickup checklist

1. Confirm which Hermes surface should be the first user-facing target. The
   local `display.interface` setting is currently unset, so plain `hermes`
   resolves to classic CLI and makes the plugin proof the shortest path.
2. Create a disposable Hermes session and capture its session key/title.
3. Scaffold the Hermes Micro Bridge as a user-installable plugin and define a
   versioned local protocol.
4. Implement only `list`, `status`, and `send` first; prove same-session behavior
   before adding the Micro harness.
5. Decide whether busy sends should default to queue or steer. Preserve Hermes's
   configured busy behavior where possible.
6. Draft the upstream TUI change with a regression test that a non-owning send
   does not change `session["transport"]`.
7. Add STOP only after a public, same-agent interrupt route exists for the
   selected surface.

## References

- [Hermes session management](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md)
- [Hermes programmatic integration protocols](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [Hermes plugin system and message injection](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugins.md)
