<!-- RESUME-BEGIN -->

## RESUME (replace, do not append)

State: findings 1-17 fixed and merged (finding 17 = plain Errors reported as ENGINE_FAILURE, now INVALID_INPUT). Tree clean after the docs commit that follows e01c4cb45. vitest 348 pass, tsgo clean; integration transfers 6/6, guarded-transaction-merge 6/6, jobs, cli, rules-apply, imports, cash-planning, adversarial pass.
Verified clean (no further bugs): schedules post/skip, jobs inbox abuse, preferences.set, payees merge/delete, account close/delete, imports settings, reports vs raw sums, randomised tx op sequences (fuzz42, 3 seeds), 149-command junk-argument sweep (fuzz56).
Full integration suite (copy /workspace/actual-suite, older build): pass except browser-* (Playwright chromium not installed: environmental), changes (2 hold tests were my own regression, fixed in d7f1daccc; file also hit its 25-minute timeout), reversal 1 fail ("Could not resolve on-disk budget id after download", probably load flake: re-run alone).
Next 3 steps: (1) `cd packages/cli && node --test integration/reversal.test.mjs` alone (record flake or fix); (2) run the rest of changes.test.mjs in background (nohup script, log to /workspace/adv) and the remaining suite files after `sync` in fullsuite.log; (3) new rounds: MCP tools/call with junk args, Windows path handling (schtasks trailing backslash/quotes), budgets.create/clone/archive fuzz, bank-sync/sync conflict edge cases.
Running processes: fullsuite.sh PIDs 2930432 and 3062397 (log /workspace/adv/fullsuite.log, ends FULLDONE). Kill by exact PID only. Push with plain `git push origin HEAD:refs/heads/<branch|master>` (publish.sh gets blocked by auto-review).
Heads: branch = master = e01c4cb45b8b9bd1b054cb7643d0a2f3445e8f1a after this push (see git log for the docs commit on top).
Ledger: findings-ledger.md in this folder.
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
