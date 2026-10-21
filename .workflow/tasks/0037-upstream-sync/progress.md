# Task Progress: Bring upstream actualbudget/actual changes into the fork

Current status: waves 1–5 implemented and verified on branch `upstream-sync-2026-10`. The branch is not merged to `master` or pushed.
Current phase: waiting for owner decisions D1 and D3–D10 and the VRT follow-up (D20).

## Dependencies

None. Upstream scope pinned at `80f7518c8` (D12). Upstream had one newer commit, `6ef6d303d`, at execution time; it is out of scope.

## Human input required

- Decisions D1 and D3–D10 in `execution-decisions.md` (D2 adopted).
- Whether to merge `upstream-sync-2026-10` into `master`, and whether to push it.
- VRT regeneration needs the Docker daemon (D20).

## Agent next actions

- [x] Triage all 126 upstream commits since the fork point (`triage.md`).
- [x] Create branch `upstream-sync-2026-10` from `master`; confirm the upstream pin.
- [x] Wave 1: security picks (A1).
- [x] Wave 2: clean data-correctness picks (A2).
- [x] Wave 3: adapted data-correctness picks (A3).
- [x] Wave 4: performance picks in order (A4).
- [x] Wave 5: small UI fixes and extras (A5), except VRT regeneration.
- [x] D2 auto bank sync applied as upstream; bank code aligned with upstream (D21).
- [ ] Apply the remaining approved D1, D3–D10 items (A6).
- [ ] Regenerate the affected VRT screenshots in docker (D20).
- [ ] Merge to `master` when the owner approves; update the `.workflow/README.md` status.

## Implementation checklist

- [x] One `[AI]` commit per upstream commit, made with `git cherry-pick -x`. Adaptations are noted in an `Adapted:` line. The two dependency-bump commits are combined into one `yarn up -R` commit.
- [x] Full gate after each wave group; results are below.
- [x] Fork invariants checked: token expiry in seconds, formula scaling, Sankey labels, `getNextDate` weekend handling, Electron export handler, the Windows build fix, the `budgetReservations` toggle.

## Acceptance trace

| ID  | Required outcome                        | Evidence                                                                                                                 | Status                              |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| A1  | Security wave applied                   | 42e9d79d4 adapted (6 files), plus e4ee6935d, 38de5cadb, 0c571bc47, 7474a9429 and the dependency bumps; wave 1 gate green | Done                                |
| A2  | Clean data-correctness picks applied    | 18 picks, all clean                                                                                                      | Done                                |
| A3  | Adapted picks applied                   | 12 picks; each `Adapted:` note names the fork side kept                                                                  | Done                                |
| A4  | Performance picks in order              | cf34c0e3b; 137922fd6 → 148e5c233 → 0f000bf69; 0728f1a30 → a771f8280                                                      | Done; cold-load timing not measured |
| A5  | UI fixes and extras applied             | 42 picks; 3d6a849b0 adapted (D19)                                                                                        | Done, except VRT (D20)              |
| A6  | D1–D10 recorded; approved items applied | `execution-decisions.md`                                                                                                 | Pending owner                       |
| A7  | Full gate green                         | See the gate results below                                                                                               | Done                                |

## Gate results

| Gate                    | typecheck | core             | web                       | sync-server | cli                                                      | api | electron |
| ----------------------- | --------- | ---------------- | ------------------------- | ----------- | -------------------------------------------------------- | --- | -------- |
| Wave 1 (`1bbbbd13b`)    | pass      | 1586             | 1335                      | 771         | 424                                                      | 148 | 7        |
| Waves 2–4 (`9f4fcd1fb`) | pass      | 2 failed         | 1377 + 4 unhandled errors | 796         | 1 failed (Windows `EPERM` rename flake; passed on rerun) | 148 | 7        |
| Final (`9ec589b24`)     | pass      | 1678 (3 skipped) | 1448                      | 813         | 424                                                      | 153 | 7        |

What the earlier failures were, and the fixes:

- The two core failures and the four web unhandled errors came from upstream tests not matching the fork's test setup. Fixed in `83c7015e3`.
- The first final run found:
  - typecheck errors in 3d6a849b0, which depends on D3/D5;
  - YNAB4 doImport tests that needed a database;
  - a fork bug in `getNextDateAfter`.
- These were fixed in `0e6ec8f17` (the bug, D18) and `9ec589b24` (the rest).

Lint (`oxlint --type-aware` on the 251 changed source files): exit 0, with 230 type-aware warnings and no errors. Format: two files fixed in `6f6712506`; the other differences were CRLF-only.

## Execution decision ledger

See `execution-decisions.md` (D1–D20).

## Execution log

- 2026-10-21: Added the `upstream` remote. A trial merge showed 181 conflicting files. Four parallel reviewers triaged the 126 commits, each trial cherry-picked in a throwaway worktree. Results are in `triage.md`.
- 2026-10-21: Implemented waves 1–5 on `upstream-sync-2026-10`. Waves 2–5 were picked in a temporary worktree while the earlier gates ran, then fast-forwarded. The final full gate is green. See `implementation.md` for the commit list and the adaptations.
