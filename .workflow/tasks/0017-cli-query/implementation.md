# Implementation: 0017 cli-query

## Slice 1: core schema metadata (A1)

- Core: `packages/loot-core/src/server/aql/schema-metadata.ts` (`describeQuerySchema`, `validateQuery`); compiler exports `AQL_FILTER_OPERATORS`, `AQL_LOGICAL_OPERATORS`, `AQL_FUNCTIONS` beside the switch statements they describe. `schema-metadata.test.ts` compiles every advertised operator and function and checks unknown tables, fields, paths, operators and functions fail.
- API: `getQuerySchema()`, `validateQuery(query)` in `packages/api/methods.ts`.
- CLI: `packages/cli/src/commands/query.ts` version 2 tables/fields/run as described in progress.md; `integration/query.test.mjs` is the packaged proof.

Verification so far: core 4/4, CLI unit 273/273, API/core/CLI typecheck clean, oxlint clean on touched paths.
