# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

Segment ended Fri Oct 16 16:22 PDT 2026 (started 15:49). Round 3 rows 32-45, decisions D30-D43; summary in .workflow/tasks/0035-cli-acceptance/round3-summary.md. gate3 finished (no background jobs running): VRT 168/169 and CLI integration 317/320 (2 env skips). The 2 failures are flakes that passed on isolated reruns (D43): VRT `import csv file twice` (text anti-aliasing under 2 workers) and CLI `managed lifecycle ...` (real narrow race in startRuntime, server-runtime.ts ~205: stop request throws ownership-unconfirmed instead of startup-failed). GitHub is not used (D42); local gates are the source of truth. Windows checks never ran (liftoff offline). Remaining decision: harden startRuntime (catch the stop failure, still report startup-failed with details.stopConfirmed false, regression test), then yarn build:cli and rerun only integration/runtime.test.mjs a few times plus the full integration suite once; then say done only if all green. Push with bash /workspace/adv/publish.sh. Next ledger row 46, next decision D44.

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
