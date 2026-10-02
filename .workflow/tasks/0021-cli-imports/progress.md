# Task Progress: Import preview, duplicate matching, commit, and history

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0020-cli-file-parsing](../0020-cli-file-parsing/progress.md), [0018-cli-transactions](../0018-cli-transactions/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add preview DTOs to the supported API where missing; route dry-run through read classification and test mutation-free behavior.
- [ ] Add source-hash-bound apply and device-local import receipt/history using mutation protocol.
- [ ] Add multi-file intake that preserves per-file/account results and transfer review; document heuristic matching uncertainty.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                         | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Reimporting the same fixture adds no duplicates; imported IDs and heuristic matches have distinct evidence.                                              | Not collected | Pending |
| A2  | Dry-run leaves transactions/payees/rules/allocations untouched; rules that split or create transfers match actual committed results.                     | Not collected | Pending |
| A3  | Deleted-row policy, mixed valid/invalid rows, multi-file overlap, changed source/mapping, and post-commit sync failure are handled without blind replay. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
