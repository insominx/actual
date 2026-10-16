<!-- RESUME-BEGIN -->

## RESUME (replace, do not append)

State: findings 1-21 fixed, merged and pushed (ledger: findings-ledger.md). Branch = master = the commit after 48e4b36d1 (docs commit; run `git log -3`). Tree clean. loot-core import tests 30 pass, CLI vitest 351 pass, tsgo clean. Finding 21 (QIF quadratic parse, `Array.shift`) is fixed in source but NOT yet in `packages/cli/dist` (no rebuild while changes.sh runs).
Verified clean this segment: reversal (flake from finding 19), MCP junk-argument fuzz (736 calls, server alive after fix 18), budgets create/clone name fuzz, jobs, preferences, payees, accounts, query junk (deep nesting gives a generic engine failure, no hang), import parsers (CSV BOM/UTF-16/wide/huge, XML entity bomb and XXE, deep OFX/XML: no leak or hang; only QIF was slow), guarded add/import size caps (1 MiB receipt, 1000 rows: clear refusals).
Playwright: Chromium reinstalled (`yarn playwright install chromium chromium-headless-shell`). BUT `packages/desktop-client/build` no longer exists (box cleanup), so browser-*.test.mjs (they serve the web client from the sync server) fail at the sign-in page: need `REACT_APP_NETLIFY=true yarn build:browser --skip-translations` (several minutes, heavy CPU) before browser/e2e/VRT can run again. Not done.
changes.test.mjs: not a hang. Full uncapped run (--test-timeout=300000) is in progress: all tests so far pass at 11-40 s each (about 100 tests, roughly 60+ min total; the old 25-minute cap in fullsuite.sh was just too short). Log /workspace/adv/changes.log (ignore its first lines from an aborted run), ends with a CHANGESDONE line.
Next 3 steps: (1) when CHANGESDONE appears read /workspace/adv/changes.log; list failures, treat any test over 300 s as a hang to root-cause; (2) then `yarn build:cli` (picks up finding 21), run imports/file-imports/imports-related integration, and `yarn build:browser` to restore the browser tests; (3) new rounds: sync conflicts between two clients (rename vs delete; schedule edit vs delete), Windows `--out` reserved names, checkup against dead references.
Running processes: changes.sh PID 3088659 with node --test children 3088666 and 3088691 (cwd /workspace/actual/packages/cli). Do NOT run `yarn build:cli` while they run. Kill by exact PID only. Push with plain `git push origin HEAD:refs/heads/<workflow/complete-remaining-tasks|master>`.
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
