# Quality pass (non-feature) - checklist and resume

<!-- QRESUME-BEGIN -->

## RESUME (replace, do not append)

All nine areas are complete (see table). Hazards: `yarn typecheck`, api tests and `yarn lint --fix` runs can clear `packages/api/dist` and `packages/sync-server/build`; run `yarn build:cli` and `yarn build:server` before integration tests. loot-core tests need `ENV=node` (or `ENV=web ... -c vitest.web.config.ts`). Push with `bash /workspace/adv/publish.sh` (needs the approval card). Open recommendations for Michael: lazy-load the engine for faster startup; `capabilities.preview` truthfulness; enable Actions on the fork (runs-on); dev-tool dependency advisories.
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
