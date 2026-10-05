# Evidence report and capability matrix: agent-only CLI (Linux)

Linux harness results plus Windows liftoff verification for PowerShell tutorial, packed install, and Task Scheduler dry-run (0034/0032). No real personal budget was opened.

## Capability matrix

| Task | Capability (CLI surface)                                                                                                   | Linux evidence                                                         | Status                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| 0014 | Guarded mutations: preview tokens, operation receipts, account create/update/close/reopen/delete, holds, splits, transfers | `0014-cli-mutations/verification-*`                                    | Completed locally                               |
| 0015 | `accounts inspect`, balances, closure plans                                                                                | `0015-cli-accounts/verification-accounts-linux.txt`                    | Completed locally                               |
| 0016 | Categories, groups, payees, notes, preferences (guarded catalog and settings)                                              | `0016-cli-catalog-settings/verification-*`                             | Completed locally                               |
| 0017 | `query` with paging and truncation                                                                                         | `0017-cli-query/verification-query-linux-integration.txt`              | Completed locally                               |
| 0018 | Transactions add/import/categorize/clear/merge/split/delete                                                                | `0018-cli-transactions/verification-transactions-linux.txt`            | Completed locally                               |
| 0019 | `transfers candidates/match/check`                                                                                         | `0019-cli-transfers/verification-transfers-linux.txt`                  | Completed locally                               |
| 0020 | File parsing: `imports inspect/preview` (CSV, OFX/QFX, QIF, CAMT)                                                          | `0020-cli-file-parsing/verification-imports-linux.txt`                 | Completed locally                               |
| 0021 | File imports with manifests, digests and dedupe                                                                            | `0021-cli-imports/verification-file-imports-linux.txt`                 | Completed locally                               |
| 0022 | `reconcile status/finish`, statement evidence                                                                              | `0022-cli-reconciliation/verification-reconciliation-linux.txt`        | Completed locally                               |
| 0023 | Rules list/preview/apply                                                                                                   | `0023-cli-rules/verification-rules-linux.txt`                          | Completed locally                               |
| 0024 | Schedules and occurrences                                                                                                  | `0024-cli-schedules/verification-schedules-linux.txt`                  | Completed locally                               |
| 0025 | Budgeting: set-amount, transfers between categories, templates                                                             | `0025-cli-budgeting/verification-budgeting-linux.txt`                  | Completed locally                               |
| 0026 | Cash planning inspect/save                                                                                                 | `0026-cli-cash-planning/verification-cash-planning-linux.txt`          | Completed locally                               |
| 0027 | Reports: net worth, cash flow, spending; CSV/JSON export                                                                   | `0027-cli-reports/verification-reports-linux.txt`                      | Completed locally                               |
| 0028 | `checkup data-quality`, statement coverage                                                                                 | `0028-cli-data-quality/verification-data-quality-linux.txt`            | Completed locally                               |
| 0029 | `changes inspect`, reversal                                                                                                | `0029-cli-reversal/verification-reversal-linux.txt`                    | Completed locally                               |
| 0030 | Bank sync with a fake SimpleFIN provider                                                                                   | `0030-cli-bank-sync/verification-bank-sync-linux.txt`                  | Completed locally (live provider not exercised) |
| 0031 | `workflow setup/intake/weekly-checkup/monthly-close/goal-review`, run list/inspect/resume/cancel                           | `0031-cli-workflows/verification-workflows-linux.txt`                  | Completed locally                               |
| 0032 | `jobs create/list/status/run/disable/enable/schedule`                                                                      | Linux + Windows schedule dry-run (`verification-scheduler-windows.txt`) | Completed (schtasks /Create not executed) |
| 0033 | `actual mcp serve` stdio adapter                                                                                           | `0033-cli-mcp/verification-mcp-linux.txt` (official SDK client)        | Completed locally; live host E2E blocked        |
| 0034 | Packed install smoke, `upgrade check`, tutorials                                                                           | Linux + Windows (`verification-distribution-windows.txt`)              | Completed (PS + packed on liftoff)     |
| 0035 | Agent-only acceptance and large-history baseline                                                                           | `verification-acceptance-linux.txt`, `performance-baseline-linux.json` | Completed locally                               |

## Correctness (A1)

`integration/acceptance.test.mjs` A1 runs the six personal workflows (decision D2) on a seeded disposable server with synthetic Chase checking, Capital One card and Robinhood cash exports plus a Robinhood positions export that has no route:

1. `workflow setup`: three on-budget accounts with opening balances, Household and Earnings groups.
2. `jobs create` with routes, then `jobs run` of the intake: three files imported, the positions file stays `no-route` (equity boundary). Capital One uses separate Debit/Credit columns.
3. `transactions categorize` (groceries, dining, salary), then `transfers match` for both transfer candidates the run reported (card autopay 50.00 and Robinhood funding 200.00); `transfers check` reports no orphans.
4. `workflow monthly-close --finish` with independently computed statement balances (767000, -11500, 120000 cents): all three accounts reconcile and the close completes, with a backup in a path containing spaces.
5. `budgets set-amount` and `workflow goal-review` with a saved cash plan unchanged by the review.
6. `reports net-worth --export csv` (total 875500 cents in the file) and an October intake paused after its first step, then resumed without reimporting.

Every operation ID collected along the way resolves with `changes inspect`. Result: pass (`verification-acceptance-linux.txt`).

Defect found and fixed: workflow findings with identical messages collapsed into one (D4, commit b78ef8211).

## Package and suite checks (A2)

| Check                                                                                | Result                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------- |
| Root `yarn typecheck`                                                                | Pass                                   |
| CLI unit (`vitest run`)                                                              | 333/333                                |
| Packed CLI and API tarball install (`ACTUAL_TEST_PACKED=1`)                          | 3/3 (0034)                             |
| CLI integration suites per task                                                      | See each task's verification file      |
| Browser interop (`integration/browser-*.test.mjs`, built desktop client in Chromium) | 4/4 (`verification-browser-linux.txt`) |
| Desktop/mobile Playwright suites (`packages/desktop-client/e2e`)                     | Functional **167/167** Linux (D10); VRT not run |

## Performance baseline (A3)

6000 synthetic transactions over 24 months in one checking account. Baseline only, no thresholds (D6). From `performance-baseline-linux.json`:

| Command                                    | ms   | Peak RSS MiB | Output bytes |
| ------------------------------------------ | ---- | ------------ | ------------ |
| accounts list                              | 571  | 187          | 1061         |
| query page (100 rows)                      | 1013 | 382          | 13510        |
| reports cash-flow (24 months)              | 580  | 207          | 51511        |
| checkup data-quality (24 months, limit 50) | 660  | 201          | 25984        |
| workflow weekly-checkup                    | 747  | 195          | 6101         |

The query page returns at most 100 rows with a truncation flag, data-quality honours its limit, and two clients categorizing the same row concurrently end with exit codes 0 and 4 (one commit, one stale conflict) and identical refreshed caches (D7).

## Unresolved limits

- Windows: PowerShell tutorial, packed install, and Task Scheduler *dry-run* completed on liftoff; `schtasks /Create` was not executed.
- Live bank sync and a live MCP host app not exercised (fake provider and official SDK client only).
- Opening balances from `workflow setup` are dated on the setup day (D3); back-filled history needs them moved.
- Functional Playwright completed on Linux 167/167 (D10); VRT screenshot baselines not asserted.
- Performance figures are single-host baselines, not claims.
