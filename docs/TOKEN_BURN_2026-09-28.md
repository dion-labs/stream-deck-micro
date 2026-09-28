# Stream Deck Micro resumed audit — 2026-09-28

Reconciled ancestor AGENTS, README, hosted roadmap, ignored JOURNAL, actual diff,
remote Git and GitHub release. Remote main remains f3097e33087cad15cdf74aa7a39bf256d19e06c6;
no intervening commits. Published alpha.7/build26 remains unchanged. Cleared design
hash a3d9366186ef69d1621079b8ac5a72755e1ef8c7b87607742fb78ab7bbcf3789 matches disk.
Inherited partial edits: config.ts/nativeSetup.ts; new configTransaction.ts,
config.transaction.test.ts, scripts/fixtures/config-writer.mjs; design/Sept22 ledger.
No newer changes discarded. Current Node22.22.3; approximately50GiB available.
Live process inventory inspected read-only; no old PID reused or process interrupted.

Fresh resource-wrapped npm run check: build passes; 400 tests pass,24 fail,4 opt-in
skip. Failures are20 atomic mock/retained-sidecar expectation cases and4 nativeSetup
mock cases. Five real competing-process tests pass. Raw evidence:
/tmp/dionlabs-deck-20260928-baseline.log. Prior419pass was pre-transaction and is not
a current-tree certification. No prior browser/native/device result promoted.

Next milestone: complete cleared transactions with all five update APIs and native
first-run creation sharing one lock; stage physical autosleep state; validate
postcommit cleanup diagnostics with actual caller memory/disk agreement. Complete
SDM043–046 real-process/setup/crash/inheritance/privacy/fault/caller/bundled matrix,
full checks and independent implementation review before a separately coordinated
release. Existing42-case register and newSDM043–046 design matrix remain authoritative.

Deferred physical/native acceptance: docs/acceptance-checklist.md unchanged:
MK.2/HID/Marketplace actions/sleepwake; realDesktop auth/recovery/focus/unread;
loginrestore; install/upgrade/Gatekeeper/uninstall; WKWebView/VoiceOver; realbrowser
local-network permission dialogs; installedclipboard/configrepair. No live apps,
config or hardware fixtures; no website deployment; Voxta/standalone streaming excluded.


## Frozen transaction candidate — implementation review requested

136focused PASS (5files,10.30s): /tmp/dionlabs-deck-20260928-focused3.log. Includes17actualprocess cases covering all5writers, firstsetup/save bothdirections, simultaneouswriters, killedowner before/afterrename, killedinitializer before/during/aftercreate, aliascontention. Boundeddescendant2s holdsownedpipe3; parent waits ownedChildProcess close inclpipe before cleanup. No orphanPIDsignals. Stagingclose clearedtrackedfdBEFOREclose and released-fd fault regressionPASS. Explicit postcommit lockclose returns success+nonthrowing diagnostic; actualpersistDeckSettings usedby mainsettings/autosleep provesdiskmemoryagreement; precommitbusy/writefault keepsoldmemory/disk. NativeSetupmocks nowassertcreatehelperorder/busy/invalidpreservation. All136 pass, underlyingatomicfaulttestsretained.

SOURCE FROZEN for independent implementation review; no clearance assumed. Hashes:
c79725919af678b4dae698d957a0a0ce64c0972bb59f6aea3fa84fc256e9dea2 src/config.ts
1508843fd8216b6144452bc380b639607d00c7de9cba1ed209588fb8135fd14c src/configTransaction.ts
53318775d29e383c2d5e4a6a8de12d087ecda59a53b135c39c39ea1750c378dd src/nativeSetup.ts
4ed8a186b580e094e3db848472559811d919c7bf3ff9a65dd57e9fad133fdfb5 src/main.ts
1fdd1b4b8ca85db379289a0fe5b6a73b77ef29312b5b2e59fb9aa4c4ffbe5fe9 src/core/persistDeckSettings.ts
856e64f9abd04f0544a86ee2f290b6e17e24d35253d5fa758084294b13d6a004 src/config.transaction.test.ts
7b3ab78474a32fdb0b3c046fa7521044e77c1f137f9137e111ada0e7e9c7ea4e src/config.cleanup.test.ts
e10cf27c938212281c097cd579747ad12f122bb5d6fceed3f34e473bcfa94f2f scripts/fixtures/config-writer.mjs
Fullresource-wrapped check queued behind sharedheavylock; no duplicateheavyjob launched. Artifact verifier now runs same17processcases against extracted bundledNode+compiledconfig. Pendingreview/full/artifact+browser qualification before separatelyreservedrelease. Root please review frozenhashes and reservealpha8 if candidateaccepted; alpha7immutable. No liveconfig/session/hardware touched.


