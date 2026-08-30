# Marketplace or Independent?

Stream Deck Micro has two surfaces over one local core. Session attachment,
prompt injection, status transitions, attention acknowledgement, automatic
sleep timing, workflows, persistence, CLI commands, and the Control Room are
implemented once in the local bridge. Choosing an edition changes who owns and
renders the Stream Deck, not what your keys can do.

## Marketplace edition

Choose this when you want Stream Deck Micro to behave like a conventional
Elgato plugin.

- The Elgato app owns the hardware and hosts the signed plugin runtime.
- An editable bundled profile places all fifteen position-aware Surface Key
  actions automatically.
- The plugin renders live SVG keys and forwards presses over a private Unix
  socket to the local bridge.
- A per-user LaunchAgent starts and restarts the bridge in the background.
- Selecting a key in Elgato shows connection state, its position role, and links
  to the Control Room and setup guide.
- Automatic sleep, attention-only mode, status wake, and first-press swallowing
  have feature parity with the Independent edition.

The documented Elgato plugin API does not expose device-wide brightness. The
plugin therefore renders all of its keys pure black while asleep. Other profiles
and Elgato UI remain under Elgato's control.

## Independent edition

Choose this when you prefer the smallest runtime stack or need true hardware
sleep.

- Stream Deck Micro talks to the MK.2 HID device directly.
- The Elgato app must be fully quit while the daemon is running.
- Sleep sets hardware brightness to zero.
- The 5×3 layout is managed entirely by the project rather than an Elgato
  profile.
- The daemon runs in the foreground unless you create your own service.

## Switching safely

From Independent to Marketplace:

```bash
# Stop the foreground daemon first, then:
stream-deck-micro marketplace install
```

Open the Elgato app and install the bundled profile. The installer preserves
all session state, workflows, and unrelated configuration.
It does not install shared Codex mode or restart Desktop. Configure shared
control separately with `shared install`, then quit Desktop and use `shared open`.

From Marketplace to Independent:

```bash
stream-deck-micro marketplace uninstall
```

Then quit the Elgato app and run `stream-deck-micro start`. Uninstalling the
Marketplace bridge does not remove the shared Codex App Server, because both
editions use it.

## Security and comfort

Both editions keep the bridge, Control Room, Unix socket, and shared Codex App
Server on the local machine. Neither edition adds an approval layer: workflows
run with the Codex sandbox and approval settings in your configuration. The
Marketplace edition offers the familiar Elgato lifecycle and profile editor;
the Independent edition removes Elgato's runtime from the control path.
