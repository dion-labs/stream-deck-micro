# Hosted Control Room browser compatibility

Status: Phase 1A spike, 2026-08-30.

## Decision

Proceed with `https://deck.dionlabs.ai/setup` as an explicitly initiated,
read-only health and onboarding surface. Keep `http://127.0.0.1:17531` as a
permanent fallback. Do not add hosted configuration writes, prompts, session
metadata, or WebMCP until the production-origin browser tests pass and Phase 2
pairing exists.

The spike uses `fetch()` with `targetAddressSpace: "loopback"`, then retries
without that experimental dictionary member for older engines. The local bridge
binds only to `127.0.0.1`, validates its exact Host header, and allows the
redacted endpoint only from `https://deck.dionlabs.ai` (plus fixed loopback
development origins). It also answers the older Private Network Access
preflight for compatibility.

## Browser matrix

| Browser family | Current assessment | Phase 1 behavior |
| --- | --- | --- |
| Chromium / Chrome / Edge | Supported architecture. Public HTTPS to loopback is permission-gated; the request must originate from a secure context and the user may see a Local Network Access prompt. | Offer **Connect this Mac**, then show the redacted health view. A denial or unreachable bridge goes to the fallback state. |
| Safari / WebKit | Not ready to promise. WebKit has landed loopback classification work, but its LNA enforcement work still has no native permission prompt; a prompt-required decision currently fails closed in the implementation work. | Offer the same gesture, but describe support as evolving and keep **Open local Control Room** prominent. |
| Firefox | Unverified in this spike. Do not infer parity with Chromium's permission flow. | Attempt the read-only request and fail cleanly to the local Control Room. |
| Embedded/in-app Chromium | Initial, failure, connected-fixture, and responsive UI states verified locally. A local-origin development page does not exercise the public-HTTPS-to-loopback permission boundary. | Treat as UI coverage only, not production LNA certification. |

Primary references:

- [Chrome Local Network Access permission](https://developer.chrome.com/blog/local-network-access)
- [WICG Local Network Access specification](https://wicg.github.io/local-network-access/)
- [WebKit LNA implementation tracker](https://bugs.webkit.org/show_bug.cgi?id=250607)
- [WebKit permission-stub implementation](https://bugs.webkit.org/show_bug.cgi?id=319907)

## Read-only contract

`GET http://127.0.0.1:17531/api/hosted/health` returns only:

- contract version, generation time, bridge reachability, and bridge version;
- aggregate capability mode and boolean capability flags;
- aggregate health for bridge, surface, plugin, Codex Desktop, shared control,
  and saved bindings;
- component messages and a plugin version when present.

It never returns prompts, task names, task IDs, working directories, configured
keys, workflows, session counts, action history, tokens, or diagnostic payloads.
The route accepts `GET` and `OPTIONS` only. Existing local Control Room APIs keep
their page token and same-origin policy.

## Production validation gate

After both coordinated PRs deploy/install, test from the real
`https://deck.dionlabs.ai/setup` origin on current Chrome and Safari:

1. Start with Micro stopped and verify the fallback state.
2. Start Micro and click **Connect this Mac**.
3. Accept, deny, then reset the browser's local-network permission and verify
   each outcome.
4. Confirm the Network panel contains only `/api/hosted/health` and that the
   response contains no local task or configuration data.
5. Verify reload performs no automatic loopback request.
6. Verify **Open local Control Room** works regardless of hosted-page support.

Chrome success is sufficient for a limited Phase 1 read-only rollout. Safari
failure is not a release blocker while the local fallback remains clear. Any
move into Phase 2 requires a fresh browser audit and the scoped pairing design.
