# Task Progress: Headless budget creation, selection, and cloning

Current status: active
Current phase: planned; ready for review-plan after local prerequisite acceptance

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md)

## Human input required

None. The user authorized implementation on 2026-10-02. Local prerequisites now pass. Reread the delivered schemas, profiles, and offline API before reviewing this plan.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Expose any missing supported lifecycle methods at packages/api/methods.ts and corresponding core api handlers, reusing budgetfile initialization.
- [ ] Add create/inspect/select using session context; add explicit publish and rename/archive semantics with no automatic remote destruction.
- [ ] Implement cloning through engine export/import with identity reset; prove original isolation and document lifecycle states.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                   | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | An empty directory reaches a usable budget and account-creation session through CLI only.                                                          | Not collected | Pending |
| A2  | Clone edits leave the original unchanged and cannot push to the original sync ID.                                                                  | Not collected | Pending |
| A3  | Creation failure cleans incomplete artifacts; duplicate names require explicit IDs; publication survives restart with correct encryption metadata. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
