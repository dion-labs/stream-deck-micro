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
