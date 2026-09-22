# SDM sustained-work record — 2026-09-22

## Baseline and boundaries

Baseline revision: `e98c9ec46b29411a5e3fb27a63d5cd9b03dd0c83`. Preexisting status:

```text
clean
```

Preserve preexisting edits and user data. No installed application replacement, running-session restart, personal-account mutation or website deployment occurred. Synthetic/isolated automated tests do not certify hardware or account acceptance.

## Automated evidence

2026-09-22: npm run check passed: build; 235 tests passed, 4 bundled-binary integration tests skipped pending explicit isolated run. Raw local logs: `/tmp/dionlabs-burn-*.log`; durable counts recorded here because temporary logs may expire. No previous test result substituted for this current-tree baseline.

## Risk-based case register

Stable IDs below identify flow, failure, recovery and privacy requirements. Mapping names identify automated coverage, not proof that every manual procedure passed. All manual cases are **NOT RUN** this burn until a dated receipt is appended; hardware/account-dependent cases are **BLOCKED** without the designated disposable target/account.

| ID | Procedure / risk | Expected result | Automation / manual mapping |
|---|---|---|---|
| SDM-001 | Start with absent/unavailable HID or Elgato owning the deck | Actionable error; existing owner/session not terminated | deck.test.ts; manual MK.2 |
| SDM-002 | Restore fifteen persisted slots with active writer-held task | Owned sessions resume; externally owned remain monitor/navigation only | slotManager/adapter tests |
| SDM-003 | Send/stop workflow and receive completion/failure | State ends correctly; unavailable controls reject without false success | stateMachine/slotManager/deck tests |
| SDM-004 | Concurrent send or fast completion before waiter attachment | No duplicate turn or missed completion | adapter/rpc tests |
| SDM-005 | Disconnect/reconnect shared server mid-operation | Bounded recovery with truthful capabilities; no silent Desktop restart | sharedReconnect/sharedServer.safety tests |
| SDM-006 | Check saved task navigation versus live attached session | Navigation-only state never claims live controls | detachedSession/runtimeStatus tests |
| SDM-007 | Open local admin with foreign Origin or Host | Reject unauthorized mutation; loopback service remains private | admin/server.test.ts |
| SDM-008 | Read hosted health from allowed and foreign origins | Exact-origin redacted health only; no prompts/paths/session IDs leak | admin/server.test.ts |
| SDM-009 | Inspect diagnostic export and notification text using fictional task | Redacted structured support data; no private workflow content in health | runtimeStatus/notifications tests; manual export |
| SDM-010 | Edit layouts/workflows then restart disposable daemon | Valid configuration persists; invalid duplicate/out-of-range values rejected | slotManager/admin tests |
| SDM-011 | Invoke VERIFY CODEX against isolated temporary runtime | Only temporary server changed; current Desktop untouched | desktopCompatibility and integration tests |
| SDM-012 | Native launcher install/update in disposable target | Correct artifacts and version; no unsigned unexpected executable | native:test; manual signature/upgrade |
| SDM-013 | Exercise marketplace plugin reconnect and heartbeat | Versions/device counts truthful; stale plugin state ages out | marketplaceService tests; marketplace:validate; manual plugin |
| SDM-014 | Physical key actions and virtual deck configure/armed modes | Configure does not execute; armed action matches assignment once | deck tests; manual real MK.2 |
| SDM-015 | Keyboard/screen-reader and narrow Control Room navigation | Focus visible, controls named, error/recovery accessible | Manual browser accessibility |

## Deferred acceptance and next checkpoint

Run mapped manual flows using synthetic data and isolated profiles; record actual device/runtime versions and outcome per ID. Never replace a physical/account gate with a unit count. Release-eligible changes require built/validated artifacts and GitHub release coordination; documentation-only baseline creates no package release. Next: finish portfolio baseline, inspect vision-defined gaps and execute a concrete milestone with impacted checks.

## Dedicated worker resume — 2026-09-22

