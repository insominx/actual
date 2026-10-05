# Task Progress: Import preview, duplicate matching, commit, and history

Current status: completed locally on Linux; Windows rerun pending
Current phase: all three slices implemented and verified on Linux

## Dependencies

[0020-cli-file-parsing](../0020-cli-file-parsing/progress.md), [0018-cli-transactions](../0018-cli-transactions/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance of 0014, 0018, 0019, 0020; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.

## Implementation checklist

- [x] Add preview DTOs to the supported API where missing; route dry-run through read classification and test mutation-free behavior.
- [x] Add source-hash-bound apply and device-local import receipt/history using mutation protocol.
- [x] Add multi-file intake that preserves per-file/account results and transfer review; document heuristic matching uncertainty.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                         | Evidence                                                                                   | Status       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| A1  | Reimporting the same fixture adds no duplicates; imported IDs and heuristic matches have distinct evidence.                                              | `file-imports.test.mjs`, API `guarded file import` (`verification-file-imports-linux.txt`) | Met on Linux |
| A2  | Dry-run leaves transactions/payees/rules/allocations untouched; rules that split or create transfers match actual committed results.                     | `file-imports.test.mjs`, API `guarded file import` (`verification-file-imports-linux.txt`) | Met on Linux |
| A3  | Deleted-row policy, mixed valid/invalid rows, multi-file overlap, changed source/mapping, and post-commit sync failure are handled without blind replay. | `file-imports.test.mjs`, API `guarded file import` (`verification-file-imports-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 01:48 PT: Implemented guarded `imports.file` (preview, hash-bound apply, history) and `imports batch`; packaged `file-imports.test.mjs` 8/8 and API 1/1 on Linux. Decisions D1-D9. Completed locally on Linux; 0022 and 0023 have all prerequisites completed locally.
