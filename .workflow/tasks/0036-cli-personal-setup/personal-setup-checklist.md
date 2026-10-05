# Personal setup checklist (HITL)

This task is blocked on Michael. No real budget was opened and no personal export was committed. The synthetic Chase, Capital One and Robinhood fixtures in `packages/cli/integration/acceptance.test.mjs` (task 0035) are the fixture-only validation of the same command path.

## Blocked inputs (Michael must supply)

- Representative Chase checking CSV (or OFX/QFX) covering at least one full statement month.
- Representative Capital One card export with Debit/Credit (or Amount) columns.
- Representative Robinhood cash export; equity/positions files stay out of the budget (no route).
- Statement dates and ending balances for each included account for that month.
- Explicit selection of the personal budget (sync id or local file) that will receive the setup. The agent must never invent this.
- Confirmation that wife/other-person accounts, equity holdings valuation and automatic bank linking remain out of scope.

Keep source exports, statement PDFs and any private evidence outside the repository. Do not commit them.

## Disposable clone recipe (fixture-safe; use real files only after Michael approves)

1. Confirm the CLI and server are on the same release (`actual upgrade check --server`).
2. Select the personal budget offline and clone it: `actual --offline budgets clone --name "personal-setup-$(date +%Y%m%d)"`. Work only in the clone.
3. Take a backup before any mutation: `actual backups create --directory "$HOME/actual-private/backups"` (path outside the repo).
4. Inspect each export: `actual imports inspect <file> --account <id>` and record the sha256 from the result. Preview: `actual imports preview <file> --account <id>` and confirm date, sign, amount, payee and import-id behavior against the statement.
5. Save routes in a job (do not apply to the real budget yet): `actual jobs create personal-exports --inbox <dir> --processed <dir> --error <dir> --routes '<json>'`. Positions/equity files get no route and must stay `no-route`.
6. Add statement evidence for the clone: `actual checkup statement add --account <id> --month YYYY-MM --ending-balance <cents> [--source <text>]` for each included account.
7. Run the close in the clone only: `actual workflow monthly-close --month YYYY-MM --finish --statements '<json>' --backup-directory "$HOME/actual-private/close-backups"`.
8. Review transfer candidates (`actual transfers check --account <id>`), uncategorized on-budget rows (`actual checkup data-quality`), and net worth (`actual reports net-worth`).
9. Record privately (outside git): which files matched statement totals, any format gap, included account totals, historical coverage, and the backup path.
10. Only after Michael reviews the private report and explicitly selects the personal budget may the same steps be applied to that budget. Never store personal financial exports in git.

## Fixture-only validation already on the branch

Task 0035 A1 exercises the same command path on disposable synthetic exports (Chase checking, Capital One Debit/Credit, Robinhood cash + positions with no route), then categorizes, matches transfers, closes against computed statements, reviews a goal scenario and exports net worth. See `../0035-cli-acceptance/verification-acceptance-linux.txt` and `evidence-report.md`.

Opening-balance note (0035 D3): `workflow setup` dates opening balances on the setup day. When back-filling an earlier month in a clone, move each opening balance to the day before the first imported row with `actual transactions update <id> --data '{"date":"YYYY-MM-DD"}'` before reconciling.

## Acceptance mapping when Michael unblocks

| ID  | How to meet it                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Private evidence that each representative file matches statement totals and dates, or a documented format gap with the inspect/preview output. |
| A2  | Private evidence that card payments reconcile once, included account totals match verified signed balances, and historical coverage is stated. |
| A3  | Backup path recorded before personal mutations; final plan, reload and sync results kept privately with no financial data in git.              |