Start: `e98c9ec46b29411a5e3fb27a63d5cd9b03dd0c83`; only dirty path was this inherited, untracked ledger. Baseline log `/tmp/dionlabs-burn-deck.log` dated Sep 22 08:38:30 matches unchanged tracked source: 26 files, 235 passed, 4 skipped. Reused after source/status verification. Current authoritative scope: README and hosted roadmap; early journal layout/edition decisions are historical. Voxta excluded.

Expanded risk registry: P0 = unauthorized action/privacy/session loss; P1 = broken core flow/recovery; P2 = presentation/platform compatibility. Existing SDM-001 through SDM-015 stay stable. Automated mappings below are coverage targets, not claims of execution; outcomes appear in checkpoint receipts. Manual cases remain NOT RUN.

| ID | Priority / class | Procedure | Expected outcome | Mapping / acceptance |
|---|---|---|---|---|
| SDM-016 | P0 / error | Wrong Host with valid token; foreign and lookalike Origin | 403 before any daemon dispatch | admin/server.test.ts; synthetic HTTP |
| SDM-017 | P0 / recovery | Reuse token from closed server on fresh instance | 401; newly issued token works | admin/server.test.ts; synthetic HTTP |
| SDM-018 | P0 / error | HEAD/DELETE/PATCH/OPTIONS to stop with valid token | 405, zero actions | admin/server.test.ts; synthetic HTTP |
| SDM-019 | P1 / error | Malformed JSON, non-object JSON, wrong content type | 400/415; no dispatch; next valid request succeeds | admin/server.test.ts; synthetic HTTP |
| SDM-020 | P0 / privacy | Hosted status getter throws a private path/prompt | Generic failure; no private exception exposed | admin/server.test.ts; synthetic HTTP |
| SDM-021 | P0 / privacy | Hosted health contains malformed states, private versions and extra fields | Strict allowlist, safe fallback, no secret fields | admin/server.test.ts; synthetic HTTP |
| SDM-022 | P0 / error | Unauthenticated/wrong-token shared WS clients | Connection rejected before access | desktopBridge.integration.test.ts opt-in |
| SDM-023 | P1 / happy | Two isolated clients resume same durable fixture | Same ID/path, tool discovery, preserved initialization bytes | desktopBridge.integration.test.ts opt-in |
| SDM-024 | P1 / recovery | Resume history exceeding WS limit with excludeTurns | Metadata resume succeeds without increasing payload limit | desktopBridge.integration.test.ts opt-in |
| SDM-025 | P0 / recovery | Transport fails before versus after forwarded request | Pre-forward fallback allowed; post-forward no replay | desktopBridge.test.ts; automaticVerification.test.ts |
| SDM-026 | P0 / recovery | Recover while unrelated process owns target port | Never kill unrelated process; check exact identity before escalation | desktopRecovery.test.ts; sharedServer.safety.test.ts |
| SDM-027 | P1 / platform | Login autoconnect while Desktop already running / process inspection fails | Existing Desktop left untouched | desktopAutoconnect.test.ts; manual login on disposable macOS profile |
| SDM-028 | P0 / platform | Native window navigation to external host, credentials or different port | Invalid endpoint/navigation rejected | native/tests/PolicyTests.swift; native:test |
| SDM-029 | P1 / happy | Native setup with missing dependencies and bridge install failure | Actionable stage failure; no false readiness | nativeSetup.test.ts; manual fresh Apple Silicon macOS 14+ |
| SDM-030 | P1 / platform | Compare Marketplace and HID sleep/wake | Black plugin keys vs zero HID brightness; first key consumed | deck.test.ts; marketplace/render.test.ts; manual MK.2 |
| SDM-031 | P1 / recovery | Focus/unread storage missing or unknown format | Preserve selection/attention; no spurious workflow | focus.test.ts; unread.test.ts |
| SDM-032 | P1 / happy | Swap session assignments among fifteen positions | Distinct slot binding and labels retained | slotManager.test.ts; deck.test.ts; manual Control Room |
| SDM-033 | P0 / privacy | Export diagnostics with fictional paths/prompts/token | Sensitive values absent; useful component status remains | runtimeStatus.test.ts; manual clipboard inspection |
| SDM-034 | P1 / recovery | IPC malformed messages, broken connection, timeout | No daemon crash; explicit bounded failure; subsequent request succeeds | Coverage gap: src/ipc.ts; disposable child fixture required |
| SDM-035 | P1 / platform | Artifact install/update/uninstall in disposable profile | Version/checksum/signature match; saved assignments preserved | native package validation + manual macOS upgrade |
| SDM-036 | P2 / platform | Safari/Chrome hosted connect denied and granted | Truthful read-only health or usable local fallback; no silent mutation | Manual browser permission matrix; deck-site coordination |
| SDM-037 | P2 / accessibility | Keyboard-only narrow window, focus, labels, dialogs | Operable controls, visible focus, readable failure/recovery | Manual Control Room + native accessibility |

