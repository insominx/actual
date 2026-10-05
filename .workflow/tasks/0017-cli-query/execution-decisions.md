# Execution decisions: 0017 cli-query

- D1 (ASSUMPTION for Michael to review, 2026-10-05): version 1 `query tables` and `query fields` keep their exact legacy JSON (the hand-written list, now named LEGACY_TABLE_SCHEMA) because section 9 preserves default legacy JSON. Version 2 output and all table validation use core metadata. The plan's "replace TABLE_SCHEMA consumers" is therefore met for version 2 and validation, not for legacy output.
- D2 (ASSUMPTION for Michael to review, 2026-10-05): `query run --table` now accepts every core schema table (for example notes, preferences, tags), not only the six legacy names. This only widens accepted input. Malformed `--filter` JSON now fails as INVALID_INPUT in both versions instead of a raw SyntaxError.
- D3 (2026-10-05): metadata and validation are pure API functions (no `send`), so discovery works without a budget, server or session. They read the same core schema and compiler the engine executes, so there is no second schema.
