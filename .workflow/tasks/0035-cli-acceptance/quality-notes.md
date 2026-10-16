# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

Segment ended Fri Oct 16 15:21 PDT 2026 (started 14:55). Round 3 ledger rows 32-43 and D30-D38 done; all pushed through the commit after 1ddfbaf14. Green so far: gate stage 1 (lint, typecheck, knip baseline, cli unit, loot-core node, desktop-client unit), CLI integration 315 of 317 (2 env-gated skips, /workspace/adv/integ1.log), lint and typecheck again at 15:19 and api vitest 140 of 140 (/workspace/adv/gate2.log). BACKGROUND JOB: /workspace/adv/gate2.sh PID 3939921 is running Playwright functional then VRT (E2E_USE_BUILD, web build rebuilt at 15:01 with the cash planning fix); check /workspace/adv/gate2.log for '=== GATE2 DONE'; do not run builds, typecheck or other suites until it ends. Actions on insominx/actual: 0 runs at 14:55. Liftoff and blacktop offline at 14:55 (Windows checks skipped). Remaining: read gate2.log, fix any Playwright regressions, confirm the integration suite still passes on the final dist (CLI rebuilt 15:18 for row 43; run yarn test:integration in the background once gate2 ends), then a final pass over all angles; report done only if nothing new. Push with bash /workspace/adv/publish.sh. Next ledger row 44, next decision D39.

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
