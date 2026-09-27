# Task Progress: expense-only budget view

Current status: active
Current phase: planning complete — ready for review-plan; implementation not started

## Human input required

- None; generic budget spending semantics selected in the plan.

## Agent next actions

- [ ] Review accounting inclusion and split-query boundary in `plan.md`.

## Implementation checklist

- [ ] Compare pinned expense files against current budget/report queries; retain attribution and remove localized name rules.
- [ ] Add pure summary types/function and tests for refunds, split leaves, internal/off-budget transfers, historical hidden/closed data and uncategorized outflows.
- [ ] Add bounded live range query plus budget-scoped display preference; wire complete desktop month view and prove no budget/ledger writes.
- [ ] Add annual navigation, group expansion, mobile rendering, keyboard/scroll behavior and privacy tests.
- [ ] Test range/budget switches, edits, undo and sync; prove subscription cleanup and real AQL inclusion semantics.
- [ ] Add docs/release note; run focused unit/e2e and root type checks and record results.

## Acceptance trace

| Acceptance                                   | Planned proof                   | Evidence                      | Status  |
| -------------------------------------------- | ------------------------------- | ----------------------------- | ------- |
| Correct net expense and transfer/split rules | Pure and AQL fixtures           | Source/local owners inspected | Pending |
| Complete periods and reconciled totals       | Leap/empty/year fixtures        | Plan only                     | Pending |
| No engine/data changes                       | Preference spy + e2e            | Separate local-pref contract  | Pending |
| Live responsive private view                 | Component/e2e and two-tab smoke | Plan only                     | Pending |

## Execution decision ledger

Create `execution-decisions.md` for material deviations; otherwise record `Decision audit: none material` in implementation notes.

## Execution log

- 2026-09-27 — Planned a locale-independent port using current budget accounting; no feature code written.
