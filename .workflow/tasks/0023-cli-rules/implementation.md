# Implementation: 0023 cli-rules

## Slice 1: read-only rule test

- `packages/loot-core/src/server/transactions/transaction-rules.ts`: `RuleLedgerContext` gains optional `trace` and `dryRun` (D2); `applyActions` is now `planRuleActions` plus the write.
- `packages/loot-core/src/server/accounts/sync.ts`: `normalizeTransactions` exported.
- Core `server/rules/evaluate.ts`: `testRules` (sample through normalize and `runRules` with trace and dry run) and `findRuleMatches`.
- Handlers `api/rules-test`, `api/rules-matches`; public `testRules`, `findRuleMatches`; CLI `rules test`, `rules matches` (read operations).

## Slice 2: CRUD and order

- CRUD already uses the receipt protocol (`rules.create|update|delete`, 0014). Order is reported by `rules test` (D6). No change to learning (D7).

## Slice 3: historical preview and apply

- Core `server/rules/guarded-apply.ts`: guarded `rules.apply` over frozen IDs (D4, D5). Types `RuleApplyRequest`, `RuleApplyProposal`, `RuleApplyOutcome`; handlers `api/rules-preview-apply`, `api/rules-apply`; public `previewRuleApply`, `applyRuleApply`.
- CLI `rules apply <ruleId> --ids ... --operation-id`, `changes preview rules.apply`; payload schema, journal outcome, direct-command list.
- Docs: `cli.md` Rules section; `upcoming-release-notes/agent-cli-rules-test-apply.md`.

## Verification (Linux)

| Check    | Command                                                                                                              | Result                               |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Core     | `yarn workspace @actual-app/core exec vitest run src/server/transactions/transaction-rules.test.ts src/server/rules` | 240/240                              |
| API      | `yarn workspace @actual-app/api exec vitest run -t "historical rule application"`                                    | 1/1                                  |
| CLI unit | `yarn workspace @actual-app/cli test`                                                                                | 305/305                              |
| Types    | loot-core, API and CLI `tsc`                                                                                         | clean                                |
| Packaged | `node --test integration/rules-apply.test.mjs`                                                                       | 7/7 (`verification-rules-linux.txt`) |

Acceptance mapping:

- A1: `rules test` on a merchant sample returns the category its rule sets; importing the same row stores that category and amount; raw tables (payees, rules) are unchanged by the test, including a rule that renames the payee to a new name.
- A2: ordered `pre` and default rules report `[pre, default]` with the later value; a 50/50 split rule previews the parent and two children that apply writes; a delete rule previews `tombstone` and deletes; the commit is verified against the preview.
- A3: invalid samples and rule definitions, a non-matching transaction, a reconciled candidate without `--allow-reconciled`, and a rule edited after preview (`STALE_PREVIEW`) are rejected; kills before engine, after engine and before sync keep their outcome (guarded-kit).

Limitations: Windows not run. Formula actions are planned by the same `planRuleActions` path but not covered by a packaged fixture. Experimental-feature gating for formulas is the engine's (no extra capability flag). D3 records the import-preview payee gap.

Decision audit: D1-D8 in execution-decisions.md.
