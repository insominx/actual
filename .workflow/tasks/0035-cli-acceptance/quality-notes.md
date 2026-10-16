# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

Segment ended Fri Oct 16 14:54 PDT 2026 (started 14:25). Round 3 ledger rows 32-41 and D30-D37 done; all pushed. Gate stage 1 green at 14:54 (/workspace/adv/gate1.log: lint, typecheck, knip baseline hints only, build:cli, build:server, cli unit 389, loot-core node 1409, desktop-client 1263). No background jobs running. Liftoff and blacktop offline (checked 14:25 and 14:17). Done this segment: reservations vs hand-computed (6 cases match), cash-planning and reservation property tests, expense-view bound fix (row 40), sync angle (concurrent clients, SIGKILL writers, corrupt cache: row 41). Remaining: api vitest (clears api dist and sync-server build; run yarn build:cli and yarn build:server after), key CLI integration suites in the background (node --test integration/*.test.mjs, log to /workspace/adv), Playwright functional and VRT, sync-server version-mismatch probe, Playwright adversarial UI inputs (reservations, expense view, column resizing, cash planning), list_workflow_runs re-check (0 at last check), Windows only if liftoff connects. Then report done only after a full pass finds nothing new. Push with Everything up-to-date
Everything up-to-date
f0775482653a56c3251ac9edcf2000da7fd8f055. Next ledger row 42, next decision D38.

<!-- QRESUME-END -->

| #   | Area                                           | Status      | Notes                                                                                |
| --- | ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| 1   | Performance                                    | in progress |                                                                                      |
| 2   | Stale lock after SIGKILL                       | todo        | 30 s window (proper-lockfile `stale: 30000`)                                         |
| 3   | Error messages / exit codes                    | todo        |                                                                                      |
| 4   | Docs accuracy                                  | todo        |                                                                                      |
| 5   | Test health                                    | in progress | loot-core 109 failures fixed (one cause); node 1380/1380, web 10/10                  |
| 6   | Code quality (lint/format/typecheck/dead code) | in progress | `yarn lint` clean (was 59 lint errors + 16 unformatted files)                        |
| 7   | Dependencies / packaging                       | in progress | stats.json excluded from tarball; prod audit clean, 95 dev-tool advisories inherited |
| 8   | D13 relax-or-keep                              | todo        |                                                                                      |
| 9   | CI sanity                                      | todo        |                                                                                      |

## Round 2 checklist (Michael approved all seven)

| #   | Item                                                                                                               | Status                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| R1  | Fork CI: depot runners to ubuntu-latest                                                                            | done (D22; fork has 0 runs, unverifiable: D29)          |
| R2  | Lazy-load the engine for faster startup                                                                            | done (D23; 533 to 125 ms)                               |
| R3  | capabilities.preview honest (D24)                                                                                  | done (D24)                                              |
| R4  | Quiet dev-tooling audit advisories                                                                                 | done (D26; leftovers listed)                            |
| R5  | Adversarial round: templates, cash-planning rounding, restore across versions, schedules, Windows paths on liftoff | done except Windows paths on liftoff (offline; D27-D29) |
| R6  | One-page architecture and decisions overview                                                                       | done (packages/cli/ARCHITECTURE.md)                     |
| R7  | Test speed, flake detector, metadata.json race retry                                                               | done (D25; flake-detect.mjs, fixture cache)             |
