# Implementation: 0035 cli-acceptance

## Slice 1: agent-only scenarios (A1)

- `packages/cli/integration/acceptance.test.mjs` A1: six personal workflows (D2) on synthetic Chase, Capital One (Debit/Credit columns) and Robinhood cash exports with a positions export that has no route (D5); every operation ID resolves with `changes inspect`.
- Defect fixed in the owning task: workflow findings de-duplicated by message only (D4, `packages/cli/src/workflows.ts`).
- Opening balances moved before back-filled history in the scenario (D3).

## Slice 2: large history, contention and browser interop (A2, A3)

- A3: 6000 synthetic transactions, timings and peak RSS per command, bounded output, a 100-row query page, data-quality limit, and two-client contention with converged caches (D6, D7). Metrics: `performance-baseline-linux.json`.
- Browser interop: the CLI-owned `integration/browser-*.test.mjs` suites against the built desktop client in Chromium (D9).
- `acceptance.test.mjs` added to the CLI `test:integration` script.

## Slice 3: evidence

- `evidence-report.md`: capability matrix 0014-0035, correctness, package checks, performance baseline and unresolved limits. MCP parity is 0033's report (D8).

## Verification (Linux)

| Check                             | Command                                                                         | Result                                                    |
| --------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Acceptance                        | `node --test integration/acceptance.test.mjs` (with `ACTUAL_TEST_METRICS_OUT`)  | 2/2 (`verification-acceptance-linux.txt`)                 |
| Workflows regression after D4 fix | `node --test integration/workflows.test.mjs`                                    | 1/1                                                       |
| Browser interop                   | `node --test integration/browser-{sync,imports,catalog,cash-planning}.test.mjs` | 4/4 (`verification-browser-linux.txt`)                    |
| CLI unit                          | `yarn workspace @actual-app/cli exec vitest run`                                | 333/333                                                   |
| Root types                        | `yarn typecheck`                                                                | pass (after type-only fixes in loot-core guarded modules) |
| Lint/format                       | `oxlint --type-aware`, `oxfmt` on touched files                                 | clean                                                     |

Acceptance mapping:

- A1: met on Linux by the A1 scenario; the D4 defect is fixed and regression-tested.
- A2: root types, CLI unit, packaged install (0034), per-task CLI integration suites and browser interop pass; the full desktop/mobile Playwright suites were not run (D9).
- A3: met on Linux; baseline recorded without thresholds; MCP parity in 0033.

Windows rerun pending.

## Linux functional Playwright (D10)

- Command: `E2E_USE_BUILD=1 E2E_WORKERS=2 yarn e2e` (VRT unset).
- Fix: `e2e/page-models/reports-page.ts` Cash Flow locator `/^Cash Flow/` (Cash planning collision).
- Result: **167 passed** (`verification-playwright-functional-linux.txt`).
