# Task Progress: Bring upstream actualbudget/actual changes into the fork

Current status: planned (not started)
Current phase: triage complete; waiting to start wave 1

## Dependencies

None. Upstream scope pinned at `80f7518c8` (D12).

## Human input required

- Decisions D1–D10 in `execution-decisions.md` (formula semantics, auto bank sync, UI redesigns, tag reports, Monte Carlo phases, dependency/lint bump, release version). Waves 1–5 don't need them.
- Whether to include upstream commits newer than the pin.
- Push and PR policy for the sync branch. Local only by default.

## Agent next actions

- [x] Triage all 126 upstream commits since the fork point (`triage.md`).
- [ ] Create branch `upstream-sync-2026-10` from `master`; confirm the upstream pin.
- [ ] Wave 1: security picks (A1).
- [ ] Wave 2: clean data-correctness picks (A2).
- [ ] Wave 3: adapted data-correctness picks (A3).
- [ ] Wave 4: performance picks in order (A4).
- [ ] Wave 5: small UI fixes and extras (A5).
- [ ] Apply the approved D1–D10 items (A6).
- [ ] Release note, `.workflow/README.md` status update.

## Implementation checklist

- [ ] One `[AI]` commit per upstream commit, made with `git cherry-pick -x`. Adaptations are noted in the commit body.
- [ ] Full gate after each wave (plan section 12); results recorded in `implementation.md`.
- [ ] Fork invariants checked: token expiry in seconds, formula scaling, Sankey labels, `getNextDate`, Electron export, the Windows build fix, the `budgetReservations` toggle.

## Acceptance trace

| ID  | Required outcome                                                         | Evidence | Status      |
| --- | ------------------------------------------------------------------------ | -------- | ----------- |
| A1  | Security wave applied; every advisory fixed or recorded as already fixed | —        | Not started |
| A2  | Clean data-correctness picks applied, tests pass                         | —        | Not started |
| A3  | Adapted picks applied, keeping the fork side per `triage.md`             | —        | Not started |
| A4  | Performance picks applied in order; cache-barrier tests pass             | —        | Not started |
| A5  | UI and extras applied; scoped VRTs regenerated                           | —        | Not started |
| A6  | D1–D10 recorded; approved items applied                                  | —        | Not started |
| A7  | Full gate green after each wave                                          | —        | Not started |

## Execution decision ledger

See `execution-decisions.md` (D1–D14).

## Execution log

- 2026-10-21: Added the `upstream` remote. A trial merge showed 181 conflicting files. Four parallel reviewers triaged the 126 commits, each trial cherry-picked in a throwaway worktree. Results are consolidated in `triage.md`. No changes were applied to `master`.
