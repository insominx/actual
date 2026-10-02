# Task Progress: Budget backup, validation, restore, and isolated comparison

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0011-cli-budget-lifecycle](../0011-cli-budget-lifecycle/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add API-backed backup create plus manifest/hash handling; validate file completion before declaring success.
- [ ] Add validation and restore-as-new using lifecycle isolation; return differences from two explicit budget identities.
- [ ] Add bounded retention and clear documentation that an encrypted sync budget does not imply an encrypted exported archive.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                 | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Cash balances, transactions, rules, schedules, allocations, reservations settings, and cashPlanning round-trip through a backup. | Not collected | Pending |
| A2  | Corrupt/truncated archives fail validation and preserve the original and existing backup.                                        | Not collected | Pending |
| A3  | Restore-as-new and comparison generate no original-budget writes or remote overwrite; retention keeps the newest valid backup.   | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
