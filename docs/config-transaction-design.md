# Configuration transactions — design for independent review

Status: **design approved and implementation reviewed on 2026-09-28; alpha.8
artifact qualification pending**. The approved revision had SHA256
`a3d9366186ef69d1621079b8ac5a72755e1ef8c7b87607742fb78ab7bbcf3789`.
The design and review requests below retain the original decision record. Baseline: `f3097e33087cad15cdf74aa7a39bf256d19e06c6`, published
alpha.7/build26 remains immutable. Scope includes the five configuration update APIs in
`src/config.ts` **and first-run configuration creation in `src/nativeSetup.ts`**;
no installed daemon, configuration, account or hardware is used.

## Failure and required guarantee

The disposable reproduction pauses process A after reading configuration. Process
B completes an edition change. A then saves unrelated deck settings using its
old object, restoring the old edition. Atomic rename prevents partial bytes but
does not serialize the read/modify/write transaction. Evidence:
`/tmp/deck-concurrent-repro.py` and
`/tmp/dionlabs-burn-deck-concurrent-repro.log` (2026-09-22).

The current first-run setup is also a writer: its `existsSync` followed by
`writeFileSync(..., { flag: "wx" })` can insert defaults while a configuration
update holds an older absent-file snapshot. Updating only the five save APIs
would leave that same-version writer outside the protocol.

Every cooperating writer must acquire one kernel lock **before reading** current
configuration and retain it through validation, field replacement, staging,
fsync, close and atomic rename. A successful later transaction reads the earlier
committed bytes. Disjoint fields survive. Two writers replacing the same field
retain explicit last-successful-transaction-wins semantics; this does not merge
stale user forms or synchronize every daemon's in-memory configuration.

## Proposed primitive and platform boundary

Use macOS `open(2)` with `O_EXLOCK | O_NONBLOCK | O_CREAT | O_RDWR | O_NOFOLLOW`,
mode `0600`, on a permanent empty sidecar. Darwin's `O_EXLOCK` is `0x20` in the
installed SDK's `sys/fcntl.h`; Node does not export this constant. Give it a named
Darwin-only constant and never apply it on another OS. Package metadata already
restricts the product to Darwin; CI uses macos-15 and Node22. Unsupported platforms
or filesystems must fail closed, never fall back to an unlocked write.

A 2026-09-22 feasibility probe against Node22 on macOS26.5.2 confirmed that a
second actual process gets `EAGAIN` while the descriptor is held, then acquisition
succeeds on the same inode after close. It used only a temporary directory; no
product implementation changed. Log: `/tmp/dionlabs-burn-deck-lock-probe.log`.
The final implementation still needs actual killed-owner and bundled-Node tests.

Primary references:

- [Apple open(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html): atomic lock acquisition, nonblocking contention and unsupported-filesystem errors.
- [Apple flock(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html): advisory lock ownership and descriptor references.
- [libuv Unix filesystem implementation](https://github.com/libuv/libuv/blob/v1.x/src/unix/fs.c): native open flags and close-on-exec handling. Runtime tests, rather than a moving source URL alone, qualify the shipped Node.

## Identity, privacy and lock lifetime

Resolve an existing configuration symlink to its target; reject dangling links.
Resolve the target's parent directory with `realpathSync`. Use a fixed sidecar
`.stream-deck-micro-config.lock` in that canonical parent. Deliberately serialize
all Micro config files in a directory: this avoids filename-length problems and
case/alias races when two processes create the same previously absent file on a
case-insensitive volume. Symlinked directory aliases reach the same lock inode.
The minor cost is contention between independent configs in one directory.

The sidecar is **never unlinked, truncated, replaced or renamed**, including on
successful release, errors or restart. Closing the descriptor releases ownership;
the empty file is not evidence of an active owner. No PID, timestamp, lease,
heartbeat, stale-file deletion or reclaim-by-rename protocol is involved. There
is consequently no stale-owner race or PID-reuse decision. Kernel ownership ends
when the last descriptor reference closes; process death releases its references.
Prevent accidental descriptor inheritance and verify that with a spawned-child
fixture. A suspended living writer remains owner; other writers fail promptly.

After opening, `fstat` must establish a regular single-link file owned by the
current effective user with private permissions (no group/other access); reject
unsafe existing sidecars without modifying or deleting them. Reject symlink,
FIFO/directory, hardlinked or wrong-owner sidecars. New files use `0600`; no config
contents, path metadata or owner/PID record is written into the sidecar.

The namespace is trusted user-owned local storage. This is advisory coordination
among updated Micro writers, not protection against another process deliberately
unlinking locks or replacing parent directories. Do not claim serialization with
older Micro versions or external editors that ignore this protocol. Hardlinked
configuration targets should fail before mutation because atomic replacement
already breaks their shared-inode meaning; test this explicitly. Live external
symlink retargeting is outside the transaction protocol; pin the resolved target
once and use it consistently for the lock, fresh read and commit.

## Transaction flow

1. Resolve the requested path according to existing caller precedence. Preserve
   which APIs create missing parent directories; new directories remain `0700`.
2. Pin the target and canonical parent. Reject unsupported platform, dangling
   symlink or non-regular/hardlinked existing target before a blocking read.
3. Open the permanent sidecar with the nonblocking exclusive kernel lock. On
   `EAGAIN`/`EWOULDBLOCK`, report `Configuration is being updated; try again.`
   before reading or mutating configuration. Do not block the daemon event loop,
   sleep synchronously, steal the lock or replay an administrative operation.
4. Validate the lock descriptor. Recheck target type/access under the lock, then
   read and parse the **fresh** target. Preserve existing invalid/nonobject-file
   rejection. Missing targets produce an empty object only where currently valid.
5. Apply only the requested API's fields. All five writers use this shared
   transaction helper; none reads the update object outside the lock.
6. Native setup calls a dedicated create-if-absent helper using the **same**
   canonical-directory lock. Check existence freshly while holding it; if a
   target exists (including malformed/custom content), return without modifying
   any byte and let existing setup validation decide whether to continue. Never
   overlay defaults onto another writer's newly created file. If absent, retain
   kernel-exclusive `wx` creation, mode `0600`, inside that critical section;
   write complete initial content, fsync and close before releasing the lock.
   An `EEXIST` racing noncooperating creation is also a no-overwrite result:
   reread/validate the existing file normally rather than truncate or replace it.
   Two setup processes serialize; the second observes the first's file and does
   not overwrite it. First-ever creation retains the current process-crash
   limitation: interruption may leave invalid bytes, which later setup/saves
   must preserve and reject. The lock itself still recovers after owner death.
   Atomic update preservation is unchanged; do not advertise atomic first-create
   publication. This explicit bounded choice preserves existing `wx` exclusion
   rather than weakening it with rename after an existence check.
7. Keep the existing exclusive `0600` same-directory staging write, fsync, close
   and rename. Use the pinned target throughout. Preserve only-owned-temp cleanup,
   read-only rejection, symlink preservation and primary-error behavior.
8. Close the lock descriptor once in `finally`, including parse, mutation,
   write, sync and rename failures. If close throws, emit a bounded warning that
   lock release could not be confirmed and further saves may remain blocked
   until process exit; include no config contents. Preserve the primary failure
   when not committed. After a successful rename, return success for the saved
   transaction so callers publish the persisted state; do not turn a committed
   save into a retryable failure. Never retry `close` blindly because descriptor
   reuse may make a second close unsafe. Fault tests must cover both outcomes.

Clearing an endpoint from an absent file stays a no-op and must not create a
config. If the parent is absent, the no-op may linearize before any other writer
creates it; otherwise decide absence under the directory lock. Returning a path
is unchanged. A retained empty lock sidecar is an expected new artifact.

### Exact close-error and caller contract

The transaction result is determined by the commit operation, not by the later
lock-descriptor close. For a successfully committed save, return the existing
success value and emit one `SDM_CONFIG_LOCK_CLEANUP` warning if close throws. The
warning says release could not be confirmed and later writes may remain blocked
until this process exits; it never invites replay, includes no configuration
content, and never says the save was rolled back. The warning emitter itself must
not turn a committed save into an exception. Do not retry close. For a failed
precommit operation, rethrow the original error unchanged and separately emit the
same cleanup warning if necessary. Inject both close-failure cases in tests.

This is **success plus explicit cleanup diagnostic**, not a new typed outcome.
`main.ts` workflow/settings/layout callers consequently continue their existing
post-save memory publication even when lock cleanup fails. The physical auto-
sleep path must be changed to construct candidate settings, persist, then publish
`config.deck` and call `deck.setSettings`. Tests must exercise the actual caller
publication logic (extracted into a small shared helper if needed), not merely
assert that the lower-level save function returned. After a precommit busy/error,
old memory and disk remain; after successful rename plus injected lock-close
error, memory and disk both contain the candidate and the diagnostic is emitted.

Existing synchronous APIs remain synchronous. Contention is an explicit retryable
failure, not an automatic retry: callers can invoke a fresh transaction after the
other writer finishes. Existing IPC/UI error handling should surface that message.
Audit callers that mutate memory or administrative state before save. In
particular, the physical auto-sleep toggle currently changes `config.deck` before
saving; stage that value and publish it only after successful persistence.
Administrative install/uninstall sequences have wider existing side effects;
this milestone must not claim to make those entire operations transactional.

## Crash and durability boundaries

- Kill before rename: original config survives; the kernel releases ownership;
  the next writer opens the retained sidecar and reads the original config.
- Kill after rename: a later writer reads the committed complete config. There
  is no success receipt for the killed process, so its caller cannot assume
  whether the mutation committed. Never replay an unrelated live action.
- A crash may leave a private staging file; do not sweep unrelated/orphan files
  as part of this milestone. Existing owned-temp cleanup remains unchanged.
- Preserve current fsync-before-rename ordering. Directory fsync/full power-loss
  certification is not added or claimed. Tests establish process-crash and
  injected-write-failure behavior, not physical storage durability.

## Required test matrix and evidence

Use actual disposable child processes with child-only HOME/TMPDIR and a minimal
environment, readiness barriers and deadlines. Close or kill only exact owned
child PIDs and await exit before deleting fixtures. No real daemon socket or
personal path may be selected. Controlled fs wrappers may pause at deterministic
read/rename boundaries; they must not replace the kernel lock behavior.

| Case | Fixture and expected outcome |
|---|---|
| SDM-043 fresh transaction | A holds lock after fresh read; B attempts a disjoint update and gets busy with unchanged bytes; after A commits, B retries and both fields survive. Cover all five writer APIs. |
| SDM-043 simultaneous start | Two and then several real processes start together with distinct fields; each retries only the busy error with a bounded external deadline. Every successful disjoint update survives. Same-field updates have a valid serial result. |
| SDM-043 naming | Existing target, absent target, relative/absolute spelling, target symlink, parent symlink and case variants on the case-insensitive test volume use the same directory lock. Separate directories do not contend. |
| SDM-043 first-run creation | Pause save A after its absent-file fresh read while holding the directory lock; native setup create helper B must report busy and write nothing. After A commits, B retries, observes existence and preserves all bytes. Reverse ordering: B creates defaults under lock; A retries and preserves slots/admin/attachExternal while adding its disjoint field. Exercise two concurrent initializers and malformed/custom existing targets; no overwrite. |
| SDM-044 killed owner | SIGKILL owned A while paused before commit; B acquires without deleting the sidecar and preserves original bytes plus its update. Repeat after commit; B reads committed bytes. |
| SDM-044 setup interruption | Kill the owned initializer before create, during an injected partial initial write and after complete initial fsync. Lock acquisition recovers in every case. Absent config can be initialized on retry; existing partial/invalid bytes are preserved and rejected, never silently repaired or overwritten; complete content is preserved. This records the retained first-create limitation. |
| SDM-044 descriptor lifetime | A spawns an unrelated owned child while holding the lock; killing A releases ownership even while that child remains alive. Repeated acquisitions retain sidecar device/inode identity. |
| SDM-045 fault/privacy | Inject parse, callback, write, fsync and rename errors; original bytes survive where not committed, owned staging is cleaned, next actual process acquires. Sidecar/config remain private. Existing invalid/read-only/symlink tests stay green. |
| SDM-045 fail closed | Unsafe sidecars, unsupported lock errors/platform, non-regular/hardlinked configs and held lock reject without config mutation or sidecar cleanup. Validate endpoint-clear no-op behavior. |
| SDM-046 caller outcome | Auto-sleep staged settings do not become current on failed persistence. Inject a lock-close failure after a real successful rename: save returns success, actual main settings/workflow/layout publication logic observes the committed values, disk and memory agree, and exactly one cleanup diagnostic appears. Inject primary failure plus close failure: original error survives, old memory/disk remain, diagnostic appears separately. Never retry close. IPC/UI surfaces busy and a later explicit retry works; no automatic action replay. |
| SDM-046 packaged proof | Extracted final ZIP's Node executes competing-writer and killed-owner checks; exact version/build, signature, checksums and existing runtime/browser checks remain required. |

## Review requests and release gate

Revision 2 explicitly includes nativeSetup first-run creation and selects success
plus a cleanup diagnostic after committed writes. Native create-only publication
retains `wx` inside the lock rather than silently weakening existing exclusion of
noncooperating creators; its existing first-creation crash limitation is called
out above and needs explicit review agreement. No implementation has begun.

Root should independently review the kernel primitive/Node flag choice, permanent
per-directory inode identity, no-reclamation crash model, nonblocking caller
semantics and close-error policy **before implementation**. Require explicit
clearance or revisions in the worker inbox. The minimal kernel feasibility probe
is evidence for design, not acceptance of product behavior.

After clearance: add the real-process regressions first, implement one shared
transaction path, run affected/full/independent review and extracted-artifact
checks, then request a separate release slot. No alpha.7 tag or artifact changes.
Physical/native/live acceptance remains in [the checklist](acceptance-checklist.md).