Every manual receipt must state date, app/OS/device versions, fixture, action, expected versus actual result, and cleanup. Test automation may not substitute for the physical, login, signed-artifact or browser permission gates.

### Checkpoint: boundary hardening and isolated platform verification

- `npm test -- src/admin/server.test.ts`: 29 passed after fixes; original added regressions had 10 failures. Unsupported methods now rejected, JSON object required, unpaired hosted-health exceptions become generic 503. Raw before/after logs `/tmp/dionlabs-burn-deck-http-{before,after}.log`.
- `npm --prefix marketplace test`: 13 passed; `npm run marketplace:validate`: validator successful. Logs `/tmp/dionlabs-burn-deck-{marketplace,validator}.log`.
- Heavy-lock `npm run native:test`: endpoint/navigation policy passed (`/tmp/dionlabs-burn-deck-native.log`).
- Heavy-lock `env SDM_TEST_CODEX=/Applications/ChatGPT.app/Contents/Resources/codex npm test -- src/desktopBridge.integration.test.ts`: 6 passed including all four previously skipped bundled integrations. Reviewed isolated environment allowlist, temporary fixture storage, ephemeral authenticated endpoint, exact owned-child cleanup first. No real Desktop/model/tool execution. Log `/tmp/dionlabs-burn-deck-integration.log`.
- SDM-034 now has `src/ipc.test.ts`: disposable child tests reproduced JSON null crashing daemon and array args reaching handler (2 failures /9 tests); input object checks added, validation pending. No production socket touched.
- Root release coordination requested for alpha.3; site informed of schema contract. Native artifact build/publish and exact release links remain outstanding.

### Checkpoint: release candidate validated

- IPC focused suite: 11 passed; malformed requests and argument shapes reject with structured errors and subsequent requests succeed. Synthetic Unix socket mode is 0600.
- `npm run check`: TypeScript build, 27 files, 263 passed /4 opt-in skipped. Separate opt-in run above covers the four skips. `/tmp/dionlabs-burn-deck-check.log`.
- `npm run marketplace:pack`: validated installer generated. Native heavy-lock `npm run native:release`: alpha.3 ZIP, build 22, Node 22.22.3, bundled imports and strict signature passed. `/tmp/dionlabs-burn-deck-{pack,release}.log`.
- `python3 scripts/verify-native-artifact.py`: fresh temporary ZIP extraction; SHA256, strict deep signature, version, bundled plugin, actual bundled Node HTTP method/body/privacy regressions passed. Script is retained for future releases. `/tmp/dionlabs-burn-deck-artifact.log`.
- ZIP SHA256: `91501a17a20034dbd4110b1c9c3a2c936498c7359d1d49c5bd9f3b9ce0b0ee46`.
- Root granted exclusive alpha.3 release slot. No installation, Desktop/bridge restart, hardware access or website deployment. Release upload and site handoff next.

### Checkpoint: alpha.3 publication and configuration preservation

Alpha.3 published at https://github.com/dion-labs/stream-deck-micro/releases/tag/v0.2.0-alpha.3 ; ZIP + SHA256SUMS uploaded. GitHub API digest matches local SHA256; tag resolves to `d6e2a3958f3fedc50ed93d627a55be08572b1149`. PR #18 merged after bridge/Marketplace CI passed, merge `556388c59080470fd55c9040d79f7c06ab602c3f`. Deck-site acknowledged updated local links and validation, explicitly no deploy/push.

