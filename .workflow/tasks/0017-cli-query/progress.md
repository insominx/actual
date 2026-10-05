# Task Progress: Read-only query metadata, search, paging, and aggregation

Current status: partial; active
Current phase: slice 1 (core schema metadata and pre-execution validation) implemented on Linux; slices 2 (paging, entity lookup) and 3 (aggregate recipes) pending.

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. Prerequisites 0009 and 0012 are completed-locally; this task does not depend on 0014.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Expose read-only schema metadata through the public API and replace TABLE_SCHEMA consumers (version 1 tables/fields output kept verbatim, see D1).
- [ ] Add bounded query execution, stable sorting/paging, and context-aware entity lookup with ambiguity results.
- [ ] Add documented aggregate recipes and tests; explicitly reject SQL writes and avoid deriving cash-planning formulas here.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                       | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------- |
| A1  | All exposed fields/operators validate against core schema; unsupported expressions return structured errors.                                           | Not collected | Pending |
| A2  | Pagination with equal dates has deterministic ID tie-breaking and discloses concurrent snapshot changes.                                               | Not collected | Pending |
| A3  | A split, refund, uncategorized transaction, opening balance, and transfer aggregate matches engine fixtures; query execution creates no ledger writes. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.

- 2026-10-05 00:45 PT: Slice 1. Core `server/aql/schema-metadata.ts` derives table/field metadata from the AQL schema and exposes the compiler's operator and function lists; `validateQuery` compiles without executing. Public API `getQuerySchema()` and `validateQuery(query)` are pure and need no loaded budget. CLI version 2 `query tables`/`query fields` use core metadata; version 2 `query run` compiles against the core schema before connecting and returns INVALID_INPUT with `details.field = "query"`. Evidence: core schema-metadata 4/4, CLI query unit 31/31 (CLI 273/273), api/core/CLI types clean, lint clean. Packaged evidence in implementation.md when captured.
