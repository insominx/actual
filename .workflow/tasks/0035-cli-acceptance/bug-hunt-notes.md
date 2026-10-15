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

## Areas covered, no findings
- Report CSV/HTML export (formula-injection prefixing, HTML escaping)
- Backup artifact read/retention (symlink, boundary, manifest validation, lock)
- Job names/scheduler recipe quoting (names constrained; shell-quoted)

## Still to cover
- Backup restore/clone, sync conflicts/concurrent sessions, MCP argument abuse,
  secret leakage in logs/evidence, transfer matching, budget carryover/reservation rounding,
  file-import CSV quirks (fuzz20.mjs in /workspace/adv, settings shape needs `dateFormat` like `yyyy mm dd`).
