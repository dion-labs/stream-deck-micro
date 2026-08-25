# Changelog

All notable changes will be documented here. This project follows Semantic
Versioning once it reaches 1.0.

## 0.1.0 - Unreleased

- Monitor and control up to fifteen Codex sessions from a Stream Deck MK.2,
  with seven session keys in the default layout.
- Show live session state on RGB keys and in the local Control Room.
- Attach recent sessions from Codex desktop, CLI, and IDE clients.
- Run configurable one-tap workflows and interrupt active turns.
- Provide `stream-deck-micro`, `sdm`, and diagnostics commands.
- Share one loopback WebSocket App Server with Codex Desktop so both clients can
  control the same session concurrently.
- Install, inspect, and remove the shared server through reversible LaunchAgent
  lifecycle commands.
- Add a validator-clean Elgato Marketplace plugin with an editable bundled
  15-key profile and live SVG rendering.
- Add a headless Marketplace surface and reversible background bridge service
  while retaining the Independent direct-HID edition.
- Preserve sleep, wake swallowing, attention-only mode, workflows, and shared
  session control across both editions.
- Let every physical key become a distinct session button from the Control Room.
- Detect Codex title changes automatically and provide a manual recovery refresh.
- Keep the Marketplace surface polling across local bridge restarts.
- Clear shared-session attention when its notification dot is cleared in Codex Desktop.
- Detect private-server login races and offer one-key Codex Desktop recovery.
- Open the matching Codex Desktop thread when a session key is pressed.
- Make unacknowledged turns unmistakable with a dedicated signal-yellow attention beacon.
