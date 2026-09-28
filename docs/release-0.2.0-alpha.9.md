# Native macOS preview v0.2.0-alpha.9

Native build 28.

This preview recognizes both supported Codex Desktop CLI layouts: the newer nested
`CodexCLI.app` executable and the older `Contents/Resources/codex` executable.
Discovery uses fixed bundle paths, rejects symlinks and invalid preferred files,
and never searches PATH. Verification fingerprints and probes the selected binary;
shared launch requires approval for that same path and fingerprint.

Automatic verification can migrate a legacy installation record after successful
checks. Its final comparison and save now share a kernel file lock with setup,
autoconnect updates and uninstall. A concurrent installation change rejects stale
approval; the expensive compatibility probe does not hold the lock.

Automatic recovery for the newer Desktop layout is deliberately unavailable. Micro
refuses before quitting Desktop, uninstalling shared control or signaling a process.
When work is idle, quit Desktop yourself and use the normal verified launcher.
Legacy listener signaling has not been expanded to the newer executable path.

Newly generated launchers use the validating bridge for private passthrough after
uninstall. If its runtime is missing, the launcher reports that repair is required.
Older on-disk launcher scripts remain unchanged until explicit setup/reinstall;
installed upgrade/uninstall continuity still needs the manual acceptance window.

## Validation and limits

- Source build and full suite: 514 passed, four default opt-in skips covered by the separate isolated
  CLI suite. Includes exact path/selection/approval races and recovery refusal.
- Six actual competing-process tests cover installation commit contention,
  stale approval rejection, and concurrent deletion/replacement during a probe.
- Current isolated nested CLI: six tests passed, including real isolated shared startup.
- Extracted native ZIP: all 23 bundled process tests pass (17 configuration and six
  installation-approval cases), plus compiled resolver/recovery checks, Control Room
  browser controls, strict signature, exact version/build and checksum checks.
- Independent source review and narrow caller-order rereview passed. Modern recovery
  refusal precedes connection teardown, installation and restart effects.

No running Desktop session was restarted and no installed configuration, real
account or hardware was used as a test fixture. Native installation, login restore,
Desktop app-tool authentication, VoiceOver and physical Stream Deck acceptance
remain listed in `docs/acceptance-checklist.md`.

The app remains an Apple Silicon macOS preview, ad-hoc signed and unnotarized.
Cooperating same-version writers follow the lock; old versions and external editors
do not. This does not make all setup/uninstall administrative effects transactional.
