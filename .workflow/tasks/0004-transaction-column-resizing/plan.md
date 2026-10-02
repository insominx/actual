Last Edited: 2026-09-27

# Plan: local text-column resizing for transaction tables

Verdict: **ready to implement**. Priority 3. Execution: AFK. Independent of budget features. Reviewed by the four-lens plan panel and the high-severity fix loop (2 iterations, 0 high-severity items open).

## Constraint card

| Decision             | Frozen value                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistence          | Device-local `localStorage`, budget-scoped key `${budgetId}-transaction-table-widths`. No synced prefs, no ledger rows, no migration.                                                |
| Lifecycle volatility | Gesture draft is transient table state. Unmount, view-id change, Escape, `pointercancel` and lost pointer capture discard it and write nothing.                                      |
| Operator scope       | Desktop `TransactionsTable` in the account register only. Columns `account`, `payee`, `notes`, `group`, `category`. Mobile cards and `Calendar.tsx` tables unchanged.                |
| Performance stance   | No writes from render, effects or `ResizeObserver`. One write per completed gesture. Handles live in the header only; no per-row listeners.                                          |
| Authority            | Synced column manager owns order and visibility. `useTransactionColumnWidths` owns stored text widths. `useAmountColumnWidths` owns amount and balance widths. Table owns the draft. |
| Gate policy          | C1 → C2 → C3. Each checkpoint in §12 must pass before the next batch starts.                                                                                                         |

## 1. Current state

Paths are relative to `packages/desktop-client/src/` unless stated.

- `components/transactions/table/columns.ts` owns `TRANSACTION_TABLE_COLUMN_IDS` (`date`, `account`, `payee`, `notes`, `group`, `category`, `payment`, `deposit`, `balance`, `cleared`) and visibility defaults. The selection checkbox is a separate 20px cell, not a column id.
- `hooks/useTransactionTableColumns.ts` owns synced order and visibility at `transaction-table-columns-${accountId || 'all-accounts'}`. Special view ids: `onbudget`, `offbudget`, `uncategorized`, `all-accounts`.
- `components/transactions/TransactionsTable.tsx`: `TransactionTableInner` renders a `<View>` holding `TransactionHeader` and the `isAdding` `NewTransaction` block, then a sibling `<View style={{ flex: 1, overflow: 'hidden' }} data-testid="transaction-table">` holding `Table`. `Table` (`components/table.tsx`) renders `FixedSizeList` (`overscanCount={5}`) under an `AutoSizer`; `FixedSizeList` uses `overflow: 'hidden auto'` and a `width: '100%'` inner track. Header alignment with the vertical scrollbar is `paddingRight` from `saveScrollWidth`. Nothing scrolls header and rows together horizontally.
- Text widths are the literal `width="flex"` at each site: `headerConfig`, `PayeeCell` (parent and non-parent branches), `NotesCell`'s `CustomCell`, account `CustomCell`, group `Cell`, category `Cell`/`InputCell`/`CustomCell`. The split-child account placeholder is a `Field` with `style.flex: 1` and no `width`. `Field`/`Cell` map `'flex'` to `{ flex: 1, flexBasis: 0 }` and a number to `{ width }` only (default shrink applies). `Cell` merges `style` last, so a `style` fragment can override.
- Amount and balance widths come from `useAmountColumnWidths` (character-count estimate) and do not read text widths.
- `components/accounts/Account.tsx`: functional `Account()` calls `useTransactionTableColumns(params.id)` and uses `params.id || 'all-accounts'` for `show-extra-balances`. The column modal is opened by the class method `AccountInternal.onManageColumns`, which freezes `{ columns, onSave }` into `pushModal`. `/accounts` and `/accounts/:id` are different routes; switching between two accounts on `/accounts/:id` does **not** unmount the table (`AccountInternal.componentDidUpdate` handles the `accountId` change).
- `TransactionList.tsx`: `TransactionListProps` is a `Pick` of `TransactionTableProps`; new props must be added to that pick. `Calendar.tsx` also renders `TransactionList` and has no view id.
- `hooks/useLocalPref.ts` calls `useLocalStorage(\`${budgetId}-${prefName}\`, undefined, { deserializer: JSON.parse })`with a value-only setter and`budgetId`from`useMetadataPref('id')`. A missing budget id produces an `undefined-`key.`usehooks-ts`3.1.1`setValue(fn)`applies`fn`to a fresh`readValue()`and writes the whole result; it listens to native`storage`and same-tab`local-storage` events; a throwing deserializer is caught and returns the initial value.
- `TransactionTableColumnsModal.tsx` has `onResetToDefault` ("Reset to default"), which stages order and visibility until Save, and an "Apply to all transaction tables" checkbox.
- Mobile account transactions render `TransactionListWithBalances`, not `TransactionsTable`. `SimpleTransactionsTable.tsx` is a separate table and is out of scope.
- Row drag (`useDrag`/`useDrop` from `hooks/useDragDrop.tsx`) starts on rows, not the header. Header sort is a `Button` `onPress` inside `HeaderCell`.

