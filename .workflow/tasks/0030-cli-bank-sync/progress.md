# Task Progress: Configured bank-sync diagnostics and controlled refresh

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0021-cli-imports](../0021-cli-imports/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Expose provider/account capability and health metadata without secrets through existing API boundaries.
- [ ] Wrap existing bank-sync execution with per-account results and mutation/import receipt semantics.
- [ ] Add controlled fixture provider tests and document manual consent boundaries; do not activate personal automatic connections.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                            | Evidence      | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Disposable fake-provider responses exercise duplicate imports, one-account refresh, partial failures, and rate limiting.    | Not collected | Pending |
| A2  | No connection or expired credentials returns a structured prerequisite without creating a provider connection.              | Not collected | Pending |
| A3  | Post-import sync failure remains committed-local/pending; an empty feed is not interpreted as verified historical coverage. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
