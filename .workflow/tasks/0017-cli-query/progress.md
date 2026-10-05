# Task Progress: Read-only query metadata, search, paging, and aggregation

Current status: completed locally on Linux
Current phase: A1-A3 verified with unit and packaged evidence on Linux. Windows validation has not been run on this branch; remaining work is a Windows rerun of verify.json and review of D1-D7.

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. Prerequisites 0009 and 0012 are completed-locally; this task does not depend on 0014.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Expose read-only schema metadata through the public API and replace TABLE_SCHEMA consumers (version 1 tables/fields output kept verbatim, see D1).
- [x] Add bounded query execution, stable sorting/paging, and context-aware entity lookup with ambiguity results.
- [x] Add documented aggregate recipes and tests; explicitly reject SQL writes and avoid deriving cash-planning formulas here.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                       | Evidence                                                          | Status            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------- |
| A1  | All exposed fields/operators validate against core schema; unsupported expressions return structured errors.                                           | schema-metadata.test.ts; verification-query-linux-integration.txt | Verified on Linux |
| A2  | Pagination with equal dates has deterministic ID tie-breaking and discloses concurrent snapshot changes.                                               | query-paging.test.ts; verification-query-linux-integration.txt    | Verified on Linux |
| A3  | A split, refund, uncategorized transaction, opening balance, and transfer aggregate matches engine fixtures; query execution creates no ledger writes. | query-aggregate.test.ts; verification-query-linux-integration.txt | Verified on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.

- 2026-10-04 23:40 PT: Slice 1. Core `server/aql/schema-metadata.ts` derives table/field metadata from the AQL schema and exposes the compiler's operator and function lists; `validateQuery` compiles without executing. Public API `getQuerySchema()` and `validateQuery(query)` are pure and need no loaded budget. CLI version 2 `query tables`/`query fields` use core metadata; version 2 `query run` compiles against the core schema before connecting and returns INVALID_INPUT with `details.field = "query"`. Evidence: core schema-metadata 4/4, CLI query unit 31/31 (CLI 273/273), api/core/CLI types clean, lint clean. Packaged evidence in implementation.md when captured.
- 2026-10-04 23:43 PT: Slice 2 paging. Version 2 `query run` returns `{ rows, page, snapshot }`: pages default to 1000 rows (maximum 10000), fetch one extra row to report `truncated`, append an `id` tie-breaker to non-aggregate queries, and return `nextCursor`. A cursor binds the next offset to a hash of the query and to the `api/query-snapshot` marker (persistent-source fingerprint, D5); a changed marker sets `snapshot.changedSinceCursor` and adds a warning. Evidence: CLI unit 278/278 including query-paging 5/5; CLI types clean. Packaged proof pending.
- 2026-10-04 23:45 PT: Entity lookup `query resolve <table> <text>` (accounts, payees, categories, category_groups, schedules, tags) matches exact id, then case-insensitive exact name, then substring, and reports `unique`, `ambiguous` or `none` with context fields; deleted rows are excluded by the engine. Packaged A1/A2 proof passes 2/2 (verification-query-linux-integration.txt): core-schema discovery, pre-connection INVALID_INPUT for unknown operator/field/path, legacy version 1 tables unchanged, five equal-date rows paged 2+2+1 in id order with no duplicates, and a change from a second client disclosed on the next page with --require-fresh. CLI unit 282/282.
- 2026-10-04 23:47 PT: Slice 3. `query aggregate [--start] [--end] [--account] [--splits leaves|parents]` groups engine AQL sums by category and reports transfers, starting balances and uncategorized rows as their own groups, with inflow/outflow so refunds stay visible, deleted categories marked `deleted` and missing ones `unavailable`. Grouped totals must equal the engine total or the command fails. Packaged A3 proof on the seeded split/refund/uncategorized/transfer/opening-balance fixture passes and the raw budget database is byte-for-byte unchanged by the reads (3/3 in verification-query-linux-integration.txt). The first packaged run caught a real AQL gotcha: a condition object with two operators applies only the first, so `{date: {$gte, $lte}}` silently ignored the end bound. The aggregate now uses $and, and core validateQuery rejects such conditions (D7).
- 2026-10-05 00:05 PT: Closeout. The query snapshot marker now uses the persistent-source fingerprint because local-only budgets record no CRDT messages (caught by the new API test). Section 12 checks on Linux: API 117/117, CLI unit 284/284, core AQL 66/66, `yarn typecheck` exit 0, oxlint and oxfmt on touched paths, packaged `integration/query.test.mjs` 3/3 after a fresh CLI and server build. `verify.json` added and `query.test.mjs` plus the guarded transaction add/import files joined `test:integration`. Dependent readiness: 0018, 0020, 0026 and 0027 no longer wait on 0017; they still wait on their other prerequisites (0014, 0015, 0016, 0019, 0025 per the manifest). Limitation: no Windows run and no browser convergence check, because query is read-only and writes nothing to sync.
