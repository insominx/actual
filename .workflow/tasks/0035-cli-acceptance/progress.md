# Task Progress: Agent-only workflow acceptance and performance proof

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0034-cli-distribution](../0034-cli-distribution/progress.md), [0032-cli-automation](../0032-cli-automation/progress.md), [0030-cli-bank-sync](../0030-cli-bank-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add packaged agent-only scenario scripts over disposable budgets and fix attributable integration defects within their owning tasks.
- [ ] Run real server/browser round trips for undo, imports, allocations, settings, templates, reservations, cash planning, and concurrent sessions.
- [ ] Record performance measurements and repository-wide baseline failures separately; publish local evidence/capability matrix and explicit unresolved limits.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                                                                                   | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------- |
| A1  | Run the six personal workflows on synthetic Chase/Capital One/Robinhood cash accounts with card/equity boundary fixtures; every outcome is traceable to receipts.                                                  | Not collected | Pending |
| A2  | Root types, focused CLI/API/core/server suites, desktop/mobile browser tests, targeted lint/format, and CLI/API/server/browser builds pass or identify an attributable defect.                                     | Not collected | Pending |
| A3  | Representative large synthetic history records command timings/memory, bounded output, query pagination, and two-client contention; optional MCP has its own parity report and does not block CLI core acceptance. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