Sep28 full current-tree check PASS:35files,463passed/4defaultoptinskips, TypeScript buildpass; /tmp/dionlabs-deck-20260928-check.log. Fresh Marketplace13pass. OldSep22 rawlogs expired and Codexbundlepath changed; isolated6integration queued using freshlylocated installedbinary only in disposableHOME/providerdummy/ephemeralendpoint, noDesktop/appsession. Nativealpha8/build27 staged and resource-wrappedrelease queued; sourcehashes remainreviewed. Exactbundled17process+browser/signature/hash next.


Separate follow-on observed during Sep28 reconciliation (no source changes in frozen alpha.8): src/sharedRuntime.ts still hardcodes /Applications/ChatGPT.app/Contents/Resources/codex, which is now absent. The freshly installed bundle instead has Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex (Sep26 timestamp). Isolated integration explicitly targets the current binary, but default shared verification/install still uses the missing old path. This is an evidenced future compatibility milestone; any resolver change must preserve exact executable identity/fingerprinting and existing-session safety. Do not mix it into the transaction release or claim current Desktop acceptance. No live command/install/restart run.


## Alpha.8 qualified artifact — 2026-09-28

Native build27 completed under the shared resource lock. Final extracted ZIP
passed all17 transaction process tests using its bundled Node and compiled
configuration code, including contention, initialization races and killed-owner
recovery. Existing config write-fault, HTTP/privacy, fragmented IPC/EOF and CLI
safety checks passed, as did Control Room keyboard/held-key/recovery/narrow-layout
browser checks. Exact version/build, strict deep signature, plugin and checksum
passed. Log: /tmp/dionlabs-deck-20260928-alpha8-artifact.log.

ZIP SHA256: b89b59efb024f93838a61c2875e5dfbb91c350f3c32dea94d3877125a1d6578b.
Full463passed/4defaultskips; fresh isolated current-Codex integration6passed;
Marketplace13passed. Independent24boundary/cleanup checks and implementation
review cleared current runtime source. PR24 first CI run passed bridge and
Marketplace; final evidence/fixture-whitespace commit follows, then latest CI,
merge, actual release and site receipt. Runtime code is unchanged since review.
One final empty line in the test fixture was removed; this is not a code change.

Separate observed compatibility limitation: current Desktop's nested CodexCLI
executable layout is not recognized by the legacy default path. No installed
Desktop setup acceptance is claimed; preserve this as the next independent
milestone with executable identity/fingerprint/session guards intact.


Final test-strengthening receipt: staging-close regression now counts every close
attempt for the released descriptor, including a second attempt after its tracking
entry disappeared. In a disposable source copy, restoring the old close ordering
fails with2attempts where1isexpected; current source passes. Logs:
/tmp/dionlabs-deck-20260928-staging-regression.log and
/tmp/dionlabs-deck-20260928-cleanup-final.log (24passed). Runtime source and built
artifact are unchanged. This closes a weakness in the test assertion itself.


ALPHA.8 PUBLISHED — actual receipt

https://github.com/dion-labs/stream-deck-micro/releases/tag/v0.2.0-alpha.8
Non-draft prerelease published2026-09-28T18:52:16Z; source2f9ac2f/build27.
PR24 https://github.com/dion-labs/stream-deck-micro/pull/24 merged7c40239e8ff174d9fb4fadf5016de9ac0f9253f5;
latest CI bridge47s and Marketplace20s passed.
ZIP https://github.com/dion-labs/stream-deck-micro/releases/download/v0.2.0-alpha.8/Codex-Stream-Deck-0.2.0-alpha.8-macOS-arm64.zip
53,752,646bytes; SHA256 b89b59efb024f93838a61c2875e5dfbb91c350f3c32dea94d3877125a1d6578b matches uploaded API digest.
Checksum https://github.com/dion-labs/stream-deck-micro/releases/download/v0.2.0-alpha.8/SHA256SUMS
Full463 + isolated6 + Marketplace13 + final bundled17process/browser/signature/version/hash allpass;
independent design/implementation review cleared. Cooperating config writers nowserialize;
first native creation same lock, busy retry truthful, postcommit cleanup respects saved memory.
Limits explicit: samefield/oldwriters/externaleditors, partialfirstwxcreate, powerloss and wideradminoperations.
Release notes ALSO disclose preexisting new Desktop nested-executable layout unsupported by legacydefaultpath;
resolver follow-up pending, do not claim current installed Desktop acceptance.
Please independently verify assets and update local alpha.8 download/version/notes links with targeted QA;
NO website deploy/push authorized. Root please attachPR24 if not already attached/resume siteworker if idle.


