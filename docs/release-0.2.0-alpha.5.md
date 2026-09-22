# Native macOS preview v0.2.0-alpha.5

Configuration updates now write a private temporary file beside the target, sync
and close it, then atomically replace the target. A partial write, sync failure or
rename failure preserves the previous valid configuration. Updates preserve
existing symlinks and respect read-only files; dangling symlinks require repair.
Cleanup only removes temporary files created by that update.

Thirty-six new fault/recovery cases cover all five writers, retry, permissions,
symlinks, exclusive-create collisions and interruption before commit. This includes
all alpha.4 configuration-read guards and keyboard controls, and alpha.3 HTTP/IPC
and hosted-health privacy fixes.

Atomic replacement does not serialize concurrent read-modify-write operations.
An abrupt process exit or cleanup failure may leave a private temporary file;
power-loss durability is not certified by these tests.

Apple Silicon, macOS 14+. Unnotarized, ad-hoc signed alpha preview. No installed
app, running session, real hardware or user configuration was modified during QA.
See the burn ledger for commands, artifact verification and deferred manual gates.
