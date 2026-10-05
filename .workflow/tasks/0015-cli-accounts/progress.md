# Task Progress: Account management, groups, and balance inspection

Current status: partially implemented
Current phase: inspect and account groups implemented locally on Linux; opening-balance preview and Windows rerun open

## Dependencies

[0011-cli-budget-lifecycle](../0011-cli-budget-lifecycle/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (0014 completed locally on Linux; ASSUMPTION for Michael to review: Linux acceptance is sufficient to start this task.)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Add a dedicated opening-balance preview (today the opening balance is part of the guarded `accounts.create` proposal).
- [ ] Rerun the packaged proofs on Windows.

## Implementation checklist

- [x] Extend account inspect/balance output with engine-owned balance definitions and groups commands. (`accounts inspect`, `account-groups list|create|update|delete`)
- [x] Wrap create/opening-balance/update in changes protocol; reject invalid account references and ambiguous names. (create, update and opening balance were guarded in 0014; `accounts update --account-group-id` added; names resolve through `query resolve accounts`, which reports ambiguity)
- [x] Add receipt-backed close/reopen/delete and off-budget changes; prove consequences in disposable budgets. (delivered and proven by 0014 `changes.test.mjs`)
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness. (Linux done; Windows and browser checks open)

## Acceptance trace

| ID  | Required outcome                                                                                                        | Evidence                                                                                                                                         | Status       |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| A1  | 1000000 cash and -200000 card produce 800000 signed total; future transactions and off-budget equity are distinguished. | `integration/accounts-inspect.test.mjs`, `verification-accounts-linux.txt`                                                                       | Met on Linux |
| A2  | Opening balance, zero-balance closure, nonzero closure, reopen, and account-group edits survive reload/sync.            | 0014 `changes.test.mjs` account creation/closure/reopen cases (86/86); group rename reaches an independent client in `accounts-inspect.test.mjs` | Met on Linux |
| A3  | Duplicate account names fail ambiguous resolution; delete preview shows impacted ledger rows before apply.              | `query resolve accounts` returns `ambiguous` in `accounts-inspect.test.mjs`; delete preview from 0014 account deletion cases                     | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-05 00:16 PT: `accounts inspect` (core `server/accounts/inspect.ts`, public `inspectAccounts()`).
- 2026-10-05 00:19 PT: guarded account groups (core `server/account-groups/guarded.ts`, public preview/apply methods, CLI `account-groups`).
- 2026-10-05 00:27 PT: `accounts update --account-group-id`, packaged proof 1/1, docs and release note.

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
