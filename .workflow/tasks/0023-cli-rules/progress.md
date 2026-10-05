# Task Progress: Rule testing, previews, and controlled application

Current status: completed locally on Linux; Windows rerun pending
Current phase: all three slices implemented and verified on Linux

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md), [0021-cli-imports](../0021-cli-imports/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review D3 (rule-set payee names are created during import previews).

## Implementation checklist

- [x] Expose isolated rule test/evaluation via core/API and add test command before historical bulk apply.
- [x] Extend CRUD and order handling with schema validation/receipts and feature-capability metadata.
- [x] Add historical preview/apply over frozen IDs; prove parity with imports and no dry-run side effects.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                              | Evidence                                                                                   | Status       |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| A1  | Sample merchant categorization test matches import execution without creating payees or modifying rule learning.              | `rules-apply.test.mjs`, API `historical rule application` (`verification-rules-linux.txt`) | Met on Linux |
| A2  | Ordered overlapping rules and split/formula/delete actions preview the same result as apply.                                  | `rules-apply.test.mjs`, API `historical rule application` (`verification-rules-linux.txt`) | Met on Linux |
| A3  | Invalid definitions, stale rule versions, reconciled candidates, and unavailable experimental features return precise errors. | `rules-apply.test.mjs`, API `historical rule application` (`verification-rules-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 02:02 PT: Implemented `rules test`, `rules matches` and guarded `rules.apply`; packaged `rules-apply.test.mjs` 7/7 and API 1/1 on Linux. Decisions D1-D8 (D3 is an engine gap for Michael). Completed locally on Linux.
