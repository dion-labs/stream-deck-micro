# Claude Code integration scope

Status: **go for a same-session proof; public release is gated by channel distribution**

Last investigated: 2026-08-22

## Acceptance criterion

Stream Deck Micro must attach to, observe, and send prompts into the exact Claude
Code session already open in the user's terminal, IDE, or desktop surface. Claude
Code remains the only owner of the session. Starting another `claude` process and
resuming the same transcript does not satisfy this requirement.

## Decision

Claude Code is the strongest non-Codex candidate investigated so far. Anthropic
now exposes two official same-session mechanisms:

- **Channels** let a local MCP subprocess push external events directly into the
  already-running session. Events start a turn while idle and queue while busy.
- **Cross-session messaging** gives every eligible live session an owner-only
  local inbox socket and explicitly describes scripts and hooks posting to that
  session.

Hooks provide structured lifecycle, session identity, working-directory, tool,
completion, error, and attention signals. Together, these interfaces can meet
Micro's ownership rule without launching or resuming a second agent.

The recommended first proof is an installable Claude Code plugin combining a
channel with hooks. It is not ready to promise as a frictionless public feature:
channels are a research preview, custom channel plugins require a development
warning on every opted-in session, and an ordinary release needs Anthropic's
channel security review and official-marketplace allowlisting.

## Capability assessment

| Requirement | Support | Notes |
| --- | --- | --- |
| Exact live session | Yes | A channel is spawned by and injects directly into that Claude Code session. |
| Send from Micro | Yes | A `notifications/claude/channel` event starts or queues work in the same session. |
| Keep the native surface usable | Yes | Channel events appear in the existing conversation; Claude Code retains ownership. |
| Observe thinking/tool/completion state | Yes | Hooks cover prompt, tool, permission, completion, failure, cwd, and session lifecycle. |
| Read final response | Yes | The `Stop` hook includes `last_assistant_message`. |
| Discover live sessions | Yes, via the plugin | `SessionStart`/`SessionEnd` hooks maintain a live local registry; do not list closed transcripts as attachable. |
| Rename/title refresh | Partial | `SessionStart` exposes an existing title. Rename propagation needs a live proof or safe transcript/index refresh. |
| Queue while busy | Yes | Channel notifications are queued in order and may be batched into the next turn. |
| Interrupt/STOP | Not currently | No supported channel or hook API interrupts the owning session. Do not fake this with signals or terminal input. |
| Launch a new Claude session | Deliberately no | Micro should attach to user-owned live sessions only. |
| Permission approval on deck | Out of scope | Show attention and direct the user to Claude Code; phase one does not relay or grant approvals. |
| Terminal | Expected | This is the documented channel launch path and the first target. |
| VS Code/Desktop | Unproven | Hooks/plugins may load, but per-session channel opt-in and discovery must be tested in each surface. |

## Recommended architecture

Package a **Stream Deck Micro for Claude Code** plugin with two non-owning
components.

### 1. Per-session channel bridge

Claude Code spawns a bundled stdio MCP server for each opted-in session. The
server declares the experimental `claude/channel` capability and:

- registers a local, ephemeral endpoint with the running Micro daemon;
- accepts prompt envelopes only from that daemon;
- emits `notifications/claude/channel` with a Micro request ID in `meta`;
- retries registration if Micro restarts;
- removes its endpoint when Claude Code closes the subprocess;
- exposes no LAN listener and no approval relay.

The channel event is an external event rather than a literal keyboard-entered
user message, but it is displayed in and acted on by the same conversation. This
is acceptable for workflow prompts such as `lets do it`; the showcase and docs
should describe it accurately.

Claude Code does not acknowledge that a channel notification was processed. The
adapter should therefore treat the channel write as **queued**, then use session
hooks to determine working/completed/failed state. It must not claim per-message
delivery solely because the stdio write succeeded.

### 2. Lifecycle hook helper

The same plugin installs command hooks that pass their JSON input to a small
bundled helper. The helper sends best-effort events to Micro's private Unix
socket and always exits quickly if Micro is not running.

Minimum hook mapping:

| Claude hook | Micro signal |
| --- | --- |
| `SessionStart` | Register/update live session with `session_id`, `cwd`, transcript path, title, source, and permission mode. |
| `UserPromptSubmit` | Turn started from the native surface. |
| `PreToolUse` | Running, with tool/detail. |
| `PostToolUse` / `PostToolUseFailure` | Update activity detail; do not mark the turn complete. |
| `PermissionRequest` / relevant `Notification` | Mark the existing deck attention flag and direct the user to Claude Code. |
| `Stop` | Turn complete; store `last_assistant_message` and raise completion attention until acknowledged. |
| `StopFailure` | Turn failed with the documented error and rendered message. |
| `CwdChanged` | Update session metadata. |
| `SessionEnd` | Unregister the live owner and mark attached slots disconnected/empty according to the existing policy. |

