import { useEffect, useRef, useState } from 'react';

import {
  buildExpenseRangeQuery,
  normalizeExpenseLeaves,
} from '@actual-app/core/shared/expense-range-query';
import type {
  ExpenseLeaf,
  ExpenseQueryRow,
} from '@actual-app/core/shared/expense-range-query';

import { useCategories } from '#hooks/useCategories';
import { liveQuery } from '#queries/liveQuery';

import { buildExpenseSummary, getExpenseRange } from './expenseData';
import type { ExpensePeriod } from './expenseData';

export function useExpenseData({
  budgetId,
  period,
  anchor,
}: {
  budgetId: string | undefined;
  period: ExpensePeriod;
  anchor: string;
}) {
  const categories = useCategories();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([budgetId, period, anchor, attempt]);
  const generation = useRef(0);
  const [state, setState] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'error';
    leaves: ExpenseLeaf[] | null;
  }>({ key, status: 'loading', leaves: null });

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let disposed = false;
    const isCurrent = () =>
      !disposed && generation.current === currentGeneration;
    setState({ key, status: 'loading', leaves: null });
    if (!budgetId) {
      return;
    }
    const subscription = liveQuery<ExpenseQueryRow>(
      buildExpenseRangeQuery(getExpenseRange(period, anchor)),
      {
        onData: rows => {
          if (isCurrent()) {
            setState({
              key,
              status: 'ready',
              leaves: normalizeExpenseLeaves(rows),
            });
          }
        },
        onError: () => {
          if (isCurrent()) {
            setState({ key, status: 'error', leaves: null });
          }
        },
      },
    );
    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [budgetId, period, anchor, key]);

  const status =
    state.key !== key
      ? 'loading'
      : state.status === 'error' || categories.isError
        ? 'error'
        : state.status === 'ready' &&
            categories.data &&
            !categories.isPending &&
            !categories.isPlaceholderData
          ? 'ready'
          : 'loading';
  return {
    status,
    summary:
      status === 'ready' && state.leaves && categories.data
        ? buildExpenseSummary(
            state.leaves,
            categories.data.grouped,
            period,
            anchor,
          )
        : null,
    retry: () => {
      if (categories.isError) {
        void categories.refetch();
      }
      setAttempt(value => value + 1);
    },
  };
}
