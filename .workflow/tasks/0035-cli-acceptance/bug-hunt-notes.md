# Adversarial bug hunt notes (resume log)

Branch `workflow/complete-remaining-tasks`. Regression tests: `packages/cli/integration/adversarial.test.mjs`,
`packages/loot-core/src/server/transactions/guarded-rows.test.ts`, `packages/cli/src/{json-schema,utils}.test.ts`.

## Fixed (one `[AI]` commit each)
1. transactions.add/import dangling refs, pre-1995 dates, forged transfer links, unbalanced splits (f3a469313)
2. JSON schema validator inherited-names bypass (b6762be1e)
3. Amounts above 2^51-1 (engine limit) bricked the budget (b96499752)
4. transactions.update / reconcile.adjust invalid or pre-1995 dates (b5e825a7f)
5. Schedule recurrences the engine cannot evaluate (230bb49a4)
6. Rules writing dangling categories via guarded add/import (20f74c79e)
7. "[object Object]" engine error messages in the CLI (00e2b8d41)
8. File import: amount beyond engine limit imported as 0 (247f68e2b)
9. MCP operands could inject CLI flags / retarget sync id (fe09febed)
10. Bank sync / legacy add stored provider amounts beyond engine limit (9973c97a4)

## Areas covered, no findings
- Backup clone naming/path (clone uses generated ids), budgets rename, carryover/set-amount/hold/move input validation
- Transfers match/unmatch/delete/boundary categories, no orphan links
- Concurrent CLI sessions: same operation applied 4x concurrently applies once; parallel different ops are serialized, stale ones refused
- Secret leakage: ACTUAL_PASSWORD / encryption password absent from outputs and data dir (journal only holds request payloads)
- Budget templates (percent/remainder inputs) preview only; no corruption seen
- Report CSV/HTML export (formula-injection prefixing, HTML escaping)
- Backup artifact read/retention (symlink, boundary, manifest validation, lock)
- Job names/scheduler recipe quoting (names constrained; shell-quoted)

## Still to cover
- Backup restore edge cases, sync conflicts between two devices, cash-planning rounding, schedules.post/skip edge cases
- Backup restore/clone, sync conflicts/concurrent sessions, MCP argument abuse,
  secret leakage in logs/evidence, transfer matching, budget carryover/reservation rounding,
  file-import CSV quirks (fuzz20.mjs in /workspace/adv, settings shape needs `dateFormat` like `yyyy mm dd`).

## Needs Michael's decision (not changed)
- CSV import: 2-digit years pivot forward (`01 01 94` -> 2094), empty amount imports as 0, `1e3` imports as 13.00 (upstream looselyParseAmount).
- Bank sync accepts provider dates far in the future (2066) and empty amounts as 0.
- `budgets.apply-templates` rejects `categoryIds` together with `force` and reports template errors for categories outside `categoryIds`.
