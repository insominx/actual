import type { ExpenseQueryRow } from '@actual-app/core/shared/expense-range-query';
import type { CategoryGroupEntity } from '@actual-app/core/types/models';
import { act, renderHook } from '@testing-library/react';

import { useCategories } from '#hooks/useCategories';
import { liveQuery } from '#queries/liveQuery';

import { useExpenseData } from './useExpenseData';

vi.mock('#queries/liveQuery', () => ({ liveQuery: vi.fn() }));
vi.mock('#hooks/useCategories', () => ({ useCategories: vi.fn() }));

const groups: CategoryGroupEntity[] = [
  {
    id: 'group',
    name: 'Group',
    categories: [{ id: 'food', name: 'Food', group: 'group' }],
  },
];
const row: ExpenseQueryRow = {
  id: 'expense',
  date: '2025-03-15',
  amount: -10000,
  categoryId: 'food',
  isIncome: false,
  transferAccount: null,
  transferOffbudget: null,
};
type Callbacks = Parameters<typeof liveQuery<ExpenseQueryRow>>[1];
let subscriptions: {
  callbacks: Callbacks;
  unsubscribe: ReturnType<typeof vi.fn>;
}[];

function categories(loaded = true, grouped = groups, placeholder = false) {
  vi.mocked(useCategories).mockReturnValue({
    data: loaded
      ? { grouped, list: grouped.flatMap(group => group.categories ?? []) }
      : undefined,
    isPending: !loaded,
    isError: false,
    isPlaceholderData: placeholder,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCategories>);
}

beforeEach(() => {
  subscriptions = [];
  categories();
  vi.mocked(liveQuery).mockImplementation((_query, callbacks) => {
    const subscription = {
      callbacks: callbacks as Callbacks,
      unsubscribe: vi.fn(),
    };
    subscriptions.push(subscription);
    return { unsubscribe: subscription.unsubscribe } as unknown as ReturnType<
      typeof liveQuery
    >;
  });
});
afterEach(() => vi.clearAllMocks());

it('owns exactly one subscription for either period and none after unmount', () => {
  const { result, rerender, unmount } = renderHook(useExpenseData, {
    initialProps: {
      budgetId: 'one',
      period: 'month' as 'month' | 'year',
      anchor: '2025-03',
    },
  });
  expect(subscriptions).toHaveLength(1);
  expect(result.current.summary).toBeNull();
  act(() => subscriptions[0].callbacks.onData?.([row], []));
  expect(result.current.summary?.total.total).toBe(10000);
  rerender({ budgetId: 'one', period: 'month', anchor: '2025-03' });
  expect(subscriptions).toHaveLength(1);
  rerender({ budgetId: 'one', period: 'year', anchor: '2025' });
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(subscriptions).toHaveLength(2);
  expect(result.current.summary).toBeNull();
  act(() => subscriptions[1].callbacks.onData?.([row], []));
  expect(result.current.summary?.columns).toHaveLength(12);
  unmount();
  expect(
    subscriptions.every(
      subscription => subscription.unsubscribe.mock.calls.length === 1,
    ),
  ).toBe(true);
});

it('waits for real category metadata, not the empty placeholder, and rebuilds on category refresh', () => {
  categories(false);
  const { result, rerender } = renderHook(() =>
    useExpenseData({ budgetId: 'one', period: 'month', anchor: '2025-03' }),
  );
  act(() => subscriptions[0].callbacks.onData?.([row], []));
  expect(result.current.status).toBe('loading');
  categories(true, [], true);
  rerender();
  expect(result.current.summary).toBeNull();
  categories();
  rerender();
  expect(result.current.summary?.groups[0].total).toBe(10000);
  categories(true, []);
  rerender();
  expect(result.current.summary?.uncategorized.total).toBe(10000);
  expect(subscriptions).toHaveLength(1);
});

it('masks previous range and budget values on every render and ignores disposed callbacks', () => {
  const history: { budgetId: string; total: number | undefined }[] = [];
  const { result, rerender, unmount } = renderHook(
    (props: { budgetId: string; anchor: string }) => {
      const state = useExpenseData({ ...props, period: 'month' });
      history.push({
        budgetId: props.budgetId,
        total: state.summary?.total.total,
      });
      return state;
    },
    { initialProps: { budgetId: 'one', anchor: '2025-03' } },
  );
  act(() => subscriptions[0].callbacks.onData?.([row], []));
  rerender({ budgetId: 'two', anchor: '2025-03' });
  expect(
    history
      .filter(entry => entry.budgetId === 'two')
      .every(entry => entry.total === undefined),
  ).toBe(true);
  act(() => {
    subscriptions[0].callbacks.onData?.([row], []);
    subscriptions[0].callbacks.onError?.(new Error('late'));
  });
  expect(result.current.status).toBe('loading');
  act(() =>
    subscriptions[1].callbacks.onData?.([{ ...row, amount: -200 }], []),
  );
  expect(result.current.summary?.total.total).toBe(200);
  rerender({ budgetId: 'two', anchor: '2025-04' });
  expect(result.current.summary).toBeNull();
  unmount();
  act(() => {
    subscriptions[2].callbacks.onData?.([row], []);
    subscriptions[2].callbacks.onError?.(new Error('after dispose'));
  });
  expect(
    subscriptions.every(
      subscription => subscription.unsubscribe.mock.calls.length === 1,
    ),
  ).toBe(true);
});

it('masks errors, recovers on edit/sync/undo payloads, and retries with a new subscription', () => {
  const { result } = renderHook(() =>
    useExpenseData({ budgetId: 'one', period: 'month', anchor: '2025-03' }),
  );
  act(() => subscriptions[0].callbacks.onData?.([row], []));
  act(() => subscriptions[0].callbacks.onError?.(new Error('refresh failed')));
  expect(result.current.status).toBe('error');
  expect(result.current.summary).toBeNull();
  act(() =>
    subscriptions[0].callbacks.onData?.([{ ...row, amount: -11000 }], [row]),
  );
  expect(result.current.summary?.total.total).toBe(11000);
  act(() => subscriptions[0].callbacks.onData?.([row], []));
  expect(result.current.summary?.total.total).toBe(10000);
  act(() => result.current.retry());
  expect(result.current.status).toBe('loading');
  expect(result.current.summary).toBeNull();
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(subscriptions).toHaveLength(2);
});

it('does not subscribe without a budget', () => {
  const { result } = renderHook(() =>
    useExpenseData({ budgetId: undefined, period: 'month', anchor: '2025-03' }),
  );
  expect(subscriptions).toHaveLength(0);
  expect(result.current.summary).toBeNull();
});
