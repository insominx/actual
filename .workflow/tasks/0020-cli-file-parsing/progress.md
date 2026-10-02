# Task Progress: File inspection, parsing, and shared import mappings

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0015-cli-accounts](../0015-cli-accounts/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0017-cli-query](../0017-cli-query/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Extract UI-only normalization/mapping authority into shared/core code with parity fixtures; keep UI behavior unchanged.
- [ ] Expose supported parser methods via API and add inspect/parse against selected account without mutation.
- [ ] Add typed mapping tools through existing prefs with receipts; document supported formats without claiming institution-export compatibility.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                           | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | CSV debit/credit columns, negative card amounts, locale/date formats, encoding, and OFX/QFX IDs match UI parsing fixtures. | Not collected | Pending |
| A2  | A saved CLI mapping is usable in the browser and vice versa; inspect/parse performs no ledger writes.                      | Not collected | Pending |
| A3  | Malformed/oversized/ambiguous input is rejected or explicitly partial; source hash changes invalidate a prepared import.   | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
