# v0.2.0-alpha.12 — preserve Desktop host routing

Micro previously set CODEX_APP_SERVER_FORCE_CLI=1 for the whole Desktop app.
On the current Desktop this also overrides its separate durable host's WebSocket
routing. That host consequently starts another local backend, collides with the
shared port, and falls back privately. Its failure record can hide the already
connected local backend from Micro.

Launches now explicitly use FORCE_CLI=0 and leave CODEX_APP_SERVER_WS_URL alone.
CODEX_CLI_PATH continues to wrap the local backend. Opening the native launcher
or dashboard reapplies these GUI defaults when automatic connection is enabled,
including after login. Existing Desktop processes are never restarted.

Source tests and extracted-runtime checks cover the routing arguments and GUI
settings. The current Desktop source and logs establish the routing conflict;
a future natural launch is still required for live durable/local coexistence
acceptance. Multiple independently launched local shared backends are not
supported; this release does not merge them or recover overwritten credentials.

Apple Silicon, macOS 14+. Ad-hoc signed, unnotarized prerelease. No active session
restart or request replay is introduced.
