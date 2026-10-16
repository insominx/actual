<!-- RESUME-BEGIN -->

## RESUME (replace, do not append)

State: findings 1-20 fixed, merged and pushed (ledger: findings-ledger.md). Heads at the time of writing: branch = master = the commit after f10b75e25 (docs commit; run `git log -3`). Tree clean. CLI vitest 351 pass, tsgo clean; integration mcp, jobs, lifecycle, sync, reversal (x3), transfers, guarded-transaction-merge, imports, cash-planning, adversarial pass.
Verified clean this segment: reversal was a load flake (3 clean runs; root cause is finding 19); MCP junk-argument fuzz (736 calls, server alive), budgets create/clone name fuzz (ids are sanitized, nothing escapes the data dir), schedules, jobs, preferences, payees, accounts.
Playwright Chromium was missing from ~/.cache/ms-playwright (cache dir gone); reinstalled with `yarn playwright install chromium chromium-headless-shell` (chromium_headless_shell-1228). Browser integration tests and e2e can run again; not re-run yet.
changes.test.mjs: the earlier "timeout" is almost certainly just slowness (about 100 tests, 30-40 s each, 25-minute cap per file in fullsuite.sh), not a hang: tests completed steadily. A full uncapped run with --test-timeout=300000 per test is in progress (log /workspace/adv/changes.log, ends with a CHANGESDONE line). Any test over 300 s would be a real hang: investigate it.
Next 3 steps: (1) read /workspace/adv/changes.log when CHANGESDONE appears; list any failures, root-cause hangs; (2) run browser-*.test.mjs (now that Chromium is back) and rest of the fullsuite on the final build; (3) new rounds: sync conflict edge cases between two clients (rename vs delete, schedule edits), Windows-specific behavior in backups/reports --out (reserved names, trailing dots), CSV/OFX/QIF parser fuzz with odd encodings.
Running processes: changes.sh PID 3088659 with node --test children 3088666 and 3088691 (cwd /workspace/actual/packages/cli). Do NOT rebuild dist (yarn build:cli) while it runs; kill by exact PID if needed. Push with plain `git push origin HEAD:refs/heads/<workflow/complete-remaining-tasks|master>`.
<!-- RESUME-END -->

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
    11a. Printed cron/systemd recipes did not escape `%`/`$` or refuse line breaks (9efd4feb6)
    11b. `changes preview` hid the planner refusal reason (7c43920c4)
    11c. CSV import: exponent amounts (`1e3`) and future two-digit years (acc0bc972)
    11d. Bank sync: empty amounts imported as 0, dates more than a year ahead (8225cd8fd)
    11e. `backups restore` accepted a database with SQLite triggers (99c7431b1)
11. Cash planning: `forecastEndDate` such as 9999-12-31 hung inspect and every later inspect after save (f6de75783)

Workflow: after the steering update, each verified fix is merged straight into `master` of insominx/actual and pushed with the branch (`/workspace/adv/publish.sh`); no PRs.

## Areas covered, no findings

- Backup clone naming/path (clone uses generated ids), budgets rename, carryover/set-amount/hold/move input validation
- Transfers match/unmatch/delete/boundary categories, no orphan links
- Concurrent CLI sessions: same operation applied 4x concurrently applies once; parallel different ops are serialized, stale ones refused
- Secret leakage: ACTUAL_PASSWORD / encryption password absent from outputs and data dir (journal only holds request payloads)
- Budget templates (percent/remainder inputs) preview only; no corruption seen
- Report CSV/HTML export (formula-injection prefixing, HTML escaping)
- Backup artifact read/retention (symlink, boundary, manifest validation, lock)
- Job names/scheduler recipe quoting (names constrained; shell-quoted)

- Backup restore edge cases (zip-slip, absolute paths, truncated/corrupt DB, zip bomb, bad metadata id: all refused), two-client sync conflicts (delete vs edit converges)
- schedules.post/skip: strict next-occurrence check, duplicate post refused, posted rows carry the schedule link
- Randomised transaction op sequences (add, transfer pairs, delete, categorize, clear, match/unmatch/repair, split, merge, update) keep transfer symmetry, split sums (or the engine split error), no orphans (fuzz42.mjs, 3 seeds)
- Reports vs raw rows on the rich fixture (cash-flow, categories, net-worth agree with raw sums)
- Jobs: symlinks and directories in the inbox ignored, existing processed files never overwritten, empty/binary files moved to the error dir
- Cash planning categories/targets (fractional and huge targets accepted, no corruption)

## Resolved without Michael (see D14, D15)

CSV two-digit years/exponent amounts, bank-sync empty amounts/future dates, cron escaping, preview reason, template force/categoryIds (left as intended).

## Still to cover

- Nothing known outstanding; further rounds: cash planning goal.deadline, MCP tool-schema fuzz, more seeds of fuzz42.

## Environmental (not ours)

- ~100 loot-core vitest failures ("reading 'prepare'" on a null db), app-bank-sync and sync.test: identical without our changes.
- integration/browser-*.test.mjs fail here: the Playwright chromium headless shell is not installed on this box.
