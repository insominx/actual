# Task Progress: transaction text-column resizing

Current status: active
Current phase: planning complete — ready for review-plan; implementation not started

## Human input required

- None for text-only device-local widths.

## Agent next actions

- [ ] Review header/row/editor alignment and pointer/keyboard contract.

## Implementation checklist

- [ ] Inspect pinned fork resizing idea and current table props; document adaptation/attribution and current view ID path.
- [ ] Add validated text width model and a complete payee pointer-resize path sharing width across header, row, split and editor; add real browser alignment test.
- [ ] Add budget/view-local width persistence and other text handles; preserve current amount auto-sizing and synced order/visibility.
- [ ] Add accessible keyboard control, Escape/pointercancel cleanup and per-view reset; verify no sorting or row-drag side effects.
- [ ] Cover reload, reorder/hide/show, view isolation, malformed prefs, virtual-row recycling and unmount during drag.
- [ ] Add docs/release note and run focused table/hook/browser tests plus root typecheck.

## Acceptance trace

| Acceptance                               | Planned proof          | Evidence                                              | Status  |
| ---------------------------------------- | ---------------------- | ----------------------------------------------------- | ------- |
| Aligned resizing                         | Browser geometry       | Current width owners inspected                        | Pending |
| Persistence and reset isolation          | Hook/browser tests     | Existing local preference budget scope confirmed      | Pending |
| Accessible gestures without side effects | Keyboard/pointer tests | Plan only                                             | Pending |
| Cleanup and virtual rows                 | Lifecycle tests        | Existing drag-drop tests pass; resize not implemented | Pending |

## Execution decision ledger

Create `execution-decisions.md` for material deviations; otherwise record `Decision audit: none material` in implementation notes.

## Execution log

- 2026-09-27 — Planned adaptation of resizing only; current order/visibility and automatic amount widths preserved.