Next concrete follow-up proposed: docs/desktop-bundle-layout-design.md SHA256 c9ac3dff1eca657571988d7a01a19d40e519804fa5702178ef0baf4a9bbad4b9, branchcodex/desktop-bundle-layout from7c40239. Read-only evidence confirms nestedCLIexists/legacyabsent; isolatedcurrentCLI6pass. Plan preserves knownpathallowlist, recordedlegacyinstalls, pinnedprobe/fingerprint/save, noforwardreplay and exactprocessrecoveryguards. SDM047–049 planned syntheticdiscovery/verification/processidentity coverage. REQUEST root independent boundary/design review before this trust-sensitive implementation; alpha8 remainsfrozen/published, siteactualreceiptpending. No current sourcebehavior changed on newbranch.


2026-09-28 layout follow-up audit: design hash remains c9ac3dff1eca657571988d7a01a19d40e519804fa5702178ef0baf4a9bbad4b9, no runtime implementation pending independent root review. Regressions-first found automaticVerification.ts currently guards token/URL/fingerprint but NOT verificationGeneration or codexPath. Added two synthetic changed-record cases to existing test; fresh narrow result10pass/2expectedfail, /tmp/dionlabs-deck-20260928-layout-regressions.log. A newer generation with the same fingerprint is otherwise overwritten, and path mutation can approve a record different from the probe. Include equality of original generation/path in compare-before-save; saved path migration only from verified selected path. These are preexisting guard gaps relevant to migration, not alpha8 transaction regressions. No private files/real process interaction.
Site independently verified alpha8 assets and updated local links/limitation copy; its targeted3engine layout/link qualification is queued (not yet passed).

Regression preparation expanded safely: src/sharedRuntime.test.ts uses a disposable APP_DIR and12 saved-record cases. Legacy acceptance +10 arbitrary/prefix/type rejects PASS; modern exact allowlist acceptance fails as expected. Combined fresh run21pass/3expectedfail with automaticVerification cases; runtime source remains untouched. Updated log /tmp/dionlabs-deck-20260928-layout-regressions.log. Await independent design scope decision, particularly modern recovery signaling.

ALPHA.8 LOCAL SITE HANDOFF COMPLETE: deck-site independently verified actual uploaded release assets/checksum, updated home/setup links and compatibility limitation, and passed fresh WEB-011 Chrome/Firefox/WebKit at1440/768/390/320. Build/diffcheck pass; dated evidence under site docs/evidence/2026-09-28/alpha8/. No deployment/push. This closes publication/link milestone; next layout candidate remains tests/design only, root independent review pending.

DESKTOP LAYOUT IMPLEMENTATION — frozen boundary review requested
Root scoped design accepted and four clarifications documented in revised
`docs/desktop-bundle-layout-design.md`. Current runtime candidate frozen; hashes
in `docs/desktop-layout-candidate-sha256.txt` (no alpha9 metadata yet).
Modern/legacy resolver rejects symlink root/components/candidates, invalid preferred
modern fails closed; default imports still work without Desktop. Saved exact paths
allow both; hashes/probe/final commit/launch pin path. All FIVE installation writers
(shared install/delete, native enable, CLI enable, automatic verification) now use
sharedInstall.updateSharedInstall and existing kernel directory lock; auto compare
of original token/URL/path/fingerprint/generation/config/launcher occurs inside
locked update, no probe lock. Atomic writer reused by exporting existing function,
no implementation change to released config transactions.
Modern recovery refuses BEFORE quit/uninstall/signal, including mixed listeners,
modern installed/selected layout; generic/default and explicit shared restart also
refuse modern. Legacy signaling functions remain unchanged. Generated launcher
always uses validating bridge for private passthrough; if runtime missing it refuses
with repair diagnostic, never falls back to an unchecked/stale executable path.
Fresh narrow55unitPASS +32recoveryPASS +41bridge/launcherPASS (before latest5additional
bridge race cases). Six actual competing-process CAS cases PASS under resource lock:
barrier after compare/before stagingwrite blocks other verify/enable/delete/replace;
probe holds no lock and concurrent deletion/replacement prevent stale approval.
Logs /tmp/dionlabs-deck-20260928-layout-{focused,recovery,bridge,transactions}.log.
Build PASS. Full check with new bridge cases is currently resource-queued, not yet
passed. Need independent frozen review, isolatedcurrentCLI/full/extractednewartifact
before alpha9 release request. Alpha8 + local sitehandoff COMPLETE/immutable.
No live Desktop/daemon/config/account/hardware operation or website deployment.


