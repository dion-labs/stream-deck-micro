# Native macOS preview v0.2.0-alpha.3

This preview hardens the local Control Room and companion CLI request boundaries.
Unsupported HTTP methods cannot execute commands, command bodies must be JSON
objects, and hosted read-only health failures return a generic message without
private diagnostic text. Malformed IPC request values are rejected without
crashing the daemon, and invalid argument shapes cannot reach command handlers.

The release adds 28 regression cases and expands the risk registry to 37 stable
cases covering normal use, errors, recovery, privacy, and platform acceptance.

Validation on 2026-09-22: build and 263 tests passed; four optional bundled-server
cases also passed in a separate six-test isolated run; Marketplace 13 tests,
validator and packaging passed; native endpoint/navigation policy passed.
The native ZIP contains Node 22.22.3 and the Marketplace plugin installer.

Apple Silicon, macOS 14+. Unnotarized, ad-hoc signed alpha preview. No installed
app or running bridge was replaced during validation. Physical MK.2 key presses,
real Desktop reconnect/recovery, login, browser permissions/accessibility, and
clean install/upgrade acceptance remain manual gates. See the burn registry and
native install notes for exact procedures and boundaries.
