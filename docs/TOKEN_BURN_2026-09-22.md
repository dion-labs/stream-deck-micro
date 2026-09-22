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
