# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

Round 2 (R1-R7) is complete except two items that need Michael or liftoff: (a) Windows-path checks on liftoff, which was offline (retry when connected: existing checkout, fetch/checkout master, disposable budgets only); (b) GitHub Actions on insominx/actual has 0 runs, so R1 CI is unverified until Actions is enabled in repo settings. Hazards: `yarn typecheck`, api tests and `yarn lint --fix` can clear `packages/api/dist` and `packages/sync-server/build`; run `yarn build:cli` and `yarn build:server` before integration tests, and never while a suite runs. loot-core tests need `ENV=node`. Push with `bash /workspace/adv/publish.sh` (needs the approval card). Next decision number is D30.

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
