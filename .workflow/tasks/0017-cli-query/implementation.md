# Implementation: 0017 cli-query

## Slice 1: core schema metadata (A1)

- Core: `packages/loot-core/src/server/aql/schema-metadata.ts` (`describeQuerySchema`, `validateQuery`); compiler exports `AQL_FILTER_OPERATORS`, `AQL_LOGICAL_OPERATORS`, `AQL_FUNCTIONS` beside the switch statements they describe. `schema-metadata.test.ts` compiles every advertised operator and function and checks unknown tables, fields, paths, operators and functions fail.
- API: `getQuerySchema()`, `validateQuery(query)` in `packages/api/methods.ts`.
- CLI: `packages/cli/src/commands/query.ts` version 2 tables/fields/run as described in progress.md; `integration/query.test.mjs` is the packaged proof.

Verification so far: core 4/4, CLI unit 273/273, API/core/CLI typecheck clean, oxlint clean on touched paths.

## Slice 2: paging and entity lookup (A2)

- `planPage`, `encodeCursor`, `decodeCursor` and `resolveMatches` in `packages/cli/src/commands/query.ts`; unit proof in `query-paging.test.ts` (5) and `query-resolve.test.ts` (4).
- Core `api/query-snapshot` and public `getQuerySnapshot()` provide the change marker.
- Packaged proof: `integration/query.test.mjs` (2/2), evidence `verification-query-linux-integration.txt`.

Decision audit: D1-D5 in execution-decisions.md.

## Slice 3: aggregate recipe (A3)

- `packages/cli/src/commands/query-aggregate.ts` (`combineAggregate`, `registerQueryAggregate`); unit proof `query-aggregate.test.ts` (2). Packaged proof: third case of `integration/query.test.mjs`.
- Core validateQuery multi-operator rejection with tests in `schema-metadata.test.ts` (5 total).

## Closeout verification (Linux, 2026-10-04)

| Check       | Command                                                             | Result                                           |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| API unit    | `yarn workspace @actual-app/api test`                               | 117/117                                          |
| CLI unit    | `yarn workspace @actual-app/cli test`                               | 284/284                                          |
| Core AQL    | `yarn workspace @actual-app/core exec vitest run src/server/aql`    | 66/66 (8 files)                                  |
| Types       | `yarn typecheck`                                                    | exit 0                                           |
| Packaged    | `node --test integration/query.test.mjs` after CLI and server build | 3/3 (`verification-query-linux-integration.txt`) |
| Lint/format | verify.json lint and format entries                                 | clean                                            |

Limitations: Windows not run; no browser check (read-only surface).