[shawalli's pinned README](https://github.com/shawalli/actual/blob/2dee0baf8b0ed859c236ce1b80daff232fc67d5e/README.md) describes desktop resizing and local persistence. It is an unaudited behavior reference on a stale base. Reimplement against the current table owners; do not copy fork table infrastructure.

## 2. Target shape

### Prop and event wiring

Functional `Account()` resolves `viewId = params.id || 'all-accounts'` and calls `useTransactionColumnWidths(viewId)` beside `useTransactionTableColumns(params.id)`. It passes these optional props into `AccountInternal`:

- `textColumnWidths` (projected widths for this view), `columnWidthsViewKey` (`viewId`), `onCommitColumnWidth(viewKey, columnId, width | null)` → forwarded through `TransactionList` (add all three to the `TransactionListProps` pick) into `TransactionsTable`.
- `hasCustomColumnWidths`, `onResetColumnWidths(viewKey)` → used only by `onManageColumns`.

`onManageColumns` adds `onResetWidths: () => this.props.onResetColumnWidths?.(viewKey)` with `viewKey` read from props at that call, plus `hasCustomWidths`, to the `transaction-table-columns` options in `modals/modalsSlice.ts` (both optional). The modal renders a **Reset column widths** button only when `onResetWidths` is present, disables it when `hasCustomWidths` is false, and disables it after one click (modal-local state). It acts immediately, does not close the modal, never calls `onSave`/`saveColumns`, and ignores the Apply to all checkbox. `onResetToDefault` is unchanged; Apply to all never copies widths.

`TransactionsTable` renders resize handles only when `onCommitColumnWidth` is provided, so `Calendar.tsx` (which omits every new prop) keeps today's layout. Cells receive a resolved style fragment, never the map, callbacks or a view id.

### Column scope

- Resizable: `account`, `payee`, `notes`, `group`, `category`.
- Unchanged: `date` (110), `cleared` (38), `payment`/`deposit`/`balance` (`useAmountColumnWidths`), and the 20px selection cell.
- `group` is display-only: header and body align; no editor exists. Split-child `account` cells are placeholders that still take the column width. Split-child `payee`, `notes`, `category` have editors.

### New and changed files

- New `components/transactions/table/columnWidths.ts` (+ `columnWidths.test.ts`): id allow-list, clamp/round, per-view projection, `resolveTextColumnStyle`, `tableMinWidth`, `patchViewWidths`.
- New `hooks/useTransactionColumnWidths.ts` (+ `useTransactionColumnWidths.test.ts`): sole reader and writer of the stored map (§4).
- New `components/transactions/table/ColumnResizeHandle.tsx` (+ `ColumnResizeHandle.test.tsx`): accessible separator (§5).
- New `components/modals/TransactionTableColumnsModal.test.tsx` for the reset button.
- Changed: `TransactionsTable.tsx` (scroll shell, draft state, style at every text site), `TransactionList.tsx`, `Account.tsx`, `modalsSlice.ts`, `TransactionTableColumnsModal.tsx`, `packages/loot-core/src/types/prefs.ts`.

`LocalPrefs` in `packages/loot-core/src/types/prefs.ts` gains `'transaction-table-widths': Record<string, Partial<Record<'account' | 'payee' | 'notes' | 'group' | 'category', number>>>` with an inline id union (core must not import `columns.ts`). The member documents the key only; nothing calls `useLocalPref('transaction-table-widths')`. No new packages.

Preserved invariants: stable column ids; existing amount widths and keyboard editing; no synced width writes; one geometry for header, ordinary, split, editor and new-transaction rows; cancel, unmount and view change never persist a draft; no stored overrides means today's exact layout.

## 3. Contract

- Desktop pointer drag or keyboard adjustment resizes a text column, and header, ordinary row, split child, active editor and new-transaction row edges stay aligned. Resize gestures never sort, select, row-drag or open an editor.
- Widths persist on this device for this budget and view id (`params.id || 'all-accounts'`). Reorder, hide and show keep the width attached to the column id. Switching views shows each view's own widths. Other devices keep their layout.
- Reset affects only this view's custom widths, immediately; synced visibility and order are unchanged. Missing or invalid stored data falls back to today's flexible widths and is never rewritten on read; only a later completed gesture or reset replaces it.
- A viewport narrower than the configured widths scrolls horizontally and never saves a smaller width.
- Numeric columns keep content-aware auto-sizing, mobile cards are unchanged, and no gesture or unmount leaves a pointer handler, capture or update loop behind.

Domain: width is a device presentation preference, not a synced column property. Non-goals: transaction flags, gift-card splits, new or changed virtualization (`FixedSizeList` stays as is), mobile resize handles, cross-device widths, synced width writes, ledger migrations, changes to `useLocalPref`, cells deriving view identity from the URL, `closed` as a view id.

| Acceptance                                                             | Proof (§12 rows)                                   | Batch |
| ---------------------------------------------------------------------- | -------------------------------------------------- | ----- |
| Header/row/split/editor/new-row edges agree within 1 CSS px            | Playwright geometry protocol (G1–G5)               | C1–C3 |
| Pointer and keyboard do not sort/select/drag/edit                      | Playwright G6; `ColumnResizeHandle.test.tsx` K1–K6 | C1/C2 |
| Reload/reorder/hide/show/view switch keep only the correct id's width  | Hook H1–H8; table T2; Playwright P1–P3             | C2    |
| Malformed values, missing budget id and reset preserve usable defaults | Pure U1–U5; hook H2–H6                             | C2    |
| No synced writes; only the width key changes                           | Playwright P4; modal M1–M2; import check S1        | C2    |
| Cancel, view switch, unmount, recycle clean up with no leak or loop    | Table T1, T4–T6; handle K4; Playwright G5          | C3    |
| Amount widths stay content-aware; narrow viewport scrolls, no write    | Playwright G4, P5                                  | C3    |
| Mobile cards and `Calendar.tsx` tables have no resize handle           | Playwright mobile R1; table T3                     | C1/C3 |

## 4. Data / API shape

`useTransactionColumnWidths(viewId)` is the only reader and writer. It calls `useLocalStorage` directly (with a one-line comment: `useLocalPref` has a value-only setter and a throwing `JSON.parse` deserializer) and must not call `useLocalPref`. `useLocalPref` is not changed.

- Key `${budgetId}-transaction-table-widths`, `budgetId` from `useMetadataPref('id')`. Initial value `{}`. Options object is a module-level constant.
- Missing budget id: ignore whatever is read, return empty widths, and make commit/reset no-ops, so no `undefined-transaction-table-widths` key is ever written.
- Deserializer: `JSON.parse` in `try`; a plain object is returned **raw** (unknown view ids and unknown column keys kept); anything else, including a parse failure, becomes an in-memory `{}`. Reading never writes, so corrupt data is left in place until the next completed gesture replaces it.
- Projection (`columnWidths.ts`): for `raw[viewId]`, keep only the five ids whose value is a finite `number`, then `Math.round` and clamp to 80–1200. Strings (including `'Infinity'`, `'1e999'`), `NaN`, arrays and nested objects are skipped. The projection's identity changes only when the stored value changes. `hasCustomWidths` is "projection is non-empty".
- `commitWidth(viewKey, columnId, width | null)`: no-op if `viewKey !== viewId` or the budget id is missing. No-op (no `setItem`) if the value equals the current projected value. Otherwise `setValue(prev => patchViewWidths(prev, viewKey, columnId, value))`: start from `prev` if it is a plain object else `{}`; start the view entry from `prev[viewKey]` if it is a plain object else `{}`; `null` deletes the column key, a number sets `clamp(Math.round(width))`; an empty view entry is deleted. Unknown keys elsewhere survive untouched.
- `resetWidths(viewKey)`: same guards; deletes `prev[viewKey]`; no write if absent.
- Cross-tab: `usehooks-ts` re-reads on native `storage` events, so another tab's completed width renders here. Two tabs finishing overlapping gestures can lose one (last write wins); localStorage is not atomic and no atomicity work is planned.

Viewport narrowing, zoom and `ResizeObserver` callbacks never call `commitWidth`.

## 5. Runtime / loader / UX behavior

### Geometry

`TransactionTableInner` wraps both existing children (the header/new-transaction `<View>` and the `data-testid="transaction-table"` `<View>`) in one horizontal scroll shell: an outer `View` with `flex: 1, overflowX: 'auto', overflowY: 'hidden'` and an inner `View` with `flex: 1` and, **only when the effective widths contain at least one override**, `minWidth: tableMinWidth(...)`. With no overrides the inner view has no `minWidth`, so today's layout is unchanged. `FixedSizeList` and the `overflow: 'hidden'` wrapper stay as they are; `AutoSizer` measures the inner view, so rows are at least as wide as the header. Vertical scrolling stays on the list; horizontal scrolling moves header, new rows and body together. Known trade-off: when content is wider than the viewport, the vertical scrollbar sits at the content's right edge until the user scrolls right.

`resolveTextColumnStyle(id, widths)` returns `{ width: 'flex' }` when unset, else `{ width: px, style: { flexGrow: 0, flexShrink: 0, flexBasis: px, width: px } }`. Apply it at every text site listed in §1, including the split-child account `Field` (replace its `flex: 1`), split and editor branches, and the header. The new-transaction row uses the same `Transaction` component and so the same sites.

`tableMinWidth` = selection cell (20 when shown) + each visible fixed non-text column (date 110, cleared 38, amount/balance from `useAmountColumnWidths`) + each visible text column (its override, or 80 when unset) + the header's `scrollWidth` padding. Unset text columns keep `flex: 1, flexBasis: 0`, so the leftover space splits evenly and each gets at least 80px. Row height does not change.

### Gesture lifecycle

The table is the only place that merges `textColumnWidths` with the draft. Draft state holds `{ viewKey, columnId, startWidth, pointerId, startX, width }`.

- `pointerdown` on a handle: `preventDefault`, `stopPropagation`, `setPointerCapture`, focus the handle. `startWidth = Math.round(headerCellRect.width)` (covers unset flex columns). All move/up/cancel handling uses React props on the captured handle element; no `window`/`document` listeners.
- `pointermove`: `width = clamp(Math.round(startWidth + clientX - startX))`, 80–1200. Draft only.
- `pointerup`: if `draft.viewKey === columnWidthsViewKey`, call `onCommitColumnWidth(draft.viewKey, columnId, width)` once, then clear the draft and release capture.
- `pointercancel`, `lostpointercapture` without `pointerup`, or Escape: clear the draft (start width shows again), release capture, no commit.
- View change: a `useLayoutEffect` on `columnWidthsViewKey` clears the draft and releases capture before paint. Account-to-account navigation is not an unmount; this effect is the rule that covers it, and the frozen `viewKey` plus the hook's `viewKey !== viewId` guard make a late `pointerup` a no-op.
- Unmount: the same cleanup runs; any later pointer event cannot reach a handler.

### Keyboard and accessibility

`ColumnResizeHandle` is a sibling of the header sort `Button` inside `HeaderCell` (never nested in it), `role="separator"`, `aria-orientation="vertical"`, translated `aria-label` "Resize {column} column", `aria-valuenow` (current px), `aria-valuemin={80}`, `aria-valuemax={1200}`, `tabIndex={0}`, visible focus ring. It is not a slider.

- ArrowLeft/ArrowRight: draft −/+10px (clamped), repeated keydowns update the draft only.
- Home: draft becomes "no override" for that column.
- Commit once on keyup of ArrowLeft/ArrowRight/Home, or on blur while a draft is pending; Home commits `null`.
- Escape before that commit discards the draft and writes nothing.
- Handled keys and pointer events call `stopPropagation` so sort, table navigation and row drag never see them.

The modal **Reset column widths** button (§2) is the menu alternative.

## 7. Authority and state ownership

- Source: stored raw map (`useTransactionColumnWidths`) and existing column definitions.
- Working: the table's gesture draft.
- Derived: projected widths, `resolveTextColumnStyle` fragments and `tableMinWidth` (`columnWidths.ts`, pure).
- Persisted: the budget-scoped local map only.
- Synced column manager keeps visibility/order; `useAmountColumnWidths` keeps amounts; `Account()` owns the view id.
- Direction: view prefs → table widths → rendering. `columnWidths.ts` and `useTransactionColumnWidths.ts` import no synced-pref API.

## 8. Proposed approach

| Batch | Concrete delta                                                                                                                                                                                                                     | Checkpoint (all listed §12 rows pass)                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| C1    | `columnWidths.ts`; `useTransactionColumnWidths` with the final interface backed by in-memory `useState`; all props wired through `Account`/`TransactionList`; scroll shell; payee handle (pointer only); style at every payee site | U1–U4, G1, G2, G4 (payee), G6, K6 (pointer part), T3 |
| C2    | Hook internals switch to `useLocalStorage` (§4); handles for the other four text columns; keyboard; modal reset; `LocalPrefs` type                                                                                                 | U5, H1–H8, K1–K6, M1–M2, T2, G3, P1–P4, S1           |
| C3    | Lifecycle, recycle, narrow viewport, amount, mobile coverage; docs and release note                                                                                                                                                | T1, T4–T6, G4–G5, P5, R1, manual X1–X3; docs present |

1. **C1 — one complete pointer path.** Build the pure module, the scroll shell and a payee handle. The hook exposes its final shape but keeps widths in memory so geometry is proven before storage exists. Checkpoint: payee edges align at 240/80/1200 and a drag does not sort, select or drop.
2. **C2 — persistence, remaining columns, keyboard, reset.** Swap hook internals to `useLocalStorage`, add the other handles, keyboard control and modal reset. Checkpoint: resize/reset survives reload, per-view and per-id, with only the width key written.
3. **C3 — lifecycle, edge cases, docs.** Cancel/unmount/view-switch cleanup, recycled rows, narrow viewport, amount auto-size, mobile, manual scripts, docs and release note.

If C1 edges miss by the vertical scrollbar width, fix the `scrollWidth` padding measurement inside the shell; do not change `FixedSizeList`. The only fallback is letting custom columns shrink in narrow viewports (dropping the scroll shell), which changes the §3 contract and needs user approval first.

Keep any drag-drop bug fix in a separate logical change unless a failing resize test requires it. Do not port flags or other fork changes.

## 9. Migration

None. No stored key means today's layout. Reset or removing the key restores automatic layout; old clients ignore the key. Unknown view ids and column keys are kept on write, so future columns are not lost.

## 12. Verification plan

### Geometry protocol (Playwright, `packages/desktop-client/e2e/transaction-column-resizing.test.ts`)

Setup: `configurationPage.createTestFile()` demo budget; viewport 1280×800, `deviceScaleFactor: 1`, browser zoom 100%. Open one on-budget account and create a split with two children via `accountPage.createSplitTransaction`, so the split sits at the top (newest date). Scroll the list to offset 0. Targets, each confirmed by its row content before measuring: header cell, the split child at index 1, the first ordinary row after the split's children, and that ordinary row's payee editor after clicking the cell. Measure `getBoundingClientRect().left` and `.right`. Drag the handle until the header cell width is the target ±1px.

| Row | Batch | Scenario                                                                                        | Assertion                                                                                                                                                           |
| --- | ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | C1    | Payee at 240, 80 and 1200 (drag to 60 and 1500 to hit the clamps)                               | All four targets share left and right edges within 1 CSS px; header width is 80 and 1200 at the clamps                                                              |
| G2  | C1    | Payee at 240 with the new-transaction row open                                                  | New-row payee cell edges match the header within 1 CSS px                                                                                                           |
| G3  | C2    | Repeat G1 at 240 for `account` (all-accounts view), `notes`, `category`, `group` (made visible) | Same edges; `group` checks header and ordinary row only; split `account` placeholder matches the header                                                             |
| G4  | C1/C3 | Payee at 1200                                                                                   | Shell `scrollWidth > clientWidth`; after scrolling the shell 500px right, header and row edges still agree; amount header width unchanged ±1 from before the resize |
| G5  | C3    | Payee at 240, scroll the list ≥ 30 rows down and back to 0                                      | Re-measured ordinary row (recycled) matches the header within 1 CSS px                                                                                              |
| G6  | C1    | Pointer drag of the payee handle                                                                | Sort field/direction unchanged, no row selected, no editor open, no row moved                                                                                       |

### Persistence and isolation (Playwright, same file; C2 unless tagged)

An init script wraps `Storage.prototype.setItem` to count calls per key.

| Row | Scenario                                                              | Assertion                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Resize payee to 240 in account A; reload                              | Payee still 240                                                                                                                                                                                                                               |
| P2  | Navigate A → account B → A                                            | B shows default payee width; A shows 240                                                                                                                                                                                                      |
| P3  | Hide then show payee via `accountPage.setTransactionColumnVisibility` | Payee returns at 240                                                                                                                                                                                                                          |
| P4  | 20 pointer moves then release; then modal reset; then reload          | 0 `setItem` for the width key during moves, exactly 1 on release, 1 on reset; the width key is the only localStorage key whose value changed; header column id order and visibility are identical before resize, after reset and after reload |
| P5  | C3: resize payee to 1200, then set viewport width to 900              | Shell scrolls; 0 `setItem`; stored value still 1200                                                                                                                                                                                           |

### Unit and component tests (Vitest)

| Row | Batch | File                                          | Scenario → assertion                                                                                                                                                              |
| --- | ----- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | C1    | `columnWidths.test.ts`                        | Clamp 80–1200 and `Math.round` on fractional inputs                                                                                                                               |
| U2  | C1    | `columnWidths.test.ts`                        | Projection drops unknown ids, strings (`'Infinity'`, `'1e999'`), `NaN`, arrays, objects                                                                                           |
| U3  | C1    | `columnWidths.test.ts`                        | `resolveTextColumnStyle` returns `'flex'` when unset and the fixed fragment when set                                                                                              |
| U4  | C1    | `columnWidths.test.ts`                        | `tableMinWidth` sums selection, fixed, amount, override and 80-per-unset widths plus padding; undefined when no overrides                                                         |
| U5  | C2    | `columnWidths.test.ts`                        | `patchViewWidths` keeps other views and unknown column keys; `null` deletes; empty entry removed                                                                                  |
| H1  | C2    | `useTransactionColumnWidths.test.ts`          | Real `localStorage`: commit merges into the latest stored map; other views survive                                                                                                |
| H2  | C2    | same                                          | Invalid JSON, array, string, `'Infinity'` values → empty/partial projection and 0 `setItem` on mount                                                                              |
| H3  | C2    | same                                          | Missing budget id → no `undefined-transaction-table-widths` key after commit and reset                                                                                            |
| H4  | C2    | same                                          | Commit with a stale `viewKey` → 0 `setItem`                                                                                                                                       |
| H5  | C2    | same                                          | Reset removes only the active view entry; reset with no entry → 0 `setItem`                                                                                                       |
| H6  | C2    | same                                          | Same-value commit → 0 `setItem`                                                                                                                                                   |
| H7  | C2    | same                                          | Two commits keep an unknown column key and an unknown view id written beforehand                                                                                                  |
| H8  | C2    | same                                          | Seed storage, dispatch a native `StorageEvent` for the key → hook returns the incoming width; a following commit preserves other entries                                          |
| K1  | C2    | `ColumnResizeHandle.test.tsx`                 | Role, label, `aria-valuenow/min/max`, focusable                                                                                                                                   |
| K2  | C2    | same                                          | 3× ArrowRight keydown then keyup → draft +30, exactly one commit with start+30                                                                                                    |
| K3  | C2    | same                                          | Home keydown+keyup → one commit with `null`                                                                                                                                       |
| K4  | C2    | same                                          | ArrowRight keydown, Escape, then keyup/blur → 0 commits, start width restored                                                                                                     |
| K5  | C2    | same                                          | Blur with a pending draft → one commit                                                                                                                                            |
| K6  | C1/C2 | same                                          | Pointer and handled keys do not reach a parent sort `onPress` or `onKeyDown` spy                                                                                                  |
| M1  | C2    | `TransactionTableColumnsModal.test.tsx` (new) | Reset calls `onResetWidths` once and neither `onSave` nor any save path, with Apply to all checked and unchecked                                                                  |
| M2  | C2    | same                                          | No reset button without `onResetWidths`; disabled when `hasCustomWidths` is false and after one click                                                                             |
| T1  | C3    | `TransactionsTable.test.tsx`                  | Pointerdown+move, rerender with a new `columnWidthsViewKey`, pointerup → 0 commits; rendered width is the new view's in the same `act`                                            |
| T2  | C2    | same                                          | Rerender with reordered `columns` → payee cell keeps its width                                                                                                                    |
| T3  | C1    | same                                          | No `onCommitColumnWidth` → no separator rendered (Calendar path)                                                                                                                  |
| T4  | C3    | same                                          | Pointerdown+move, unmount, dispatch `pointerup` on `document` → 0 commits                                                                                                         |
| T5  | C3    | same                                          | `pointercancel` and `lostpointercapture` → 0 commits, start width restored                                                                                                        |
| T6  | C3    | same                                          | Spies on `window`/`document` `addEventListener`/`removeEventListener` for `pointer*`/`key*`: adds equal removes after unmount mid-drag; no "Maximum update depth" `console.error` |
| S1  | C2    | review check                                  | `rg "SyncedPref                                                                                                                                                                   | saveColumns"`over`packages/desktop-client/src/components/transactions/table/columnWidths.ts`and`packages/desktop-client/src/hooks/useTransactionColumnWidths.ts` returns nothing |

Hook tests use the real hook on controlled `localStorage`; do not mock normalization or merge. Existing `useDragDrop.test.tsx` and `TransactionsTable.test.tsx` stay green.

### Mobile (Playwright, C3)

| Row | File                          | Scenario → assertion                                                                                             |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R1  | `e2e/accounts.mobile.test.ts` | At 350×600 open an account: the mobile list renders and `getByRole('separator', { name: /Resize/ })` has count 0 |

### Manual scripts (C3; record pass/fail and a screenshot in `progress.md`)

- X1 Privacy mode: enable privacy mode, resize payee to 240 → redacted values stay inside the cell and the handle still works. Failure: text overflows or the handle is unreachable.
- X2 Zoom: browser zoom 150%, resize payee → header and row edges visually align and amounts stay content-sized. Failure: visible offset.
- X3 Keyboard-only: Tab from the account header to a payee handle, adjust with arrows, reset via the modal → focus ring visible at each step; no sort. With payee at 1200, Tab into the rightmost row cell → the shell scrolls it into view. Failure: focus lost, sort triggered, or focused cell off-screen.

Long-notes tooltips are not acceptance; spot-check during X1.

### Commands (repo root)

- `yarn workspace @actual-app/web run test src/components/transactions/table/columnWidths.test.ts src/hooks/useTransactionColumnWidths.test.ts src/components/transactions/table/ColumnResizeHandle.test.tsx src/components/modals/TransactionTableColumnsModal.test.tsx src/components/transactions/TransactionsTable.test.tsx src/hooks/useDragDrop.test.tsx`
- `yarn workspace @actual-app/web run playwright test transaction-column-resizing.test.ts accounts.mobile.test.ts --browser=chromium`
- `yarn typecheck` (covers `Calendar.tsx` with the new props optional)

Existing files: `TransactionsTable.test.tsx`, `useDragDrop.test.tsx`, `e2e/accounts.mobile.test.ts`. New: the others above. Playwright keeps screenshot-on-failure; no broad snapshot updates. None of these checks have run yet. Rollback: remove the optional props, handles and shell; synced order/visibility prefs are untouched and the local key is ignored.

## 13. Documentation notes

- Add a short section to `packages/docs/docs/tour/accounts.md` and extend the existing Manage table columns steps in `packages/docs/docs/getting-started/tips-tricks.md`: text-only resizing, device-local per-view persistence, keyboard controls, and the separate Reset column widths button.
- Add `upcoming-release-notes/transaction-column-resizing.md`.
- Task folder: `plan.md` (canonical) and `progress.md` (status, trace, log). The plan-panel review artifacts were absorbed into this plan and deleted; see the `progress.md` execution log.

## 14. Open questions / missing info

None blocking. Deferred with rationale:

- Cross-tab atomicity: last completed gesture wins (§4); no locking.
- Changing `FixedSizeList` overflow or adding a shared `Cell` fixed-width mode: rejected; the scroll shell and a `style` fragment keep the change local.
- Horizontal scroll syncing between separate header and list scrollers: rejected in favor of one shell.
- Auditing the fork README: behavior reference only.
- `closed` view id: accepted by `queries.accountFilter` but has no route; out of scope.
- Section numbers 6, 10 and 11 are intentionally absent (template sections with no content for this task); other docs cite §12 and §13 by number.
