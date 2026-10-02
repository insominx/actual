import { useMemo } from 'react';

import { useLocalStorage } from 'usehooks-ts';

import {
  clampColumnWidth,
  isPlainObject,
  patchViewWidths,
  projectViewWidths,
  removeViewWidths,
} from '#components/transactions/table/columnWidths';
import type {
  ResizableTextColumnId,
  TextColumnWidths,
} from '#components/transactions/table/columnWidths';

import { useMetadataPref } from './useMetadataPref';

type StoredColumnWidths = Record<string, unknown>;

const EMPTY_STORED_WIDTHS: StoredColumnWidths = {};
const EMPTY_WIDTHS: TextColumnWidths = {};

function deserializeStoredWidths(value: string): StoredColumnWidths {
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const STORAGE_OPTIONS = {
  deserializer: deserializeStoredWidths,
  serializer: JSON.stringify,
};

export type UseTransactionColumnWidthsResult = {
  widths: TextColumnWidths;
  hasCustomWidths: boolean;
  commitWidth: (
    viewKey: string,
    columnId: ResizableTextColumnId,
    width: number | null,
  ) => void;
  resetWidths: (viewKey: string) => void;
};

/**
 * Device-local text column widths for one transaction table view. The stored
 * map is budget-scoped and holds every view's widths; only completed resize
 * gestures and resets write to it.
 */
export function useTransactionColumnWidths(
  viewId: string,
): UseTransactionColumnWidthsResult {
  const [budgetId] = useMetadataPref('id');
  // Not useLocalPref: it has a value-only setter and a throwing JSON.parse
  // deserializer, and writes here must merge into the latest stored map.
  const [stored, setStored] = useLocalStorage<StoredColumnWidths>(
    `${budgetId}-transaction-table-widths`,
    EMPTY_STORED_WIDTHS,
    STORAGE_OPTIONS,
  );

  const widths = useMemo(
    () => (budgetId ? projectViewWidths(stored, viewId) : EMPTY_WIDTHS),
    [budgetId, stored, viewId],
  );

  const commitWidth = (
    viewKey: string,
    columnId: ResizableTextColumnId,
    width: number | null,
  ) => {
    if (!budgetId || viewKey !== viewId) {
      return;
    }
    const value = width == null ? null : clampColumnWidth(width);
    if ((widths[columnId] ?? null) === value) {
      return;
    }
    setStored(prev => patchViewWidths(prev, viewKey, columnId, value));
  };

  const resetWidths = (viewKey: string) => {
    if (!budgetId || viewKey !== viewId || stored[viewKey] === undefined) {
      return;
    }
    setStored(prev => removeViewWidths(prev, viewKey));
  };

  return {
    widths,
    hasCustomWidths: Object.keys(widths).length > 0,
    commitWidth,
    resetWidths,
  };
}
