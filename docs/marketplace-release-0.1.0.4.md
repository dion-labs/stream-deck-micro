# Stream Deck Micro 0.1.0.4

## Maker Console release notes

- Added a fail-safe **RECOVER CODEX** action when shared control is unhealthy.
  It disables Micro shared mode and reopens Codex Desktop privately, preserving
  saved deck bindings so Desktop remains usable while the integration is
  investigated.
- Added a separate **RETRY SHARED** action for users who want to attempt the
  verified shared-session connection again.
- Added clear **RECOVERING** and **READY · PRIVATE** states. Normal session and
  workflow controls remain disabled throughout recovery.

## Deployment

This release changes Marketplace key rendering and therefore requires a new
`.streamDeckPlugin` upload. Maker Console currently prevents uploading another
version while 0.1.0.3 is under review; wait for that review to finish, then pack
and upload 0.1.0.4. The local Micro bridge must be updated at the same time.

Older plugin builds still forward the center recovery press to the new bridge,
so the fail-safe remains usable, but they display the previous RESTART/UPDATE
label and do not show the separate RETRY SHARED key.