Continued SDM-010: 22 synthetic config tests reproduced six failures: workflows/settings/layout writes overwrite malformed JSON or non-object configs. All five config mutators now use one fail-closed read helper: only ENOENT permits creation; unreadable/invalid/non-object contents reject before any write. Unrelated keys and 0600 permissions remain preserved; endpoint removal keeps sibling keys. Initial focused expanded suite 34 passed; primitive matrix and bundled-artifact preservation checks added next. Root alpha.4 release slot requested.

Browser acceptance remains NOT RUN: CUA iab unavailable and browser inventory empty. Read-only synthetic demo started for this check and only its exact owned PID was terminated afterward; production bridge untouched.

Additional stable case **SDM-038 (P0, error/recovery/privacy)**: using temporary files, save workflows/settings/layout/shared endpoint/edition over malformed JSON, arrays and primitive values. Expected: reject before write and preserve exact original bytes; after manual repair, save succeeds and unrelated keys remain. Mapping: `src/config.test.ts` (54 cases covering this and SDM-010/loopback/layout boundaries), `scripts/verify-native-artifact.py` bundled runtime smoke. No production configuration edited. Focused suite passed 54/54; alpha.4 full check passed 317/317 with four default opt-in skips backed by the earlier isolated run. Config before/after logs `/tmp/dionlabs-burn-deck-config-{before,after}.log`; full log `/tmp/dionlabs-burn-deck-alpha4-check.log`.

### Checkpoint: isolated browser and keyboard acceptance

Root reserved alpha.4 and explicitly provided/authorized isolated headless Chrome via the existing Playwright installation. This resolved the earlier CUA-only blocker without accessing a real browser profile. `scripts/test-control-room.mjs` covers 15 keys; safe configure; single armed STOP + error feedback; reload disarm; navigation-only disables live controls; 390px layout; no browser exceptions. All passed.

SDM-015/037 keyboard extension initially failed because virtual keys were divs. They are now native named buttons with Enter/Space activation, Tab navigation, visible focus, and stable focus across polling. Non-action recovery keys are disabled. Same isolated browser harness now verifies actual Tab navigation, Enter in Configure causes no command, Space in Live sends one STOP, and focus stays on the same key after its DOM node is replaced by polling. Log `/tmp/dionlabs-burn-deck-keyboard-before.log` records the DIV-versus-BUTTON failure; `/tmp/dionlabs-burn-deck-browser.log` records passing checks. Synthetic screenshots: shared `evidence/deck-product-desktop.png` and `evidence/deck-product-narrow.png`. Native VoiceOver and Safari/platform checks remain unrun.

Command: `SDM_PLAYWRIGHT_MODULE=/Users/deathcodevision/dev/dionlabs/projects/oss/deskmux.dionlabs.ai/node_modules/@playwright/test/index.mjs SDM_BROWSER_EVIDENCE_DIR=/Users/deathcodevision/dev/dionlabs/qa/token-burn-2026-09-22/evidence node scripts/test-control-room.mjs`. Playwright 1.55.1 with installed Chrome, ephemeral profile. No user state or live hardware/control endpoints touched. Alpha.4 artifact is being rebuilt to include the keyboard fix; pre-keyboard candidate is not published.

### Independent held-key review and correction

Root reviewer reproduced a P2 accessibility race before alpha.4 publication: native Space keydown followed by status polling destroyed the pressed button; keyup then failed to send STOP despite focus restoration. Added exact regression, reproduced failure in `/tmp/dionlabs-burn-deck-held-before.log`, fixed by deferring deck replacement while Space is held and flushing newest status after native keyup activation. Blur/window blur releases the deferral; moving focus cancels activation. The browser harness now proves held-across-poll single dispatch and blur cancellation, alongside keyboard/focus/reload/recovery/narrow-scroll checks. `/tmp/dionlabs-burn-deck-browser.log` passes. Native ZIP must be rebuilt after this change; artifact verifier can now run the same browser harness against the extracted runtime via optional `SDM_PLAYWRIGHT_MODULE`.

