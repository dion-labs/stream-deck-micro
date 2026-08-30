# Stream Deck Micro 0.1.0.5

## Marketplace release notes

- Clearly distinguishes **Live control** from **Navigation only** operation.
- Shows saved navigation-only session keys in a dedicated teal state instead of
  presenting them as idle live sessions.
- Marks workflow, stop, and attach actions as **LIVE OFF** when shared session
  control is unavailable.
- Shows immediate on-key feedback when an unavailable action is pressed.
- Reports plugin, Stream Deck application, connected-device, and visible-key
  health to the local Control Room.
- Adds a redacted diagnostic report for faster setup and support troubleshooting.

This release does not automatically enable or reinstall experimental Codex
shared control. Existing saved session assignments remain available for Codex
task navigation while live control is unavailable.

## Deployment note

A new Elgato Marketplace plugin upload **is required**. The heartbeat and key
rendering changes are part of the plugin payload as well as the local bridge.
The local bridge must also be rebuilt/reinstalled so both sides understand the
new status contract.
