import type { CSSProperties } from 'react';

import type { TransactionTableColumnId } from './columns';

// Only the free-text columns can be resized. Date and cleared have fixed
// widths and the amount columns size themselves to their content.
export const RESIZABLE_TEXT_COLUMN_IDS = [
  'account',
  'payee',
  'notes',
  'group',
  'category',
] as const satisfies readonly TransactionTableColumnId[];

export type ResizableTextColumnId = (typeof RESIZABLE_TEXT_COLUMN_IDS)[number];

export type TextColumnWidths = Partial<Record<ResizableTextColumnId, number>>;

export const MIN_TEXT_COLUMN_WIDTH = 80;
export const MAX_TEXT_COLUMN_WIDTH = 1200;

const SELECTION_CELL_WIDTH = 20;
const TRAILING_CELL_WIDTH = 5;
const FIXED_COLUMN_WIDTHS: Partial<Record<TransactionTableColumnId, number>> = {
  date: 110,
  cleared: 38,
};

export function isResizableTextColumn(id: string): id is ResizableTextColumnId {
  return (RESIZABLE_TEXT_COLUMN_IDS as readonly string[]).includes(id);
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function clampColumnWidth(width: number): number {
  return Math.min(
    MAX_TEXT_COLUMN_WIDTH,
    Math.max(MIN_TEXT_COLUMN_WIDTH, Math.round(width)),
  );
}

/**
 * Read the widths for one view out of the raw stored map. Anything that
 * isn't a finite number for a known text column is ignored.
 */
export function projectViewWidths(
  raw: unknown,
  viewId: string,
): TextColumnWidths {
  const result: TextColumnWidths = {};
  if (!isPlainObject(raw)) {
    return result;
  }

  const entry = raw[viewId];
  if (!isPlainObject(entry)) {
    return result;
  }

  for (const id of RESIZABLE_TEXT_COLUMN_IDS) {
    const value = entry[id];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[id] = clampColumnWidth(value);
    }
  }
  return result;
}

export type TextColumnStyle =
  | { width: 'flex'; style?: undefined }
  | { width: number; style: CSSProperties };

export function resolveTextColumnStyle(
  id: ResizableTextColumnId,
  widths: TextColumnWidths | undefined,
): TextColumnStyle {
  const width = widths?.[id];
  if (width == null) {
    return { width: 'flex' };
  }
  return {
    width,
    style: { flexGrow: 0, flexShrink: 0, flexBasis: width, width },
  };
}

type TableMinWidthOptions = {
  columns: readonly TransactionTableColumnId[];
  widths: TextColumnWidths | undefined;
  amountColumnWidths: { amount: number; balance: number };
  scrollWidth: number;
};

/**
 * The narrowest the table can get before it scrolls horizontally. Only
 * defined when at least one visible text column has a custom width, so the
 * default layout keeps shrinking with the window as it always has.
 */
export function tableMinWidth({
  columns,
  widths,
  amountColumnWidths,
  scrollWidth,
}: TableMinWidthOptions): number | undefined {
  const hasOverride = columns.some(
    id => isResizableTextColumn(id) && widths?.[id] != null,
  );
  if (!hasOverride) {
    return undefined;
  }

  let total = SELECTION_CELL_WIDTH + TRAILING_CELL_WIDTH + scrollWidth;
  for (const id of columns) {
    if (isResizableTextColumn(id)) {
      total += widths?.[id] ?? MIN_TEXT_COLUMN_WIDTH;
    } else if (id === 'payment' || id === 'deposit') {
      total += amountColumnWidths.amount;
    } else if (id === 'balance') {
      total += amountColumnWidths.balance;
    } else {
      total += FIXED_COLUMN_WIDTHS[id] ?? 0;
    }
  }
  return total;
}

/**
 * Set (or with `null`, clear) one column's width for one view, keeping every
 * other view and any keys this version doesn't know about.
 */
export function patchViewWidths(
  prev: unknown,
  viewKey: string,
  columnId: ResizableTextColumnId,
  width: number | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainObject(prev) ? { ...prev } : {};
  const prevEntry = next[viewKey];
  const entry: Record<string, unknown> = isPlainObject(prevEntry)
    ? { ...prevEntry }
    : {};

  if (width == null) {
    delete entry[columnId];
  } else {
    entry[columnId] = clampColumnWidth(width);
  }

  if (Object.keys(entry).length === 0) {
    delete next[viewKey];
  } else {
    next[viewKey] = entry;
  }
  return next;
}

export function removeViewWidths(
  prev: unknown,
  viewKey: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainObject(prev) ? { ...prev } : {};
  delete next[viewKey];
  return next;
}
