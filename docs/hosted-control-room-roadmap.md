# Hosted Control Room roadmap

## Decision

The hosted experience will be a local-first setup and Control Room shell at
`https://deck.dionlabs.ai/setup`. Dion Labs may serve the interface and its
documentation, but it must not become a cloud relay or authority for local Codex
sessions. Configuration, prompts, session identifiers, and action execution stay
on the user's Mac.

The local Micro bridge remains the source of truth. A hosted page may connect to
it only after an explicit user gesture and short-lived pairing grant scoped to
the exact Dion Labs origin. The existing localhost Control Room remains the
fallback and recovery surface.

## Product principles

- Keeping native Codex Desktop healthy is the first invariant.
- Never describe detached task navigation as live control.
- Configure mode is the default; live execution must be explicitly armed.
- Do not expose the current local API to the internet or use wildcard CORS.
- Do not send prompts, task names, identifiers, paths, or diagnostics to
  Cloudflare analytics.
- Version the bridge API and negotiate compatibility before enabling mutation.
- Prefer no-account pairing. Cloud accounts and remote control are out of scope
  until a concrete need justifies their privacy, authentication, and operations
  cost.

## Capability language

Every surface uses the same four user-facing states:

- **Ready / live control**: session navigation, prompts, workflows, stop, live
  state, focus sync, and attention sync are available.
- **Navigation only**: saved task buttons can open Codex, but no live operation
  or state is implied.
- **Action required**: a component is present but needs setup or recovery.
- **Offline**: a required component cannot currently be reached.

Component health covers the local bridge, Stream Deck surface, Marketplace
plugin, Codex Desktop, shared control, and saved bindings.

## Delivery phases

### Phase 0 — truthful local foundation

- Explicit capabilities and component health in the daemon status contract.
- Navigation-only visuals on the physical deck, Marketplace plugin, and local
  Control Room.
- Unavailable actions disabled or rejected with immediate visible feedback.
- Marketplace plugin heartbeat with plugin/Stream Deck versions and device/key
  counts.
- Structured, redacted action outcome events and a copyable diagnostic report.

### Phase 1 — hosted onboarding and read-only health

- Edition chooser: Marketplace or Independent, with an honest feature matrix.
- Prerequisite and install checklist.
- Explicit **Connect this Mac** browser gesture.
- Read-only component health and version compatibility.
- Clear fallback to **Open local Control Room**.

Before implementation, spike Chrome and Safari behavior for an HTTPS origin
calling an HTTP loopback service. Verify Local Network Access permission,
mixed-content handling, CORS, preflight behavior, and denial/recovery UX.

### Phase 2 — paired local configuration

- One-time pairing code or locally confirmed capability.
- Short TTL, exact-origin binding, read/write scopes, revocation, and CSRF/DNS
  rebinding defenses.
- Session assignment, layout, workflows, labels, and sleep settings.
- No cloud persistence of local data.

### Phase 3 — guided verification and recovery

- Guided health pipeline and compatibility explanations.
- Virtual-deck test with configure mode as the default.
- Explicitly armed live controls with per-action outcomes.
- Launch-at-login/reconnect verification and redacted diagnostic export.

## Proposed onboarding journey

1. Choose Marketplace or Independent edition.
2. Check macOS, Stream Deck software/device, plugin, bridge, and Codex Desktop.
3. Connect and pair this Mac.
4. Resolve the health pipeline from top to bottom.
5. Assign sessions and arrange keys.
6. Configure workflows and sleep behavior.
7. Test in configure mode, then explicitly arm live control.
8. Verify restart/reconnect and provide support/diagnostic links.

## Deferred work

- Cloud relay, accounts, remote control, and server-side configuration storage.
- WebMCP challenge implementation. The paired hosted shell may become a natural
  WebMCP surface later, after the local capability and security model is stable.
- Automatic shared-server activation. The WebSocket App Server transport remains
  experimental and must stay behind explicit compatibility verification.
