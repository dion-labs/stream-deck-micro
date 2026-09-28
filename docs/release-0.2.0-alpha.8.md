# Native macOS preview v0.2.0-alpha.8

Configuration saves now acquire a macOS kernel lock before reading current
settings and hold it through the update and atomic commit. Concurrent cooperating
writers can no longer silently discard a completed change to an unrelated field.
A busy writer reports an explicit retry message; it does not block the event loop
or replay an administrative action. First-run native creation joins the same lock
and retains exclusive creation without overwriting an existing configuration.

The private, empty `.stream-deck-micro-config.lock` file stays in each configuration
directory. It is normal to see it after the app exits: the kernel tracks ownership
through the open descriptor and releases it on process death. Do not remove or
replace this file while a writer is running.

Physical auto-sleep settings now become current only after a successful save.
Post-commit descriptor cleanup errors emit a diagnostic while preserving the
successful save result and matching in-memory state. Descriptor close is not
retried after failure.

Validation covers actual competing processes, killed owners before and after
commit, first-run/save races, descriptor inheritance, permissions and injected
write/close failures. The final extracted archive runs the process suite with its
bundled Node and compiled configuration code, alongside existing browser/runtime
checks.

The protocol coordinates updated Micro writers on macOS. It does not merge
changes to the same field, synchronize all daemon memory, or coordinate older
versions/external editors that ignore its lock. Initial exclusive creation may
still leave invalid bytes after an interrupted first write; those bytes are
preserved and rejected for explicit repair. Atomic replacement retains its tested
write-failure protections; directory-fsync/power-loss certification is not claimed.

Apple Silicon, macOS 14+. Unnotarized, ad-hoc signed alpha preview. No installed
app, live session, real configuration or hardware was used in QA. Physical and
native lifecycle acceptance remain separate gates.

Compatibility note: a newly observed Desktop bundle layout places Codex in a
nested `CodexCLI.app`. Micro's default verification still targets the legacy
executable path and fails when only the nested layout exists. That resolver
follow-up is separate from this configuration release; installed Desktop
acceptance is not claimed here.
