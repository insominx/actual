# Personal setup checklist

Completed on Linux as **fixture-only** (decision D6). Michael declined to share real personal financial data, so A1-A3 are proven against disposable synthetic Chase, Capital One and Robinhood exports only. No real personal budget was opened and no personal export was committed.

Synthetic shapes match task 0035 acceptance and live in `packages/cli/integration/personal-setup.test.mjs` (and the related CSVs built in-test).

## Fixture-only path (done)

1. `workflow setup` with Chase Checking, Capital One Card, Robinhood Cash.
2. Move opening balances to the day before imported history (`transactions update`).
3. `backups create --directory <disposable>` before mutations.
4. `imports inspect` / `imports preview` with institution field mappings.
5. `jobs create` / `jobs run` with routes; Robinhood positions files stay `no-route`.
6. Categorize, `transfers match`, `transfers check` (card autopay + brokerage funding).
7. `checkup statement add` and `workflow monthly-close --finish` against computed statement balances (767000 / -11500 / 120000 cents).
8. `reports net-worth` and `checkup data-quality` for the month.

Evidence: `verification-personal-setup-linux.txt`.

## Deferred real-budget HITL (Michael optional)

Only if Michael later supplies representative exports, statement dates/balances, and an **explicit** personal budget id:

1. Confirm CLI and server release alignment (`actual upgrade check --server`).
2. Clone offline: `actual --offline budgets clone --name "personal-setup-$(date +%Y%m%d)"`. Work only in the clone.
3. Backup outside the repo: `actual backups create --directory "$HOME/actual-private/backups"`.
4. Inspect/preview each export; record sha256 privately.
5. Save routes in a job; positions/equity stay unrouted.
6. Add statement evidence; run monthly close in the clone only.
7. Review transfers, data-quality, and net worth.
8. Keep private evidence outside git. Apply to the real budget only after explicit selection.

Opening-balance note (D5): `workflow setup` dates opening balances on the setup day; move them before reconciling back-filled months.

## Non-goals (unchanged)

No wife accounts, equity holdings valuation, automatic bank linking, or storage of personal financial exports in git.
