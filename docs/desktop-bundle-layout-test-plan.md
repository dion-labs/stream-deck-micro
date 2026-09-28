# Desktop layout follow-up: audited test boundaries

Companion to proposed design `c9ac3dff1eca657571988d7a01a19d40e519804fa5702178ef0baf4a9bbad4b9`.
Initial audit baseline was alpha.8. The regression descriptions below retain the
pre-fix evidence; current candidate qualification is recorded in TOKEN_BURN_2026-09-28.md.

## Initial regression evidence

`src/automaticVerification.test.ts` adds two saved-record interleavings using
only injected dependencies. Narrow run on 2026-09-28: 10 pass, 2 expected failures.
Log: `/tmp/dionlabs-deck-20260928-layout-regressions.log`.

- Another verification changes only `verificationGeneration` while the probe runs.
  Current code saves over that newer record because fingerprint equality is insufficient.
- The saved `codexPath` changes while the probe runs. Current code preserves that
  changed path in its spread record but approves it using a probe of the old path.

Compare original path and generation as well as existing token/URL/fingerprint
before saving a migrated record. A selection change during an attempt must never
approve a different binary. Retrying a transient update can begin a fresh pinned
attempt, but must not weaken these saved-record guards.

## Planned fixture implementation

| Boundary | Fixture and assertion |
|---|---|
| Discovery | Temp bundle trees containing modern/legacy/both/neither; executable regular files only. No arbitrary-path or PATH fallback. Explicit invalid preferred-file behavior. |
| Saved install | Mock only APP_DIR to a disposable directory; valid old and new fixed paths accepted, prefixes/lookalikes/arbitrary paths rejected. Never read installed state. |
| Fingerprint | Explicit selected file and archive, pre/post probe hash and re-selection. Record exact arguments and reject update interleavings. |
| Bridge | Inject selection, fingerprint, verifier, launch and record; selected path different from verified path cannot authorize shared launch. Preserve private fallback environment cleaning and post-forward no-replay cases. |
| Shell passthrough | Inspect generated launcher against both known layouts, including behavior after uninstall or missing bridge. No real launchd or installation. |
| Process classification | Table-driven ps text using exact modern/legacy paths, prefix impostors, wrong ancestors and wrong endpoints. No signals to real processes. |

## Recovery scope clarification for reviewer

The proposed design lists the existing guards collectively. They are not all
present in every recovery function. `sharedServerStatus` uses runtime records and
Desktop ancestry; `processListHasDesktopPrivateAppServer` uses ancestry. In contrast,
`managedSharedListenerPids` currently filters only exact legacy command prefix,
app-server argument and exact endpoint. `signalIfStillManaged` rereads that predicate
before signaling. It does not compare process creation identity or a recorded
runtime ownership token. Existing PID-reuse tests cover a changed command line,
not a replacement process with the same qualifying command.

Therefore expanding the signaling predicate to the modern path needs explicit
independent review; do not claim stronger existing ownership proof. The conservative
option is to support modern discovery/verification/status while blocking automatic
listener cleanup for that layout with a clear error until ownership qualification
is separately designed. No recovery signals or real Desktop restarts are permitted
in this burn. Review should choose the bounded release scope before implementation.
