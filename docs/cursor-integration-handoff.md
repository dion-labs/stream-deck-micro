# Cursor Desktop integration handoff

Status: **waiting for Cursor Desktop Bridge access**

Last investigated: 2026-08-22

## Acceptance criterion

Stream Deck Micro must attach to, observe, and send prompts into the same local
conversation that is open in Cursor Desktop. A separate session created or
owned by Micro is not useful and must not be shipped as a fallback.

## What was ruled out

Cursor's Agent Client Protocol (ACP) is a good protocol but the wrong session
store for this product requirement. The installed `agent acp` implementation
successfully exposed protocol version 1 with:

- `session/list`, `session/new`, and `session/load`;
- streamed thought, message, and tool-call updates;
- cancellation and permission requests;
- completion results and title updates.

However, `session/list` returned Cursor CLI/ACP conversations, not the local
conversations open in Cursor Desktop. Cursor staff confirmed that local IDE
chats and CLI/ACP chats currently use separate stores and do not share a stable
resumable ID. Do not add ACP as a hidden fallback: it would appear to work while
silently creating the wrong conversation.

Cursor hooks are useful for observation. They expose stable
`conversation_id`, generation, workspace, transcript, tool, thought, and final
response events. Hooks cannot submit a prompt into an existing IDE
conversation, so hooks alone also do not meet the acceptance criterion.

Chrome DevTools Protocol/DOM automation can control the actual Cursor UI, and
third-party tools demonstrate that it is possible. It requires Cursor to run
with a remote-debugging port, grants broad renderer access, and depends on
private DOM selectors that have repeatedly changed between Cursor releases.
That is not an acceptable production integration for Micro.

## Native Desktop Bridge discovered in Cursor

Cursor Desktop 3.16.17 already contained an internal, purpose-built Desktop
Bridge. Its own settings copy describes it as enabling the `cursor desktop` CLI
command to list and send messages to agent threads open in the desktop app.

The bridge is exactly the desired ownership model:

- list real local and cloud threads open in Cursor Desktop;
- return thread ID, title, source, status, last-updated time, and window ID;
- submit to an idle thread without focusing Cursor;
- queue a message behind a running turn;
- force-send a message to interrupt/steer a running turn.

The bridge uses protocol version 1 discovery records under:

```text
~/.cursor/desktop-bridge/*.json
```

Each record contains a process ID, Unix socket path, 64-character bearer token,
app name/version, user-data directory, and creation time. Requests are local
HTTP POSTs over the Unix socket:

```json
{ "type": "listThreads" }
```

```json
{
  "type": "sendMessage",
  "threadId": "...",
  "text": "lets do it",
  "force": false
}
```

The built-in client validates discovery files, ignores dead processes, limits
responses to 200 threads, and uses a 10-second request timeout. Known sources
are `local`, `cloud`, `draft`, and `claude-code`; known normalized statuses are
`idle`, `running`, `completed`, `error`, and `unknown`. Draft and Claude Code
threads are listed but are not sendable.

## Why implementation paused

The bridge requires both a server-side `desktop_bridge` feature gate and a
user-level `desktopBridgeUserEnabled` setting. On the machine investigated:

- Cursor Desktop was 3.16.17;
- the feature-gate mirror `cursor.desktopBridge.enabled` was `false`;
- the Beta setting **Desktop Bridge → Allow CLI to access desktop agents** was
  therefore hidden;
- `~/.cursor/desktop-bridge` did not exist;
- `cursor desktop` could not yet be exercised end to end.

Implementing against untestable bundled internals would be speculative. Wait
until the account receives the feature and use Cursor's CLI as the compatibility
boundary rather than copying its private socket implementation.

## Pickup checklist

1. Update Cursor Desktop to the latest version.
2. Open **Cursor Settings → Beta**.
3. Look for **Desktop Bridge → Allow CLI to access desktop agents**.
4. Enable it and fully quit/reopen Cursor as the setting requests.
5. Confirm that `~/.cursor/desktop-bridge` contains a live discovery record.
6. Run `cursor desktop ls --json` and verify that an open IDE conversation is
   returned with the same title and status.
7. Create a disposable IDE conversation, then use `cursor desktop send` with
   `--stdin --json` to send a harmless prompt. Confirm that the message and
   response appear in that exact IDE conversation without focus changes.
8. Repeat while a turn is running. Verify normal send queues and force-send
   steers or interrupts as documented by the CLI response.
9. Rename the conversation in Cursor and confirm the list result changes without
   reopening it.
10. Close/reopen Cursor and confirm IDs and discovery behavior remain stable.

Useful local gate diagnostic:

```bash
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
  "select key, value from ItemTable where key = 'cursor.desktopBridge.enabled';"
```

## Proposed adapter shape once enabled

- Add a `cursor-desktop` harness; never call it merely `cursor`, to distinguish
  it from CLI/ACP sessions.
- Treat Cursor Desktop as the owner. `listSessions()` maps `cursor desktop ls
  --json`; attaching wraps an existing thread and never creates one.
- Send prompt text through stdin, not shell arguments, using the built-in CLI's
  JSON mode.
- Poll thread metadata/status at a modest interval for title and lifecycle
  changes. Add hooks only if richer tool/thought distinction is materially useful;
  the bridge remains the control channel.
- Map `running` to active work and transitions from running to completed/error
  to Micro terminal events. Preserve last-seen status to avoid replaying old
  completions on startup.
- Keep `new` unavailable for this harness. The user creates the conversation in
  Cursor Desktop, then attaches it in the Control Room.
- Do not claim STOP parity until the native bridge exposes a dedicated cancel.
  Force-send is steering, not a semantic replacement for an empty cancellation.
- Add doctor checks for Cursor version, feature-gate setting, live discovery,
  and a successful JSON list operation.
- Keep persisted slot state namespaced by harness before supporting switching
  between Codex and Cursor, so one integration cannot overwrite the other's
  bindings.

## References

- [Cursor ACP documentation](https://prod.cursor.com/docs/cli/acp)
- [Cursor hooks documentation](https://prod.cursor.com/docs/hooks)
- [Cursor staff confirmation that IDE and CLI/ACP stores are separate](https://forum.cursor.com/t/local-ide-agent-chats-and-the-agent-cli-still-use-separate-session-stores/165486)
- [Cursor downloads](https://cursor.com/download)
