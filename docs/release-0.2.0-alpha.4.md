# Native macOS preview v0.2.0-alpha.4

Saving workflows, device settings, or layouts previously replaced malformed
configuration files with partial defaults. All five configuration writers now
reject unreadable, malformed, or non-object existing configuration before writing,
preserving the original contents for recovery. Missing files can still be created;
unrelated settings and private file permissions remain intact.

Virtual deck keys now support Tab, Enter, and Space, with visible focus that
survives status polling. Holding Space through a poll retains one activation;
focus, capability, or assignment changes safely cancel it. Inert recovery keys are disabled. Configure remains the
default and reload always disarms live controls.

This release includes the alpha.3 HTTP/IPC boundary and hosted-health privacy fixes.
It adds 54 synthetic configuration cases and tests preservation inside the extracted
native artifact using its bundled Node runtime. An isolated Chrome harness verifies
keyboard/focus behavior, configure safety, single armed STOP dispatch, visible
errors, reload disarming, navigation-only disabling, and narrow layout.

Validation: TypeScript build and 317 tests passed. The four opt-in bundled-server
cases were separately verified in the same burn against unchanged integration code.
Marketplace tests/validator/package and native policy results are unchanged from
alpha.3. See the burn ledger for commands and artifact verification receipts.

Apple Silicon, macOS 14+. Unnotarized, ad-hoc signed alpha preview. No installed app,
running bridge, real sessions, or user configuration was modified during testing.
Physical key actions, live Desktop recovery/login, clean install/upgrade, browser
permissions, and accessibility remain manual acceptance gates.