`Stop` does not fire for a user interrupt, so interruption recovery must be
verified separately. A heartbeat from the channel process plus the next hook or
transcript update can restore the slot to idle; the first release must not leave
a key permanently working after the user presses Ctrl-C.

### 3. Live registry and adapter

Add a `claude-code-live` adapter backed only by plugin registrations:

- `listSessions()` returns currently live registered Claude sessions only;
- attaching binds a slot to the live registration and never invokes
  `claude --resume`;
- `send()` routes to that registration's channel and waits on session-level
  lifecycle events;
- `interrupt()` reports unsupported until Anthropic exposes a same-session stop
  contract;
- a dead heartbeat or `SessionEnd` disconnects the binding without touching the
  Claude process;
- reconnecting the plugin after a Micro restart rehydrates the same live
  session.

The current `HarnessAdapter` assumes every harness can create and resume
sessions. Before implementation, change that contract to advertise capabilities
such as `canCreate`, `canInterrupt`, and `liveOnly`, and replace `resumeSession`
with attach semantics where appropriate. The admin UI should hide or disable
unsupported actions instead of presenting controls that fail at runtime.

The daemon is also currently constructed directly as `AppServerAdapter` and has
Codex-specific restore/monitor branches. Harness selection, persisted binding,
external-session refresh, and error copy must be moved behind the adapter before
adding Claude Code.

## Correlating a channel with its session

Hooks always receive Claude's `session_id`, but the channel reference does not
currently document a session ID in the MCP initialization payload. This is the
main protocol question for the proof.

Test these paths in order:

