# Native macOS preview

[Download v0.2.0-alpha.1](https://github.com/dion-labs/stream-deck-micro/releases/tag/v0.2.0-alpha.1)

Codex + Stream Deck brings the full local Control Center into a macOS window:
Slots, Sessions, Keys, Library, Device, menu-bar status, and opt-in task notifications.
The download bundles Node 22.22.3 and the Micro Elgato plugin installer. No checkout,
Terminal setup, or separately installed Node is needed for a new installation.

## Requirements

- Apple Silicon Mac (arm64), macOS 14 or newer. Intel is not supported by this download.
- ChatGPT Desktop in `/Applications/ChatGPT.app`, with Codex available and signed in.
- Elgato Stream Deck 7.1 or newer and a 15-key Stream Deck MK.2.
- A Codex build that passes Micro's local compatibility verification. New builds
  can fail verification; shared control remains disabled in that case.

This is an **unnotarized alpha preview**, ad-hoc signed for bundle integrity.
It is not signed with a Developer ID certificate, and macOS will warn when you open it.
It is an independent, unofficial project, not an OpenAI or Elgato application.

## Install

1. Download the ZIP and `SHA256SUMS` from the release. Optionally verify the download
   in Terminal with `shasum -a 256 -c SHA256SUMS` from that folder.
2. Unzip, then move **Codex + Stream Deck.app** to `/Applications` (or your home
   `Applications` folder). Keep its name and location unchanged after setup.
3. Open the app. If macOS blocks it, confirm you downloaded it from the Dion Labs
   release, then review **System Settings → Privacy & Security → Open Anyway**.
   Approve the app only if you trust this preview. Do not disable Gatekeeper globally.
4. Choose **Install Elgato Plugin**, accept installation in Elgato, and select the
   bundled Micro profile. The public Marketplace listing is still pending review;
   this installer does not depend on that listing.
5. Choose **Set Up Local Bridge**. This explicitly enables shared-control setup,
   automatic compatibility checks, the local background bridge, and launch at login.
   Micro checks the installed Codex backend before enabling control.
6. Use **Codex + Stream Deck** as your launcher. Assign tasks in Sessions and arrange
   buttons in Configure mode. Switch to Live control when you want on-screen keys
   to execute actions.

If ChatGPT is already running privately, Micro leaves it and all its tasks alone.
When convenient, finish active work, quit ChatGPT yourself, and open this launcher.
Closing the Control Center window, or quitting this launcher, does not stop the
background bridge or quit ChatGPT. Notifications are off until you enable them.

## Existing installs and upgrades

The preview uses an existing shared Marketplace installation without replacing its
configuration, login job, or running service. If it was installed from source, its
backend still depends on that checkout; keep the checkout and Node installation.
Automatic migration from source is not included in this release. Custom ports and
the Independent surface require manual source setup; the native window uses port 17531.

Do not overwrite or move an app bundle while a backend launched from it is running.
For future native upgrades, wait for active tasks to finish, quit ChatGPT, uninstall the shared/Marketplace services (which also disables
Autoconnect) using the old app's
bundled CLI, then replace the app and run setup again. Preserve `~/.stream-deck-micro`
to retain configuration and saved bindings. No background self-updater is included.

## Remove a native installation

Wait for active tasks to finish and quit ChatGPT first. For a native-managed install,
use the bundled CLI while the app is still in Applications:

```sh
"/Applications/Codex + Stream Deck.app/Contents/Resources/runtime/bin/node" \
  "/Applications/Codex + Stream Deck.app/Contents/Resources/runtime/dist/cli/stream-deck-micro.js" shared uninstall
"/Applications/Codex + Stream Deck.app/Contents/Resources/runtime/bin/node" \
  "/Applications/Codex + Stream Deck.app/Contents/Resources/runtime/dist/cli/stream-deck-micro.js" marketplace uninstall
```

Quit the Control Center, remove its app from Applications, and remove the Micro
plugin in Elgato if desired. Your local configuration is retained. For a source
installation, use its existing `stream-deck-micro` CLI instead.

## Build the distributable

On Apple Silicon macOS with Xcode Command Line Tools and Node **22.22.3**:

```sh
npm ci
npm run marketplace:install
npm run marketplace:pack
npm run check
npm run native:test
npm run native:release
```

The build creates a ZIP and `SHA256SUMS` in `release/`, with relative bundle paths,
production dependencies, the app and Node licenses, and an ad-hoc signature.
The release builder does not replace the installed app, restart services, or open ChatGPT.
`node scripts/native-demo.mjs` serves the real Control Center with synthetic demo
content on port 17539 for public product visuals; it cannot control real sessions.
