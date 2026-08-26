# Stream Deck Micro 0.1.0.3

## Release notes

- Added a central **UPDATE CODEX** key when the local bridge detects that a
  Desktop update left an older shared backend running.
- During recovery, all other keys remain blank and inactive, and the central
  key displays **UPDATING CODEX**.
- Pressing the recovery key reloads the already-installed backend, reopens
  Desktop, and restores saved session bindings and settings. Nothing is
  downloaded. Active turns may be interrupted; press it at a safe stopping point.
- Failed recovery keeps the update key available for retry, with details in
  Control Room.

Requires the matching updated local bridge. The Marketplace plugin alone cannot
detect or restart the shared backend.

## Maker Console checklist

1. Merge and install the matching bridge update.
2. Run `npm run marketplace:pack` from the repository root.
3. Upload `marketplace/ai.dionlabs.stream-deck-micro.streamDeckPlugin` as version
   **0.1.0.3**, then paste the Release notes section above.
4. If the previous version is still under review, wait until Maker Console
   permits another upload. Local testing does not require Marketplace approval.

The existing profile, icons, and gallery do not need to be replaced for this
release.