Held-key follow-up also covers capabilities being disabled and assignment changing while Space is down. A captured action/target context guard cancels stale keyup activation, with visible feedback and zero extra commands; current server-side validation is unchanged. Synthetic browser suite passes all three hold cases plus focus-blur cancellation. Root separately confirmed 54 config tests pass. Existing non-atomic config write failure/concurrent-writer risk is acknowledged as a follow-on milestone, not claimed fixed by the read guard.

### Final alpha.4 candidate receipt

`npm run check`: build +317 passed /4 default opt-in skips (same integration code already exercised by isolated 6/6 run). Native heavy-lock rebuild included all final held-key guards. `SDM_PLAYWRIGHT_MODULE=.../node_modules/@playwright/test/index.mjs python3 scripts/verify-native-artifact.py` passed checksum, extracted strict deep signature, package version, bundled plugin, actual bundled Node HTTP/privacy/config regressions, and full isolated browser suite against that extracted runtime. Final alpha.4 SHA256: `cf55a00edfaab76262e69a283cfa00e63d28c81fe676269f679400dd59baaf7e`. Build 23. Logs `/tmp/dionlabs-burn-deck-alpha4-{check,release,artifact}.log`. Pre-keyboard candidates were replaced locally and never published.

### Exact deferred post-burn acceptance

- **SDM-001/003/014/030, physical MK.2:** use disposable task; select key, run workflow once, STOP an active turn, sleep and ensure first wake press is consumed; compare real HID brightness zero versus Marketplace blackout. Deferred because shared hardware/Elgato ownership and live sessions cannot be interrupted.
- **SDM-005/011/026, real Desktop integration:** at coordinated idle window, verify exact installed build, reopen into shared mode, test real app-tool peer authentication, same-session control/state, focus/unread synchronization, crash recovery and private fallback. Isolated fixtures do not prove real peer authentication or Desktop lifecycle.
- **SDM-027, login/restore:** on disposable macOS user/profile, reboot/login with Desktop already running/restored and with unavailable process inspection; existing session must remain untouched. Deferred because no login/restart authorized during burn.
- **SDM-012/029/035, native install/upgrade:** fresh Apple Silicon macOS 14+ profile; Gatekeeper consent, setup/plugin import, quit/reopen, upgrade from alpha.2/3, uninstall; preserve saved assignments/config and report version/build 23. Archive/signature checks do not prove installed lifecycle; no running bundle replaced.
- **SDM-015/037, native accessibility:** WKWebView + VoiceOver and keyboard-only real window, held Space through polling, focus loss/capability changes, long labels and text scaling. Headless Chrome passed; native assistive-technology acceptance is still unrun.
- **SDM-036, real browser permission:** Safari/Chrome/Firefox local-network permission granted/denied against disposable bridge, exact hosted origin, truthful fallback and no sensitive exposure. Product Chrome loopback fixtures and site synthetic interception do not prove OS/browser permission dialogs.
- **SDM-009/033/038, local UX acceptance:** fixture-only clipboard diagnostic inspection and config repair after visible invalid-file error in installed UI; ensure no secret text appears and retry preserves unrelated settings. Underlying redaction/read preservation automated; actual clipboard/native form flow unrun.

Outstanding code risk for next milestone: existing direct writes can truncate a previously valid config on disk-full/write failure, and separate-process read-modify-write can lose updates. Root identified this preexisting issue; alpha.4 read guards do not claim atomic/concurrent persistence safety.

### Alpha.4 release receipt and independent atomic milestone

Root independent review passed c68cdfa, including held Space across two polls and blur/capability/assignment cancellation; publication hold explicitly cleared. PR19 merged green at `8afd6a023e32bc90451aa1644e17d447c32e18e7`. Alpha.4 published with both assets; GitHub API ZIP digest exactly `cf55a00edfaab76262e69a283cfa00e63d28c81fe676269f679400dd59baaf7e`; tag `c68cdfa4e872220138c5f5ac37be109edb8d373e`. Site independently verified release, updated local links and passed Chrome/Firefox/WebKit link tests; no deployment/push.

