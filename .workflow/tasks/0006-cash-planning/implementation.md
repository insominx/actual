# Cash Planning Implementation Record

Last Edited: 2026-10-02
Status: completed for implementation and local verification. Actual account setup and institution-export validation remain a separate step.

## Contract as Executed

Source: the user-supplied Personal cash planning for Actual plan; summarized in plan.md.

The report is available from Reports at `/reports/cash-planning` on desktop and mobile.
It displays signed on-budget ledger balances through today, historical calendar-month averages, editable category targets, two projections, and one optional total-balance goal.
Targets and goal settings save only to the synced `cashPlanning` preference.
Reads make no ledger, allocation, template, schedule, or preference writes.
The existing forecast API and import/reconciliation paths remain intact.

## Authority and Change Map

- `packages/loot-core/src/server/cash-planning/summary.ts` owns account inclusion, leaf classification, transfer boundaries, and summary averaging.
- `packages/loot-core/src/server/cash-planning/app.ts` exposes the read-only handler and retrieves ledger references, honoring category/payee mappings.
- `packages/loot-core/src/shared/cash-planning.ts` owns date fractions, preset ranges, configuration parsing, targets, projections, goals, deadlines, depletion, and chart points.
- `packages/loot-core/src/types/models/cash-planning.ts` defines request, result, configuration, and projection types. Handler registration and synced preference typing use existing extension points.
- `packages/desktop-client/src/hooks/useCashPlanning.ts` keys requests by budget, date range, and current day. It consumes abort signals and suppresses cached figures during refresh/errors.
- `CashPlanning.tsx`, `CashPlanningMoney.tsx`, and `CashPlanningProjection.tsx` provide the report, currency formatting, privacy masking, and projection presentation.
- `ReportRouter.tsx` and `Overview.tsx` provide navigation.
- `sync-events.ts` and `global-events.ts` reset summary queries after applied changes and undo. Both recognize preference events for saved settings.
- The setup guide is linked from the documentation report index and sidebar. It covers account boundaries, opening balances, imports, transfers, reconciliation, and projection limits.

Ledger data remains authoritative. Query results are derived. Form settings remain local until Save. Existing preferences and synchronization own persistence.

## Acceptance Evidence

| Check                                                                                                                | Result            | Evidence                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| $10,000 cash minus $2,000 card debt equals $8,000; card payments do not change net cash or spending                  | Verified          | summary.test.ts; database handler test                                                                                   |
| Checking, savings, and Robinhood transfers do not change income/spending                                             | Verified          | summary.test.ts                                                                                                          |
| Cash-to-equity reduces cash once and appears separately                                                              | Verified          | summary.test.ts; database handler test                                                                                   |
| $12,000 income and $8,000 outflows over two complete months average $6,000/$4,000                                    | Verified          | summary.test.ts; database handler test                                                                                   |
| $8,000 cash reaches a $20,000 goal in six complete months at $2,000 surplus                                          | Verified          | shared/cash-planning.test.ts                                                                                             |
| Target edits change only the target projection; clearing restores history                                            | Verified          | shared tests; desktop/mobile browser tests                                                                               |
| Report reads produce no writes; Save changes only its preference                                                     | Verified          | database dumps plus sync-write observer; browser ledger/allocation/template/schedule snapshots                           |
| Opening balances, uncleared activity, splits, closed/deleted accounts, future dates, refunds, unavailable categories | Verified          | core summary/database tests                                                                                              |
| Partial months, leap years, zero-activity days, deadline headroom, reached/unreachable goals, depletion              | Verified          | shared tests                                                                                                             |
| Budget/range changes discard late responses; refresh/error masking and retry                                         | Verified          | useCashPlanning.test.tsx                                                                                                 |
| Reload, privacy, mobile layout, three themes                                                                         | Verified          | browser tests and captured screenshots                                                                                   |
| Imports, duplicate matching, reconciliation flags, category edits, undo, shared-budget tabs                          | Verified locally  | parser/reconciliation suites and a normal-user-agent shared-worker browser scenario                                      |
| Real Chase/Capital One/Robinhood exports                                                                             | Deferred per plan | No representative exports supplied; guide makes format-level claims only                                                 |
| Remote synchronization server                                                                                        | Not verified      | Local shared-worker tabs and synthetic applied/success events cover client refresh behavior; no remote server configured |

