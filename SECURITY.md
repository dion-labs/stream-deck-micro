# Security policy

Please report vulnerabilities through a private GitHub security advisory on
`dion-labs/stream-deck-micro`. Do not open a public issue for credential leaks,
localhost-control bypasses, or vulnerabilities that can cause commands to run.

## Security model

- The daemon, Unix socket, and Control Room are local-machine tools.
- The Control Room binds to `127.0.0.1`, rejects unexpected hosts and origins,
  and authenticates API requests with a per-process token.
- Prompts can start agent turns that modify files or execute commands according
  to the user's Codex sandbox and approval configuration.
- The example configuration intentionally targets experienced Codex users who
  run unattended with full filesystem access. Review it before use.

Only the latest release receives security fixes during the 0.x series.