## Desktop layout qualification ledger (candidate, unreleased)

| Case | Required boundary | Evidence so far | Remaining qualification |
|---|---|---|---|
| SDM-047 | Exact modern/legacy discovery; no PATH fallback, symlink escape or invalid-modern downgrade | 12 synthetic resolver cases pass; saved-record allowlist and fingerprint path identity pass | Final full suite and extracted compiled resolver smoke |
| SDM-048 | Same selected path for hash/probe/save/launch; serialized final comparison against saved generation/path/token/URL/fingerprint | Original three red regressions now pass; six actual competing-process final-commit/probe races pass; existing bridge/launcher 41 pass before five new race cases | Full suite including five new bridge cases, current isolated CLI, bundled six-process race suite, frozen independent review |
| SDM-049 | Modern status classification, exact ancestry; modern recovery refuses before any lifecycle effect; legacy signal predicates unchanged | Synthetic lifecycle cases cover modern-only/mixed/saved/selected modern and no effect; private classification covers both exact paths and impostors | Full suite, extracted compiled zero-effect refusal and independent source review |

The current frozen candidate manifest is `desktop-layout-candidate-sha256.txt`.
New installation launchers use the validating bridge even after uninstall; a missing
runtime now produces a repair diagnostic instead of an unchecked native fallback.
Existing older launchers retain their on-disk text until explicit setup/reinstall;
qualification of upgrading/removing an installed older bundle remains a manual gate.
No installed-state migration or real Desktop account/session acceptance is claimed.

Frozen layout candidate fullcheck PASS: build +511tests/4defaultoptinskips across38files, /tmp/dionlabs-deck-20260928-layout-full.log. Manifest all18hashes stillmatch, including five new bridge races. Six realprocess CAS tests included. Current explicit nestedCLI isolatedintegration queued underlock next (no Desktop/account/hardware). Request exclusivealpha9slot subject independentfrozenreview +integration +newartifact/signature/hash/bundled23process/browser gates. Prepared artifactrunner now tests compiledresolver invalidpreferred/symlink and modernrecovery zeroeffects plus bothprocesssuites. No packagingmetadata changed yet.

Caller correction frozen for NARROW REREVIEW: manifest now21entries. Only runtime changes since SOURCECLEAR are sharedServer.ts extracted public preflight guards, main.ts invoking them before persisted/hydration/appServer-dispose/reinstall/update staging, sharedReconnect.ts calling preflight before verify/rearm. Diagnostic error state still updates visibly; no recovery lifecycle/state staging occurs on modern refusal. Added selected/saved-modern generic+shared restart zero-subprocess tests and reconnect zero-check/verify/restart test. Fresh41caller/recovery cases PASS (/tmp/dionlabs-deck-20260928-layout-caller.log). Full check rerun queued /tmp/dionlabs-deck-20260928-layout-full-final.log. Resolver/CAS/bridge/probe/CLI/runtime identity files unchanged from scopedCLEAR; currentisolated6/6 evidence remains applicable. Please narrowly recheck ordering before artifact publication. Alpha9 slot acknowledged.

Caller-corrected fullcheck PASS514/4defaultoptinskips38files, /tmp/dionlabs-deck-20260928-layout-full-final.log; isolatednestedCLI6/6PASS covers optins. All21frozenmanifesthashesmatch. Alpha9/build28 packaging started underresource lock, log /tmp/dionlabs-deck-20260928-alpha9-build.log. Release/README/native docs explicitly modernrecoveryunsupported beforeconnectionteardown/reinstall/restart, manualidlequit+verifiedlauncher route; olderon-disklauncherupgrade/removal continuity remainsmanualgate. Narrowcaller rereview stillpending; no publication until receipt andartifact/CI complete.