New branch `codex/config-atomic-save` from 8afd6a0. **SDM-039 (P0, error/recovery/privacy/platform)**: inject partial write/ENOSPC, fsync or rename failure into each of five config writers; expected old bytes and permissions intact, owned temp cleaned, retry succeeds. Also preserve existing symlink targets and read-only files, refuse dangling symlinks, never delete a staging file that exclusive creation failed to own. Owned-child pre-commit termination must preserve original; private orphan stage is allowed. Mapping `src/config.atomic.test.ts`: first 30-case run reproduced 20 failures in old code; expanded final 36 atomic cases plus 54 config cases pass (90 total). Raw logs `/tmp/dionlabs-burn-deck-atomic-{before,after}.log`.

Implementation writes a private exclusive same-directory staging file, fsyncs and closes it, then renames onto the actual target, preserving user symlinks and read-only protections. Only owned temporary files are cleaned; a process crash or cleanup failure may leave private staging. This is atomic replacement, not multi-process read-modify-write serialization or a tested power-loss guarantee. Root reserved alpha.5 slot and assigned independent review; new artifacts will be separately built/verified before publication.

### Alpha.5 final candidate receipt

Root independent review passed 90 config/atomic cases and a relative cross-directory symlink scenario; no blocker, publication cleared after final checks. `npm run check`: build,29 files,353 passed /4 default opt-in skipped; same-burn isolated integration covered those four against unchanged integration code. Native alpha.5/build24 built under resource lock. Extracted strict signature, exact configured version/build, ZIP checksum, bundled plugin, malformed-config/HTTP privacy checks, injected partial writes across all five actual bundled writers, and full isolated Chrome held-key/gating suite PASS. Logs `/tmp/dionlabs-burn-deck-alpha5-{check,release,artifact}.log`.

Alpha.5 ZIP SHA256 `9ec3d7988f1f7bc85b31d722cbce8d36fbd9fa6c3a47b3450b8a7250d884da21`. Exact build verification now compares against the release builder rather than accepting any numeric build. Source and artifacts are ready for PR/CI/publication; alpha.4 remains the published release until that step completes.

### Ready recap at this checkpoint

38 initial flow/platform cases plus SDM-039 atomic-failure coverage are recorded. Completed milestones: HTTP method/body/privacy hardening; malformed IPC recovery; invalid-config preservation; native keyboard/focus/held-key controls; atomic write-failure preservation; reusable extracted-artifact and isolated browser QA. Unit coverage grew from235 to353; Marketplace13 and native policy pass, opt-in bundled integration6 pass. Alpha.3 and alpha.4 are published/merged with coordinated site-local links; alpha.5 candidate validated. Exact physical/native/login/permission/clipboard gates above remain unrun; no live restart/install/hardware, production backend or website deployment occurred. Concurrent read-modify-write remains an acknowledged separate risk.

### Alpha.5 release receipt and transport milestone

Alpha.5 published at https://github.com/dion-labs/stream-deck-micro/releases/tag/v0.2.0-alpha.5 ; PR20 merged green at `627df51541e08ea13ae88994abb429b5e38f963a`, source bd8d5ea. Uploaded ZIP API digest matches `9ec3d7988f1f7bc85b31d722cbce8d36fbd9fa6c3a47b3450b8a7250d884da21`; both assets uploaded. Deck-site independently checked release/checksum/size, updated only local links and passed affected three-engine link/layout checks; no deploy/push.

New `codex/ipc-transport-recovery` from627df51: **SDM-040 (P1 happy/platform)** fragmented valid UTF-8 must preserve exact accent/emoji/CJK text in requests and responses; **SDM-041 (P1 error/recovery)** early/truncated EOF rejects immediately, silent peers time out and subsequent calls recover, invalid cyclic arguments reject without transmission. `src/ipc.test.ts` + `src/ipc.client.test.ts`: first17 tests reproduced4 failures (both Unicode directions and two EOF cases); final22 pass with 2/3/4-byte boundaries and cyclic argument coverage. Logs `/tmp/dionlabs-burn-deck-transport-{before,after}.log`.

Both socket ends now use streaming UTF-8 decoding; client completion has one settled cleanup path that clears its timer, destroys its socket and rejects unexpected close. No command replay or retry was added. Artifact verifier extended to reproduce fragmented traffic/EOF using the actual extracted runtime and owned fixture sockets. Root alpha.6 release slot/review requested; no production socket accessed.