1. Check whether the channel subprocess inherits a current
   `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, or equivalent stable
   session identifier.
2. Check whether Claude's MCP initialization metadata contains the session ID.
3. If neither exists, correlate the `SessionStart` hook and channel subprocess by
   their common Claude parent process on macOS.
4. For the development proof only, provide `sdm claude -- ...` as a transparent
   launcher that sets a random instance ID inherited by both plugin components
   and adds the development-channel flag. Claude still owns the interactive
   session; the wrapper only supplies configuration.

Do not ship cwd-plus-start-time matching because two sessions can legitimately
open the same project at once. If no stable correlation works without the
wrapper, terminal support can remain wrapper-based while an upstream session-ID
request is filed; Desktop/IDE support remains unclaimed.

## Inbox socket: promising fallback, not the release contract yet

Claude Code 2.1.224+ on macOS binds a per-session Unix socket and exports
`CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` to hooks and
Bash commands. This avoids the channel allowlist and automatically exists for
eligible interactive sessions.

It is not the primary release path yet because the public documentation defines
the auth line but not the complete message envelope a standalone client should
write. Messages also use peer-message semantics:

- they are treated as coming from another Claude session, not directly from the
  user;
- they cannot grant consent, change configuration, or execute slash commands;
- a bypass-permissions receiver may hold an inbound message unless policy or
  sender identity permits it.

During the proof, capture the behavior of a script posting through the documented
socket. If Anthropic confirms a supported client envelope and own-child relay
pattern, the plugin hook can register the socket/token with Micro or keep a
small authenticated child relay alive. That could become the preferred path
because it removes the channel startup flag. Do not ship a reverse-engineered
private wire format.

## Distribution and onboarding

The plugin can live under `integrations/claude-code/` in this repository and be
listed by a `.claude-plugin/marketplace.json`. During development, installation
can use the Dion Labs GitHub marketplace and the channel can be launched with:

```text
claude --dangerously-load-development-channels plugin:<plugin>@<marketplace>
```

That command shows a full-screen warning and is suitable only for contributors
and early testers. For normal users:

1. submit the plugin through Anthropic's official plugin submission form;
2. complete the extra channel security review;
3. after allowlisting, document the normal `--channels plugin:...` launch;
4. investigate whether terminal, VS Code, and Desktop can persist channel opt-in
   or whether a launcher/setup action is still required.

Until approval, label Claude support **experimental** and keep it out of the
default onboarding path. Plugin installation alone does not activate a channel
for an already-running session.

## Security model

- Keep all Micro/plugin traffic local over Unix sockets in owner-only (`0700`)
  directories with `0600` socket/token material.
- Authenticate every registration with a random per-process token and verify
  the peer UID/PID where macOS permits it.
- Never expose the channel on `0.0.0.0`, persist Claude messaging tokens, or copy
  full transcripts into Micro state.
- Treat channel input as a prompt-injection boundary. Only an authenticated
  local Micro daemon may submit prompts.
- Hooks are observational in phase one. They must never block prompts/tools,
  alter Claude configuration, or answer permission requests.
- If Micro is absent or crashes, Claude Code continues normally.

## Rejected approaches

- **Agent SDK, `claude -p`, or `claude --resume`:** creates another owning
  process against persisted history rather than controlling the already-open
  agent.
- **Remote Control private traffic:** proves Claude supports simultaneous local
  and remote surfaces, but Anthropic documents only its own web/mobile clients,
  not a third-party control API.
- **A second Claude session using `SendMessage`:** targets the right receiver but
  adds a model-driven sender, cost, latency, and peer-message semantics.
- **Direct transcript writes:** history mutation is not live-session control.
- **TTY/tmux keystroke injection or process signals:** fragile, surface-specific,
  and unsafe for Desktop/IDE sessions.
- **Undocumented inbox frames:** acceptable for investigation only, never as a
  public compatibility promise.

## Implementation phases

1. **Protocol proof**
   - Install Claude Code 2.1.240 or later and authenticate.
   - Build a disposable local plugin with one channel and the lifecycle hooks.
   - Resolve stable channel-to-session correlation.
   - Send from a tiny client and prove the prompt appears in the exact open
     terminal session while terminal input and output continue normally.
2. **Micro adapter proof**
   - Add harness capabilities and a live-only adapter behind an experimental
     config flag.
   - Prove discovery, attach, send, queue, lifecycle state, final-message
     attention, Micro restart, Claude restart, and user interruption recovery.
   - Leave STOP unavailable for Claude.
3. **Packaging and surface validation**
   - Package the plugin and Dion Labs marketplace entry.
   - Test terminal first, then VS Code and Claude Desktop independently.
   - Add doctor output that explains missing CLI, plugin, channel opt-in, policy,
     daemon, and version conditions.
4. **Release gate**
   - Submit to Anthropic's official marketplace/channel review.
   - Publish the integration only after the allowlisted path or a documented
     inbox client removes the development warning.
   - Add an honest feature table comparing Codex and Claude Code, especially
     STOP and startup opt-in.

## Required acceptance tests

1. Open a Claude Code session in the supported native surface, then attach Micro
   to that exact live `session_id`.
2. Send `lets do it` from the deck and see it appear and execute in the same
   visible conversation.
3. Keep typing in the native surface before and after the Micro prompt; neither
   side may take ownership from the other.
4. Send while Claude is working and verify ordered queue behavior without a
   duplicate turn or lost event.
5. Start a turn from the native surface and verify Micro follows its state and
   final response even though Micro did not initiate it.
6. Trigger a tool, API failure, permission request, normal completion, and user
   interrupt; verify every slot returns to a truthful state.
7. Rename or resume within the native surface and verify identity/title refresh.
8. Restart Micro while Claude remains open; the plugin must reconnect and the
   same session must reappear.
9. Exit Claude; stale discovery must disappear without Micro killing or resuming
   anything.
10. Run two sessions in the same cwd and prove prompts route by session identity,
    never by project-name guesswork.
11. Confirm no test launches a second Claude agent to own the target transcript.

## Current local state and pickup checklist

Claude Code is not currently installed in `PATH`, so the live socket/channel
proof could not be run during this scope. The latest published npm package at
the time of investigation is 2.1.240. The installed Claude desktop app is not a
substitute for the `claude` CLI needed by the documented development flow.

When ready to continue:

1. Install and sign in to Claude Code 2.1.240 or later.
2. Start one disposable terminal session and record `/status`, relevant plugin
   subprocess environment, hook payloads, and channel initialization metadata.
3. Answer the channel/session-correlation question before changing Micro's core.
4. Prove one same-session injected prompt with a disposable plugin.
5. Test the documented inbox socket separately and ask Anthropic for the stable
   standalone message envelope if it is still absent.
6. Only then refactor the adapter contract and add the experimental harness.

## References

- [Claude Code channels](https://code.claude.com/docs/en/channels)
- [Channels protocol and security reference](https://code.claude.com/docs/en/channels-reference)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Cross-session messaging and inbox sockets](https://code.claude.com/docs/en/cross-session-messaging)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Create and distribute plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Discover and submit plugins](https://code.claude.com/docs/en/discover-plugins)
