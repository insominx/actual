Last Edited: 2026-10-02

# Plan Review: Headless runtime

Verdict: proceed after minor edits. Coordinator self-review; no independent review claimed.

The existing `/account/needs-bootstrap` and `/account/bootstrap` endpoints already own first-run password setup. Reuse them without adding another bootstrap authority. Do not expose the returned login token.

Implement bootstrap and connection diagnostics first. Verify them against a fresh disposable server before adding process management. Managed lifecycle will use a detached supervisor with a private control token. Stop sends a bounded request to that supervisor, which holds the original child-process handle. It never kills a PID read from disk. Bind managed services to loopback initially. Configuration changes and executable hashes must be checked before lifecycle actions.

Preserve legacy commands, integer amounts, core ledger authority, and profile secret references. Device-local runtime configuration and logs remain separate from budgets. Do not install services or dependencies implicitly.

Verify fresh bootstrap, repeat bootstrap refusal, authentication, occupied ports, stale ownership metadata, changed executable, failed health, restart, and bounded shutdown. Use real child processes. Linux proof is unavailable on this Windows machine and must remain explicit. Browser/UI changes are unnecessary for this slice.

Native module failures can be diagnosed when engine initialization returns an error. A corrupt CLI installation that fails before the entrypoint loads cannot produce the CLI JSON contract; retain that installation limit in documentation.