### Alpha.6 final candidate receipt

Root reserved alpha.6 and independently passed22 focused transport tests plus actual one-byte-at-a-time Unicode response traffic. Source ipc.ts SHA256 `36ae801addae75fece80e5b34c2b19d8bfe85738ef6c55de36569ecbdfb9b9b1` matches reviewed candidate. Full check:30 files,364 passed /4 default opt-in skipped, with the unchanged optional integration covered earlier in this burn. Native alpha.6/build25 built under resource lock; extracted exact version/build, strict signature, plugin and checksum passed. Actual bundled-runtime fragmented UTF-8 requests/responses and early EOF passed alongside existing malformed-config/partial-write/HTTP/privacy and full browser regressions. Logs `/tmp/dionlabs-burn-deck-alpha6-{check,release,artifact}.log`.

Final ZIP SHA256 `8399746c0d2c8ec79f487432af204247c0e4e1e9fe9e4fe2da1f267c20c4de2a`. Ready for PR/CI/release/site handoff; no live app/session/hardware or user data touched. Future CLI argument review identified an untested coercion risk (NaN serializes as null, daemon Number(null) becomes0), to investigate separately without changing this frozen transport artifact.

### Alpha.6 publication and invalid-slot milestone

Alpha.6 published; PR21 merged `46923fa9bead9c95f6164aa2b575e66e542e4d0f`, bothCIgreen. Source4a1d301/build25, uploaded ZIP/checksum digest `8399746c0d2c8ec79f487432af204247c0e4e1e9fe9e4fe2da1f267c20c4de2a` verified. Site independently checked release/downloaded checksum, updated local links and bounded transport copy, passed three-engine affected link/layout checks; no deployment.

New branch `codex/strict-slot-arguments` from46923fa. **SDM-042 (P0 error/target safety)**: invalid CLI slots must reject before dispatch; shared HTTP/IPC indexed commands must reject null, booleans, strings, arrays, fractional/nonfinite/out-of-range values rather than Number coercion. Optional clear/attach omission stays valid; human1/15 map exactly to internal0/14; status uses human numbering. Actual CLI subprocesses with child-only disposable HOME and fake Unix daemon reproduced21 failures in29 cases. `/tmp/dionlabs-burn-deck-slots-wire-before.log` records real transmitted `index:null` for bad select/clear/rename. No live bindings accessed.

CLI now validates decimal1..15 first and fixes the zero-based status header. One shared pre-dispatch validator covers select/open/clear/rename/swap/attach/virtual-key with separate session/device capacity. Focused29CLI+26boundary cases pass (55 total); raw `/tmp/dionlabs-burn-deck-slots-{before,after}.log`. Artifact verifier extended with bundled CLI no-dispatch proof and compiled shared null guards. Root alpha.7 slot/review requested. Prior released artifacts remain immutable.


### Alpha.7 reviewed artifact receipt

Independent review cleared exact source: commandIndices.ts SHA2561ad54e039fe728569ed25f293d0abfcedf8b613066de3f76dbb5250c3ebaab05, main.ts bf5d0b3f68f52de39e41144171534a0f9457722b6b6d25ab667466225ebd68ce, CLI813c82189c300990c7a3dbe8c871ef0cd159e131dc109538f8077f73ff9510c4. Independent55focused pass. Full419pass/4opt-in skips; unchanged optional6 previously passed in isolated HOME. Nativealpha.7/build26 resource-wrapped build succeeded; extracted exact version/build, strict signature, plugin, config fault preservation, fragmentedIPC/EOF, HTTPprivacy, actual bundledCLI invalid-no-dispatch and15→14 plus compilednull guards and full syntheticChrome controls all pass. Logs `/tmp/dionlabs-burn-deck-alpha7-{check,build,artifact}.log`. ZIP SHA256 `3a2909ca7bffc0cae9fab8116d3ea2336e96c4f24b649c92551d21e5a089c917`. Next PR/CI/publish/site receipt. No live app/session/hardware/userdata changed.