## Verification Record

Commands run from repository root:

- `workflow-verify --task 0006-cash-planning`: passed with the task-specific Yarn profile. `evidence/workflow-verify.txt` records the core, client, and root type checks.

- `yarn workspace @actual-app/core exec vitest run src/server/cash-planning src/shared/cash-planning.test.ts src/server/transactions/import/parse-file.test.ts src/server/accounts/sync.test.ts`: **63 passed**. The 18 cash-planning checks were rerun after the final arithmetic changes and passed.
- `yarn workspace @actual-app/web test src/hooks/useCashPlanning.test.tsx src/sync-events.test.ts src/hooks/useReservations.test.ts`: **19 passed**. Existing reservation freshness behavior remains covered.
- `E2E_START_URL=http://localhost:3012 yarn playwright test cash-planning.test.ts --workers=1 --retries=0 --reporter=list`: **3 passed without retries**. Tests cover desktop, 350px mobile, and normal-user-agent shared-worker tabs using disposable budgets. Theme loops cover auto/light, dark, and midnight. Rectangle assertions verify chart placement after projection text.
- `yarn typecheck`: passed, including root checking and changed strict core/client files.
- `yarn exec lage build:browser --to=@actual-app/web`: passed. This is the browser packaging script's build step, without fetching or resetting the translations repository.
- Targeted `oxfmt --check` and `oxlint --type-aware`: passed for changed source files. Existing unsafe-assertion warnings remain in main.ts and global-events.ts.
- `git diff --check`: passed. Test-generated snapshot line-ending changes were restored; no snapshot changes belong to this feature.

Failure sensitivity: the deleted-category database check failed before the raw-reference fix. Sync/undo client checks failed without the app listeners. Browser privacy checks failed before preference refresh was fixed. Reversing the external-movement sign made the projection test fail with 250100 instead of 150100; the original implementation was restored and all 18 core checks passed. Theme screenshots exposed chart overlap, which the final layout and geometry assertions resolve.

The dedicated core web Vitest configuration includes only platform SQLite/filesystem tests. Filtering it for cash-planning files selected no tests. Cash-planning browser-worker execution is verified through the production-bundle Playwright scenarios.

## Baseline Failures and Limits

Repository-wide formatting has pre-existing failures. The final repository check lists 455 unaffected files after changed sources are formatted. The full listing is in `evidence/repository-format.txt`.
Targeted lint reports no new warnings or errors. Existing unsafe assertions in the handler bootstrap and undo modal logic are unchanged.
The Impeccable engine binary is unavailable; manual review used the existing design documents and theme captures.
The workflow runner initially selected generic npm fallback commands because no task profile existed. That run was interrupted. A task-specific Yarn profile now records the focused checks. The full repository unit suite did not finish; the full browser suite and documentation build were not run. Focused tests, related import/reservation regressions, root type checking, and browser packaging passed.

## Decisions and Change Control

Material decisions are recorded in execution-decisions.md, D1–D5; independent review is pending.
The implementation stayed within the requested report and existing preferences/import boundaries.
Checkpoints: pure arithmetic and summary; real-database reads/persistence; client request lifecycle; browser workflows; theme/layout correction; final formatting and diff inspection.
Changes remain uncommitted and unpublished. Rollback consists of reverting this report's added files and small integration changes; no database migration or actual account setup occurred.

## Resume Anchors

Use the report guide at `packages/docs/docs/reports/cash-planning.md` for the separate account setup step.
Use `summary.test.ts`, `app.test.ts`, `cash-planning.test.ts`, `useCashPlanning.test.tsx`, and the browser test for future regression checks.
