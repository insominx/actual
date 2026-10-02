# Task Progress: Categories, payees, tags, notes, and preference tools

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Extend existing catalog commands with inspect/move/merge consequences and preview/apply receipts.
- [ ] Add notes commands and typed preference metadata/allowlist through public API, returning scope explicitly.
- [ ] Test hidden/deleted references, migration destinations, and cross-client changes; document each preference authority.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                               | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Payee merge and category retirement preserve transaction totals and update references in CLI and browser.                                                      | Not collected | Pending |
| A2  | Hidden/deleted categories remain discoverable where needed; duplicate names are explicit.                                                                      | Not collected | Pending |
| A3  | Notes and allowed synced preferences survive reload/sync; invalid keys fail, missing reads do not write defaults, and cashPlanning uses its typed domain tool. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
