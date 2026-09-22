# Native macOS preview v0.2.0-alpha.6

The local companion socket now preserves UTF-8 text when accents, emoji or CJK
characters arrive across separate transport chunks. A disconnected daemon is
reported promptly, including truncated responses, instead of waiting for the
request timeout. Request completion clears its timer/socket once; serialization
errors reject safely without transmitting a partial request. No automatic command
retry or replay is introduced.

Eleven new cases cover fragmented 2/3/4-byte characters in both directions,
early/truncated EOF, silent-peer timeout/recovery and cyclic arguments. The
extracted-artifact verifier also exercises fragmented traffic and EOF against the
bundled runtime. Prior config preservation, atomic writes and keyboard safety
remain included.

Apple Silicon, macOS 14+. Unnotarized, ad-hoc signed alpha preview. No installed
app, running session, real hardware or user data was changed during QA. Physical,
native lifecycle and actual browser-permission acceptance remain separate gates.
