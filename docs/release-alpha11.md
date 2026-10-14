# v0.2.0-alpha.11 — current Desktop startup flags and truthful status

Micro now recognizes the observed plugin-based Codex Desktop launch contract:
`features.code_mode_host=true` with
`plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true`.
Original arguments, including the code-review plugin override, are forwarded
unchanged; Micro appends its authenticated shared transport. Legacy inline MCP
startup remains supported. Unknown switches, explicit transports, duplicate
commands and contradictory enable flags stay private.

The Control Room now says “Compatibility checked — not connected” after an
isolated compatibility check. Passing that check does not establish a live
connection or guarantee a future launch. Active private sessions remain running;
full control requires Desktop to join the shared backend and restore bindings.
No automatic Desktop quit/restart or request replay is introduced.

Validation includes the installed Codex CLI using the observed plugin-based argv
with a harmless MCP fixture in isolated configuration: exact initialization bytes,
notifications, tool discovery and two clients resuming the same disposable task.
This does not exercise the real account, actual bundled plugin servers, hardware,
or active sessions. Live connection must be checked after a natural future launch.

Apple Silicon, macOS 14+. Ad-hoc signed, unnotarized prerelease. Existing modern
Desktop restart restrictions and older-launcher uninstall limitations remain.
