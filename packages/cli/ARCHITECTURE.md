# CLI architecture and decisions (one page)

Source of truth: the code under `src/`, `integration/` and `.workflow/tasks/0035-cli-acceptance/execution-decisions.md` (D1-D24). This page summarizes them.

## Layers

- **Engine** (`packages/loot-core`, exposed by `packages/api`): owns every budget write. Guarded operations come as `preview*`/`apply*` pairs in `packages/api/methods.ts`; loot-core plans with `prepare*` (read-only, produces a proposal with before/after values and preconditions) and writes with `perform*` inside one mutator.
- **CLI** (`packages/cli`, bundled by `vite build` into `dist/`): commander program (`src/program.ts`, `src/index.ts`), one file per command area in `src/commands/`, and shared services:
  - `connection.ts`/`config.ts`/`profiles.ts`: resolve server, budget and credentials (flags, env, config file, device-local profiles, offline mode), take the budget lock, sync, run the command, release.
  - `engine.ts`: loads `@actual-app/api` (D23). Help, version, `capabilities`, `schema`, `profiles` and `mcp` skip the engine, so `--help` takes about 125 ms instead of 533 ms. Workers and tests always load it.
  - `agent-output.ts`, `agent-contract.ts`, `json-schema.ts`: version 2 JSON envelope `{schemaVersion, operation, context, data, warnings}`, typed errors and the generated `capabilities`/`schema` metadata (`mutates`, `preview`, `previewOperation`, `reversal`, `destructive`; D24).
  - `lock.ts`, `cache.ts`, `change-journal.ts`: per-budget lock (proper-lockfile, 30 s stale window, D19), local cache, durable change receipts.
  - `guarded-changes.ts`, `guarded-operations.ts`, `reversal.ts`: the guarded-write model below.
  - `workflows.ts`, `jobs.ts`, `mcp.ts`, `sync-watch.ts`, `server-runtime.ts`: automation, an MCP stdio server over the same operations, and the managed local server.

## Command areas

accounts, account-groups, budgets (allocations, moves, templates, lifecycle: create, clone, publish, rename, archive), categories, category-groups, transactions, payees, tags, notes, preferences, cash-planning, transfers, imports, rules, schedules, reconcile, reports, checkup, bank-sync, backups, jobs, workflow, changes, query, server, sync, upgrade, mcp, profiles, capabilities, schema, context.

## Guarded-write model

1. `changes preview <operation> [id] --operation-id X --data ...` plans without writing anything except a local receipt (`<data-dir>/.actual-cli/changes`) and returns a token. Planners refuse input the engine would reject or corrupt (D13-D15).
2. `changes apply X --token T` re-plans inside the engine mutation boundary; a changed source is `STALE_PREVIEW` (exit 4).
3. Receipt states: prepared, uncertain (set before the engine call), committed-local, synced, failed-before-commit. An uncertain outcome is never replayed automatically (exit 6); repeating a committed operation only retries sync.
4. In version 2, the direct commands (`DIRECT_GUARDED_COMMANDS`) require `--operation-id` and use the same protocol (preview then apply in one call). `changes reverse` builds a compensating change for `REVERSIBLE_COMMANDS`.
5. Exit codes: 2 invalid input, 3 missing context, 4 stale preview, 5 engine failure, 6 partial completion/uncertain. A budget held by another process is a retryable engine failure with `issue: budget-locked`.

## Decisions at a glance

D1-D8 scope and acceptance setup (six personal workflows, fixtures, contention, MCP evidence). D9-D12 Playwright and VRT policy. D13-D15 adversarial fixes (date and amount floors, transfer refusal, trigger-bearing backups, 50-year cash-plan horizon). D16, D21 slow `changes` suite is sharded, not hung. D17, D24 `capabilities.preview` is honest. D18 keep the 1995 floor. D19 keep the 30 s stale lock. D20, D22 CI runs on GitHub-hosted runners with upstream-only jobs guarded. D23 lazy engine and no bundled TypeScript compiler.

## Test layout

- `src/**/*.test.ts` (vitest, no engine, `@actual-app/api` mocked): contract, parsing, journal, lock, config, program wiring.
- `integration/*.test.mjs` (node:test against the built `dist` and a real local server): one file per area; `harness.mjs`/`seed.mjs`/`guarded-kit.mjs` provide isolated environments and fixtures; `changes-1..3` shard the 86-test `changes` file through `shard.mjs`; `browser-*` suites prove interoperability with the browser build. Build first (`yarn build:cli`, `yarn build:server`); `yarn typecheck` clears both outputs.
- `packages/api/methods.test.ts` and `packages/loot-core` suites (`ENV=node`) cover the engine side; Playwright (`packages/desktop-client/e2e`) covers the UI, with VRT baselines from this box.
- `yarn lint`, `yarn knip`, `yarn typecheck`, `yarn constraints` gate every commit.
