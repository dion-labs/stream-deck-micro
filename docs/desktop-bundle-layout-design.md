# Desktop executable layout compatibility — bounded follow-up

Baseline: alpha.8 source `2f9ac2f`, merged `7c40239`. Configuration transactions
are released and frozen. This follow-up changes discovery/identity handling only;
all tests use disposable fixtures or the existing isolated compatibility probe.
No installed state, live Desktop process, daemon or hardware may be changed.

## Evidence and scope

On 2026-09-28 the fixed legacy path
`/Applications/ChatGPT.app/Contents/Resources/codex` is absent. The installed bundle
instead contains `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`.
Its main application executable is still `Contents/MacOS/ChatGPT`. Explicitly
pointing the isolated integration suite at the nested CLI passes6/6. Default
verification/install still selects the absent legacy path. This does not prove
real Desktop app-tool authentication or installed shared-mode acceptance.

The chosen executable must come from a fixed allowlist inside the configured
Desktop application bundle. Never search PATH, accept arbitrary saved paths,
change the app bundle, or silently restart a process. Prefer the modern nested
layout, retain the legacy layout, and fail clearly if neither is an executable
regular file. Discovery occurs at operation time, not module import, so importing
Micro on CI or inspecting status does not require an installed Desktop.

## Identity and verification invariants

- Keep the legacy exported constant for source compatibility if needed, but move
  operational launch/version/fingerprint callers to one explicit resolver. Do not
  leave a mix of legacy launch and modern fingerprint defaults.
- Validate saved installation executable paths against the exact allowlist, not
  equality with whichever layout happens to be installed now. Existing legacy
  records must remain readable and distinguishable from verified modern records;
  arbitrary paths and prefix/lookalike paths remain rejected.
- Pin one selected executable for a compatibility attempt. Hash that executable
  and app.asar, run the isolated probe against that same executable, rehash, and
  confirm selection did not change before saving verification. A layout change
  during verification must fail closed, not approve a different binary.
- Automatic verification may update a saved executable path only after the new
  selected binary passes the existing compatibility checks and installation
  token/URL/generation checks still match. It must preserve the existing explicit
  reconnect/recovery boundaries; no running Desktop/bridge is restarted here.
- Bridge shared-mode authorization must bind the launched binary to the verified
  installation path and current fingerprint. Private fallback can use the current
  allowlisted binary with scoped shared environment removed. Preserve the existing
  prohibition on retry/replay after forwarding a request.
- Process classification and recovery may recognize either exact known path, but
  retain existing ancestry, endpoint, recorded runtime ownership and fresh process
  recheck requirements. Never broaden a process-name/PID match merely because a
  second path is now valid. If expanding recovery predicates increases risk, keep
  that portion conservatively blocked with a clear reason until independently
  qualified.

## Planned qualification

| Stable case | Expected result |
|---|---|
| SDM-047 discovery | Synthetic modern-only, legacy-only, both, absent, directory and non-executable fixtures select the intended known file or fail clearly; no PATH fallback or import-time failure. |
| SDM-048 verification | Old saved records remain readable; arbitrary/lookalike paths reject. Each probe/hash/save uses one pinned path. A layout or binary change during verification rejects without writing approval. Current nested binary retains6/6 isolated compatibility coverage. |
| SDM-049 process boundary | Synthetic process trees with both exact layouts preserve private/shared distinctions, wrong ancestor/endpoint/PID-reuse protections and no post-forward replay. No real signal, restart or launch-at-login mutation occurs. |

Before implementation, root should review the migration and process identity
boundary because they govern shared-control trust and recovery. This is a separate
review and release slot from alpha.8. After source/unit/isolated/full review, build
and qualify a new artifact with the shared resource lock; coordinate actual release
links only after publication. Native/current-account/physical acceptance stays in
`acceptance-checklist.md` until a coordinated manual window.

## Reviewed implementation scope, 2026-09-28

Root accepted bounded implementation after these clarifications:

- Modern recovery is unsupported. Preflight `recoverPrivateCodex` before any
  lifecycle effects; recognize a modern listener at the requested endpoint or a
  modern saved installation and refuse with an explicit manual-recovery message.
  Mixed modern/legacy listeners also refuse. Existing legacy signaling predicates
  remain byte-for-byte unchanged. Tests assert zero quit/open/uninstall/signal.
- Serialize all installation-record mutations with the existing canonical-directory
  kernel transaction helper. Writers are shared install, uninstall, native setup
  autoconnect, CLI autoconnect, and automatic verification. Final automatic commit
  acquires the lock, rereads and compares original token/URL/path/fingerprint/
  generation and autoConnect, then atomically replaces the record under that lock.
  No lock is held across the compatibility probe. Use fresh locked updates for
  autoconnect and locked deletion for uninstall; never write back a pre-lock record.
  This protects the record, not all surrounding launchd/config administrative effects.
  Controlled competing-process final-commit tests must qualify the actual helper.
- Fixed root is `/Applications/ChatGPT.app`. Reject a symlinked configured root,
  symlinked path components, or symlinked executable candidates. Regular executable
  modern candidate has priority. Only ENOENT allows legacy consideration; an existing
  invalid modern candidate fails closed, including a dangling symlink. Synthetic
  temp bundle roots are dependency injection for tests only, never saved allowlists.
- Resolve once per attempt. Pass the selected path explicitly to both hashes and
  probe; reselect before commit and shared launch. A fresh retry may select again,
  but cannot reuse earlier approval for another path. Saved-record migration occurs
  only inside the guarded final commit. Shared bridge rereads successful approval
  and binds it to its originally selected launch path and fingerprint.
- Generated passthrough launcher uses the same fixed priority and validates path
  components, avoiding a stale hardcoded legacy fallback after uninstall. It may
  refuse if the bridge/runtime is unavailable rather than bypass path validation.

Independent frozen implementation review and full bundled-artifact qualification
remain required. This scoped acceptance is not release qualification.
