# Implementation: 0027 cli-reports

## Slice 1: core report owner

- Core `server/reports/ledger-reports.ts`: `cashFlowReport`, `categoryReport`, `netWorthReport` over `v_transactions_internal_alive` (D2, D4-D6). Shared request `{start, end, accountIds?, includeFuture?, details?}` (YYYY-MM, at most 60 months) and shared `scope`/`completeness` blocks.
- Handlers `api/reports-cash-flow`, `api/reports-categories`, `api/reports-net-worth` (file must be open); public `getCashFlowReport`, `getCategoryReport`, `getNetWorthReport` and types `ReportRequest`, `ReportScope`, `ReportCompleteness`, `ReportDetailRow`.

## Slice 2: CLI reports and drill-down

- `packages/cli/src/commands/reports.ts`: `reports cash-flow|categories|net-worth --from-month --to-month [--accounts] [--include-future] [--details]` (read operations, D8, D10). Drill-down is `contributingIds` (at most 1000, `contributingTruncated`) plus optional `details` rows.

## Slice 3: export

- `packages/cli/src/report-export.ts`: CSV and HTML documents with the scope and completeness metadata (D7, D9); `--export csv|html --out <file>`, never overwriting. Comparison is two calls (D3). PDF deferred.
- Docs: `cli.md` Reports section, README row, `upcoming-release-notes/agent-cli-reports.md`.

## Verification (Linux)

| Check    | Command                                                              | Result                                                         |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "ledger reports"` | 1/1 (uses `includeFuture` because the API test clock is fixed) |
| CLI unit | `yarn workspace @actual-app/cli test`                                | 315/315 (adds `report-export.test.ts`)                         |
| Types    | loot-core, API and CLI `tsc`                                         | clean                                                          |
| Packaged | `node --test integration/reports.test.mjs`                           | 3/3 (`verification-reports-linux.txt`)                         |

Acceptance mapping:

- A1: on the seeded fixture plus a row in a category deleted afterwards, August cash flow is income 2000, expense -16700, net -14700 with five contributing leaf rows (split children instead of the parent, the on-budget transfer excluded); categories give Groceries -8000 (refund netted), Dining -5000, the deleted category -700 flagged `deleted`, uncategorized -1000, and category totals equal the cash flow net. Reports leave the raw budget unchanged.
- A2: net worth at the August month end is net cash -14700 with tracking 0; at the current month the off-budget Equity account is in `tracking`, `netCash` equals the on-budget account sum, `netWorth` is their sum, and checking equals its ledger sum through the cutoff (the 2099 row and a next-month row excluded). A next-month row is excluded by default (`futureDated: excluded`) and counted with `--include-future`.
- A3: a CSV export of July to August carries the note that history before 2026-08-01 is unknown, quotes and apostrophe-prefixes `=HYPERLINK(...)` notes and an `@evil` payee, and keeps cents next to decimals (`-700,-7.00`); the HTML export escapes `<script>`, carries the same note and loads nothing external; exporting to an existing path and `--export pdf` are refused with `INVALID_INPUT`.

The first packaged run also caught decimal CSV cells such as `-167.00` being apostrophe-prefixed; plain signed decimals are now written as numbers (unit-tested).

Limitations: Windows not run. No browser parity run against the desktop report pages (D2). Payee report and compare are not separate operations (D3). Decimal columns assume two decimal places (D7).

Decision audit: D1-D10 in execution-decisions.md.
