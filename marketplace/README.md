# Stream Deck Micro — Elgato Marketplace plugin

This directory contains the official-SDK surface for Stream Deck Micro. It is a
thin renderer and input client for the same local bridge used by the Independent
edition; business logic deliberately stays in the bridge.

## Development

```bash
npm install
npm run build
npm test
npm run validate
npm run link
```

Start the bridge with `stream-deck-micro marketplace install`. Development
links do not reliably trigger bundled-profile installation, so import
`ai.dionlabs.stream-deck-micro.sdPlugin/profiles/Stream Deck Micro.streamDeckProfile`
once. Marketplace installations use `AutoInstall` in the manifest.

The action is position-aware on a 5×3 Stream Deck: its coordinates determine
whether it represents a session, workflow, stop, optional attach, or sleep key. Any
position can host one of up to fifteen distinct session slots. This
keeps the bundled profile editable without storing fifteen divergent action
configurations.

When Codex Desktop starts before the shared server, the surface temporarily
blacks out every key except a central **RESTART CODEX** action. Pressing it asks
Desktop to quit and reopen on the shared server; the normal profile returns once
the saved sessions have restored.

Plugin **0.1.0.3** also labels the central recovery key **UPDATE CODEX** when
the bridge detects a running backend that differs from Desktop's installed
version. It shows **UPDATING CODEX** while recovery is in progress. This uses the
already-installed executable; it does not download an app update. Update the
local bridge as well as the plugin. Older plugins still forward the central
key correctly, but show the old RESTART wording instead of the update states.

## Release

```bash
npm ci
npm run test
npm run validate
npm run pack
```

`npm run pack` creates the `.streamDeckPlugin` upload for Elgato Maker Console.
Before submission, update the four-part version in `manifest.json`, prepare the
Marketplace listing media, and verify a clean install rather than only a linked
development install.
