# Execution decisions: transaction text-column resizing

Material deviations from `plan.md` made during implementation (2026-09-27).

## D1. No in-memory hook stand-in for C1

Plan §7 allowed C1 to ship `useTransactionColumnWidths` backed by memory before C2 switched it to `useLocalStorage`. All three batches ran in one session, so the hook landed with storage directly and C1 checks ran against the final hook. The interface is the one the plan pins.

## D2. Gesture state split between table and handle

The table owns only the draft `{ viewKey, columnId, width }`. Pointer id, start X, start width and the "moved" flag live in refs inside `ColumnResizeHandle`. Handles are keyed by `columnWidthsViewKey`, so a view switch remounts them and drops any gesture, and the table's layout effect clears the draft. T1, T4 and T5 cover the behavior the plan asked for.

## D3. T6 counts listeners added after the drag starts

jsdom and React register unrelated listeners during mount. T6 compares only `pointer*` and `key*` listeners added to `window`/`document` after pointerdown with those removed by unmount, and checks for no "Maximum update depth" error. React pointer props mean the handle adds no global listeners, so the balance is zero.

## D4. Split-child account placeholder: width, not left edge (G3)

Existing layout puts a split child's select/delete cell just before its first content column, after the blank date and account placeholders. The placeholder therefore sits 20px left of the header while having the same width. G3 asserts the placeholder width matches the header within 1px and that the child's payee cell edges match the header, which is the alignment users see.

## D5. Shell scrolls focused cells into view (found in X3)

`useProperFocus` focuses with `preventScroll: true` when focus moves within the same row, so with payee at 1200 a Tab to the Deposit input left it off-screen (`scrollLeft` stayed 0). The scroll shell now handles `onFocus` with `revealFocusedElement`, which scrolls horizontally only, and only when the table overflows. Added the Playwright test "tabbing to an off-screen cell scrolls it into view".

## D6. Manual X1–X3 run as a scripted browser session

X1–X3 ran as a throwaway Playwright script (Chromium, dev server) that measured edges and saved the screenshots in `evidence/`. Browser zoom 150% was emulated with a 853×533 viewport at `deviceScaleFactor` 1.5, which gives the same CSS-pixel layout as zooming a 1280×800 window. The script was deleted afterwards.
