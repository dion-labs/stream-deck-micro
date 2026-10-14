# Automatic connection recovery — v0.2.0-alpha.10

With automatic connection enabled, Micro retries transient shared-backend startup
failures up to twice before falling back privately. Retries happen before reading
Desktop requests; failures after forwarding remain blocked and are never replayed.
Only the child process created by that bridge is stopped between attempts.

The service also checks disconnected installations every 30 seconds and verifies
changed Desktop builds or transient private startup failures using isolated probes.
Temporary verification failures get up to three recovery rounds with increasing
delays; each round retains the existing bounded probe retries. Permanent failures
stop until the installation/build identity changes or the user intervenes.
The Control Room reports progress, readiness for the next launch, or the remaining
manual step. Existing transport reconnection and session restoration remain automatic.

Background recovery never quits, restarts, opens, or sends requests to Desktop.
It respects the automatic-connection setting and cancels its probe on service exit.
A running private backend cannot be attached in place: finish existing work, then
use Codex + Stream Deck for the next launch. Backend updates requiring a restart,
post-forwarding failures and incompatible builds still require intervention.
Modern Desktop layout restart restrictions remain in force.

Apple Silicon, macOS 14+. Ad-hoc signed, unnotarized preview. Disposable subprocess
and packaged-runtime checks do not establish physical Stream Deck or installed
Desktop acceptance. No active sessions were restarted during validation.
The previously documented older-launcher uninstall limitation remains unchanged.
