# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

Segment ended Fri Oct 16 15:46 PDT 2026 (started 15:22). Round 3 ledger rows 32-45, decisions D30-D41; summary in .workflow/tasks/0035-cli-acceptance/round3-summary.md; all pushed through the commit after 4301c8d65. Green: lint, typecheck, unit suites, api vitest 140, Playwright functional 169, targeted VRT 27 of 27 (the earlier 6 VRT failures were a stray translations clone in packages/desktop-client/locale, moved to /workspace/adv/locale.bak). BACKGROUND JOB: /workspace/adv/gate3.sh PID 3987798 runs full VRT (log /workspace/adv/vrt-full.log) then the CLI integration suite on the final CLI build (log /workspace/adv/integ2.log); read /workspace/adv/gate3.log for '=== GATE3 DONE'; run no builds, typecheck or other suites until it ends. Actions on insominx/actual: 0 runs at 15:22. Liftoff and blacktop offline (Windows checks never ran). Remaining: read gate3.log; fix any VRT or integration regression (VRT baselines only for intentional UI changes, none so far); then one last pass; report done only if everything is green. Push with bash /workspace/adv/publish.sh. Next ledger row 46, next decision D42.

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
