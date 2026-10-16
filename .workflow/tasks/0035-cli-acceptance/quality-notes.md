# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

Written Fri Oct 16 16:29 PDT 2026 (segment started 16:22). Round 3 rows 32-46, decisions D30-D44; summary in .workflow/tasks/0035-cli-acceptance/round3-summary.md. startRuntime race fixed in commit 2bf1837cc (unit test server-runtime.test.ts; runtime and lifecycle integration tests passed 3 of 3 on the rebuilt dist). BACKGROUND JOB: /workspace/adv/gate4.sh PID in /workspace/adv/gate4.pid runs the full CLI integration suite on the final dist (log /workspace/adv/integ3.log, status /workspace/adv/gate4.log, look for '=== GATE4 DONE'); started 16:28, takes about 18 min. Run no builds, typecheck or other suites until it ends. After it ends: if green, run VRT only for 'import csv file twice' plus a 2-worker accounts+budget run (E2E_USE_BUILD=1 E2E_PORT=3017 VRT=true npx playwright test --browser=chromium --reporter=line, no package-browser), then say done with the final master SHA. GitHub is not used (D42). Windows checks never ran (liftoff offline). Push with bash /workspace/adv/publish.sh as its own Shell call. Next ledger row 47, next decision D45.

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
