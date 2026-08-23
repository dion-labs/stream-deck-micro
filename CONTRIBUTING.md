# Contributing

Thanks for helping improve Stream Deck Micro.

1. Open an issue before starting a large feature or adding another hardware
   family or agent harness.
2. Create a focused branch and keep unrelated formatting changes out of it.
3. Run `npm run check` before opening a pull request.
4. Include tests for state-machine, adapter, layout, or server behavior changes.
5. Never commit Codex sessions, local config, credentials, device serials, or
   absolute home-directory paths.
6. Commit completed work to a pushed branch and open a pull request; do not
   leave finished changes only in a local working tree.
7. Every pull request must state whether an Elgato Marketplace update is
   required. Include the target plugin version and Maker Console upload steps
   when it is required, or explain why the existing package remains valid.

Bridge-only changes under `src/` normally do not require a new Elgato plugin
package. Changes to plugin runtime, manifest, profile, UI, or packaged assets
under `marketplace/ai.dionlabs.stream-deck-micro.sdPlugin/` normally do. Listing
media under `marketplace/media/` may require a Maker Console listing edit but
does not by itself require a plugin-version upload.

By contributing, you agree that your contribution is licensed under the MIT
License.
