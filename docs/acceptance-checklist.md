# Stream Deck Micro — remaining acceptance checks

Current release candidate: **v0.2.0-alpha.9, native build 28**. These checks are **not
run** as of 2026-09-28. Schedule them when D can release the relevant hardware
and sessions; use fictional tasks and a disposable macOS profile where possible.
Do not restart the shared live bridge or Codex merely to execute this checklist.

Automated evidence and stable case definitions are in
[TOKEN_BURN_2026-09-22.md](TOKEN_BURN_2026-09-22.md). Source and extracted-artifact
checks cover software behavior; they do not establish the results below.

| Cases | Setup and procedure | Pass condition |
|---|---|---|
| SDM-001/003/014/030 | On a real MK.2 with a disposable task, test selection, one workflow, STOP, sleep and wake in HID and Marketplace modes. Also try unavailable or already-owned HID. | Correct target and exactly one action; first wake press consumed; HID brightness reaches zero and Marketplace keys black out; unavailable ownership is explained without terminating another owner. |
| SDM-005/011/026 | In a coordinated idle window, record the installed Codex build; verify compatibility and reopen into shared mode. Test app-tool peer authentication, same-session controls, focus/unread and recovery/private fallback. | Authentication, capabilities and actual session state agree; recovery preserves unrelated processes and never replays a forwarded action. |
| SDM-027 | In a disposable macOS profile, test login/restore with Desktop already running or restored, plus unavailable process inspection. | Existing Desktop/session is preserved; bridge reports the real capability rather than assuming shared control. |
| SDM-012/029/035 | On Apple Silicon macOS 14+, install alpha.9/build28 with Gatekeeper consent, import the plugin, quit/reopen, upgrade a disposable older alpha installation, then uninstall. Preserve a fixture configuration and assignments before upgrade. | Installed version/build matches; setup failures are actionable; upgrade retains fixture data; uninstall follows the documented scope. Archive signature checks alone do not pass this row. |
| SDM-015/037 | In the native WKWebView window, use keyboard and VoiceOver; hold Space across refresh, blur or change capability/assignment while held; try long labels and enlarged text. | Controls are named and operable; focus remains visible; a valid held press fires once and a stale press fires nothing; content remains reachable. |
| SDM-036 | With a disposable bridge and the exact hosted origin, grant and deny local-network permission in Safari, Chrome and Firefox. | Health or fallback truthfully matches permission/state; no silent mutation or sensitive information exposure. Synthetic interception does not pass this row. |
| SDM-009/033/038 | In installed UI, copy diagnostics containing fictional sensitive values. Repair a malformed fixture config following the visible error and retry. | Clipboard output is redacted; error/retry is understandable; unrelated fixture settings survive. |

For every result record date, app/OS/browser/device versions, fixture and source
revision, expected versus actual behavior, evidence location and cleanup. A
failure stays open with its exact reproduction; do not replace it with a unit-test
count.

## Current limits

- Alpha.8 serializes fresh read/modify/write transactions among
  cooperating updated Micro processes. Same-field replacement remains last writer
  wins; older versions and external editors do not follow the lock. No universal
  configuration merge or daemon memory synchronization is claimed.
- Interrupted first-time exclusive creation can leave invalid bytes; these are
  preserved for explicit repair.
- Process termination before rename can leave a private staging file. Power-loss
  durability has not been certified.
- Native alpha artifacts are ad-hoc signed and unnotarized.
- Hosted pairing/configuration remains a later roadmap phase; current hosted
  health does not authorize remote session mutation.
- Website changes prepared by the separate site worker are not a deployment.

- Published alpha.8 still assumes the legacy Desktop CLI path. The newer nested
  CodexCLI layout is an unreleased follow-up, not installed acceptance. Its candidate
  deliberately blocks automatic modern recovery before any quit/uninstall/signal;
  manual quit/reopen and upgrade/uninstall continuity require a coordinated window.
