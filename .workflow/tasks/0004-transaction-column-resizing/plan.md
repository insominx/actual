Last Edited: 2026-09-27

# Plan: local text-column resizing for transaction tables

Verdict: **ready for review-plan**. Priority 3. Execution: AFK after review. Independent of budget features.

## 1. Current state

Client `components/transactions/table/columns.ts` owns column IDs/visibility defaults; `hooks/useTransactionTableColumns.ts` owns synced order/visibility per view. `components/transactions/TransactionsTable.tsx` defines `TransactionHeader`, virtual rows and `useAmountColumnWidths`. Amount and balance widths already adapt to formatted values. `TransactionList.tsx` passes view configuration. Paths are relative to `packages/desktop-client/src/`.

[shawalli's pinned README](https://github.com/shawalli/actual/blob/2dee0baf8b0ed859c236ce1b80daff232fc67d5e/README.md) describes desktop resizing and local persistence. Its implementation has not been audited in this assessment and the research shows a stale base. Use it as a behavior reference; reimplement against current table ownership rather than copying old table infrastructure.

## 2. Target shape

Add pure `components/transactions/table/columnWidths.ts` (+ tests), `hooks/useTransactionColumnWidths.ts` (+ tests), and a small accessible `ColumnResizeHandle.tsx`. Extend existing table/list/header props so header, leaf/split rows and editing cells use one width map. Add reset-widths action in `components/modals/TransactionTableColumnsModal.tsx` without replacing its order/visibility behavior.

Only `account`, `payee`, `notes`, `group`, and `category` resize in v1. Date, selection, cleared, payment/deposit and balance retain current behavior. Existing amount auto-sizing stays authoritative. Persist per-view widths in budget-scoped LocalPrefs: `'transaction-table-widths': Record<string, Partial<Record<'account' | 'payee' | 'notes' | 'group' | 'category', number>>>`. Define the serializable type at `loot-core/src/types/prefs.ts` without importing client types into core. No new packages or ledger migrations.

## 3. Contract

- Desktop pointer dragging or keyboard adjustment resizes a text column with matching header/body/editor/split alignment. Resize gestures never trigger sorting, row dragging or editing.
- Widths persist on this device for this budget and stable account/pseudo-view ID; reorder/hide/show preserves the width associated with a column ID. Other devices retain their layout.
- Reset affects this view's custom widths only; synced visibility/order is unchanged. Missing/invalid preferences fall back to existing flexible widths.
- Numeric columns retain existing content-aware auto-sizing, mobile transaction cards are unchanged, and resizing/unmount cannot cause an update loop or orphaned event handler.

Domain: width is a device presentation preference, not a synced column-order property. Non-goals: transaction flags, gift-card splits, new table virtualization, mobile resize handles and cross-device pixel dimensions.

| Acceptance                                                            | Proof                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| Header/body/editor/split positions agree after resizing               | Browser geometry assertions on actual virtualized table   |
| Refresh/reorder/hide/show/view switch retains only correct ID's width | Hook and browser interaction tests                        |
| Malformed values and reset preserve usable defaults                   | Pure normalization and preference tests                   |
| Keyboard and pointer controls do not sort/drag/edit                   | Component/browser tests                                   |
| Scrolling/recycling/cancel/unmount clean up                           | Existing drag-drop regression plus resize lifecycle tests |

One completed pointer-resize path is the first checkpoint; persistence and full keyboard/reset follow. Keep any drag-drop bug fix in a separate logical change unless a failing resize test requires it.

## 4. Data / API shape

Store integer CSS pixels keyed by current view ID (`accountId` or the existing `all-accounts`/special IDs). Reject unknown column IDs, non-finite/non-number values and invalid record shapes. Clamp valid numeric widths to 80–1200px; apply a narrower viewport's scroll behavior without overwriting the saved width. Unset widths retain current flex allocation; horizontal overflow is contained by the table. Reset removes that view entry. Local preference schemas must not couple to a desktop module.

## 5. Runtime / loader / UX behavior

Maintain draft width in table-level working state while dragging; commit the latest complete preference map once on pointer release or completed keyboard adjustment. Use pointer capture; pointercancel/Escape restores the pre-drag value and does not persist. Clean up capture/listeners on unmount and view change. Keyboard ArrowLeft/Right changes by 10px; Home restores default for that column; expose a named separator with current/min/max values and visible focus. Provide a menu reset action as an alternative. Do not write preferences from render or ResizeObserver. Limit rendering work to the visible table; preserve stable maps across equivalent renders.

## 7. Authority and state ownership

`columnWidths.ts` owns validation and effective text widths at the table boundary. Source: stored local width map and existing column definitions. Working: current gesture draft. Derived: effective CSS widths shared across header/rows. Persisted: budget-scoped local width map only. Existing synced column manager continues to own visibility/order; `useAmountColumnWidths` owns amounts. Dependency direction: view preferences → table widths → rendering; no ledger/sync writes.

## 8. Proposed approach

1. **AFK: one complete pointer path.** Inspect source resizing concept and current header/row/editor width plumbing. Add validated text width model and table-level draft state; implement a payee handle and propagate matching width to all payee cells. Add browser geometry and sorting-isolation tests. Checkpoint: long payee resizes without virtual-row misalignment or edit/drag behavior changes.
2. **AFK: persistence, remaining text columns and accessible controls.** Add budget/view-local hook, release-only saves, reset action, keyboard/pointer-cancel behavior and other text handles. Test hidden/reordered columns, malformed prefs, close/reopen budget, account/pseudo-view isolation and mobile unchanged. Checkpoint: repeatable resize/reset survives reload without synced-pref writes.
3. **AFK: lifecycle verification and docs.** Test scrolling/recycled rows, zoom, long notes tooltips, active editing, amount auto-sizing and unmount during drag; verify listener cleanup and existing useDragDrop tests. Add concise table customization docs/release note. Do not port flags or unrelated fork modifications.

## 9. Migration

No migration of existing order/visibility preferences. No width key means current layout. Removing/resetting the local map restores automatic layout; old clients ignore it. Read unknown keys defensively for future columns.

## 12. Verification plan

Run from root: `yarn workspace @actual-app/web run test src/components/transactions/table/columnWidths.test.ts src/hooks/useTransactionColumnWidths.test.ts src/hooks/useDragDrop.test.tsx`; run existing `TransactionsTable.test.tsx`; add/run `yarn workspace @actual-app/web run playwright test transaction-column-resizing.test.ts --browser=chromium`; `yarn typecheck`. Manual smoke at desktop/narrow widths, zoom, keyboard-only, active row editor and privacy mode. Browser geometry tests are necessary because jsdom cannot verify alignment. No broad snapshot updates. New checks are planned, not yet run.

## 14. Open questions / missing info

None blocking. Text-only/device-local is a deliberate first scope. Before implementation verify the current view ID reaches the table owner and wire through `TransactionList` where required, rather than deriving it from URL inside cells.
