import type { ReactNode } from 'react';

import { initServer } from '@actual-app/core/platform/client/connection';
import type { CashPlanningSummary } from '@actual-app/core/types/models/cash-planning';
import { act, renderHook, waitFor } from '@testing-library/react';

import { handleGlobalEvents } from '#global-events';
import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { serverPush } from '#mocks/connection';
import { mergeLocalPrefs } from '#prefs/prefsSlice';

import { useCashPlanning } from './useCashPlanning';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const range = { startDate: '2016-10-01', endDate: '2016-12-31' };
let unlisten: (() => void) | undefined;
afterEach(() => {
  unlisten?.();
  unlisten = undefined;
});
function summary(balance: number): CashPlanningSummary {
  return {
    ...range,
    asOf: '2017-01-01',
    balance,
    accounts: [],
    months: 3,
    transactionCount: 1,
    income: 0,
    outflow: 0,
    externalMovement: 0,
    monthlyIncome: 0,
    monthlyOutflow: 0,
    monthlyExternalMovement: 0,
    categories: [],
  };
}
function setup() {
  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  store.dispatch(mergeLocalPrefs({ id: 'budget-1' }));
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <TestProviders store={store} queryClient={queryClient}>
        {children}
      </TestProviders>
    );
  }
  const pending: {
    resolve: (value: CashPlanningSummary) => void;
    reject: (error: Error) => void;
  }[] = [];
  const handler = vi.fn(
    () =>
      new Promise<CashPlanningSummary>((resolve, reject) =>
        pending.push({ resolve, reject }),
      ),
  );
  initServer({ 'cash-planning/get-summary': handler });
  unlisten = handleGlobalEvents(store, queryClient);
  return { queryClient, store, wrapper, pending, handler };
}
async function resolve(
  pending: ReturnType<typeof setup>['pending'],
  index: number,
  balance: number,
) {
  await act(async () => {
    pending[index].resolve(summary(balance));
  });
}

it('discards late results after date changes and budget switches and never shows previous figures', async () => {
  const { store, wrapper, pending, handler } = setup();
  const history: number[] = [];
  const hook = renderHook(
    ({ request }) => {
      const value = useCashPlanning(request);
      if (value.data) {
        history.push(value.data.balance);
      }
      return value;
    },
    { wrapper, initialProps: { request: range } },
  );
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  expect(hook.result.current.data).toBeUndefined();
  hook.rerender({ request: { ...range, startDate: '2016-11-01' } });
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  await act(() => store.dispatch(mergeLocalPrefs({ id: 'budget-2' })));
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(3));
  await resolve(pending, 0, 111);
  await resolve(pending, 1, 222);
  expect(hook.result.current.data).toBeUndefined();
  await resolve(pending, 2, 333);
  await waitFor(() => expect(hook.result.current.data?.balance).toBe(333));
  expect(history).not.toContain(111);
  expect(history).not.toContain(222);
});

it('cancels an initial request on sync and hides figures during undo refresh and failed refresh; retry recovers', async () => {
  const { wrapper, pending, handler } = setup();
  const hook = renderHook(() => useCashPlanning(range), { wrapper });
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  act(() =>
    serverPush('sync-event', { type: 'applied', tables: ['transactions'] }),
  );
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  await resolve(pending, 0, 111);
  expect(hook.result.current.data).toBeUndefined();
  await resolve(pending, 1, 222);
  await waitFor(() => expect(hook.result.current.data?.balance).toBe(222));
  act(() =>
    serverPush('undo-event', { tables: ['transactions'], undoTag: null }),
  );
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(3));
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => pending[2].reject(new Error('offline')));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  act(() => {
    void hook.result.current.refetch();
  });
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(4));
  await resolve(pending, 3, 444);
  await waitFor(() => expect(hook.result.current.data?.balance).toBe(444));
});

it('makes no request for an invalid range or unloaded budget', async () => {
  const { wrapper, store, handler } = setup();
  const hook = renderHook(() => useCashPlanning(range, false), { wrapper });
  expect(hook.result.current.data).toBeUndefined();
  expect(handler).not.toHaveBeenCalled();
  await act(() => store.dispatch(mergeLocalPrefs({ id: undefined })));
  expect(hook.result.current.data).toBeUndefined();
});
