import { initServer } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  createDeferredReservationsServer,
  expectReadyBalance,
  renderedBalances,
  reservationsResult as result,
  settle,
  setupReservationsStore,
} from '#mocks/reservations';
import { mergeLocalPrefs } from '#prefs/prefsSlice';

import { useReservations } from './useReservations';
import type { ReservationsState } from './useReservations';

const syncEventListeners = vi.hoisted(() => ({ count: 0 }));

vi.mock('@actual-app/core/platform/client/connection', async () => {
  const connection = await import('#mocks/connection');
  return {
    ...connection,
    listen: (name: string, callback: (args: unknown) => void) => {
      const unlisten = connection.listen(name, callback);
      if (name !== 'sync-event') {
        return unlisten;
      }
      syncEventListeners.count++;
      return () => {
        syncEventListeners.count--;
        unlisten();
      };
    },
  };
});

let originalCurrentMonth: string | null;

beforeEach(() => {
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = '2026-09';
});

afterEach(() => {
  global.currentMonth = originalCurrentMonth;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderTracked(
  wrapper: ReturnType<typeof setupReservationsStore>['wrapper'],
) {
  const history: ReservationsState[] = [];
  const rendered = renderHook(
    () => {
      const state = useReservations('2026-09');
      history.push(state);
      return state;
    },
    { wrapper },
  );
  return { ...rendered, history };
}

describe('useReservations', () => {
  it('fetches once on first mount and shows no figures while fetching', async () => {
    const { getReservations, resolveRequest } =
      createDeferredReservationsServer();
    const { wrapper } = setupReservationsStore();
    const { result: hook, history } = renderTracked(wrapper);

    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(1));
    expect(getReservations).toHaveBeenCalledWith({ month: '2026-09' });
    expect(hook.current.status).toBe('loading');
    expect(renderedBalances(history)).toEqual([]);

    resolveRequest(0, result(120000));
    await waitFor(() => expectReadyBalance(hook.current, 120000));
    await settle();
    expect(getReservations).toHaveBeenCalledTimes(1);
  });

  it('never renders the previous budget after a switch, even if it resolves late', async () => {
    const { getReservations, resolveRequest } =
      createDeferredReservationsServer();
    const { store, queryClient, wrapper } = setupReservationsStore();
    const { result: hook, history } = renderTracked(wrapper);

    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(1));

    act(() => {
      queryClient.clear();
      store.dispatch(mergeLocalPrefs({ id: 'budget-2' }));
    });
    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(2));

    resolveRequest(0, result(111));
    await settle();
    expect(hook.current.status).toBe('loading');

    resolveRequest(1, result(222));
    await waitFor(() => expectReadyBalance(hook.current, 222));
    expect(renderedBalances(history)).not.toContain(111);
    expect(
      queryClient.getQueryData(['reservations', 'budget-2', '2026-09']),
    ).toEqual(result(222));
  });

  it('follows the month on visibilitychange and never renders the old month', async () => {
    const { getReservations, resolveRequest } =
      createDeferredReservationsServer();
    const { wrapper } = setupReservationsStore();
    const { result: hook } = renderHook(
      () => ({
        following: useReservations(monthUtils.currentMonth()),
        pinned: useReservations('2026-09'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(1));
    resolveRequest(0, result(120000));
    await waitFor(() => expectReadyBalance(hook.current.pinned, 120000));

    global.currentMonth = '2026-10';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(hook.current.pinned.status).toBe('disabled');
    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(2));
    expect(getReservations).toHaveBeenLastCalledWith({ month: '2026-10' });
    expect(hook.current.following.status).toBe('loading');

    resolveRequest(1, result(5000, '2026-10'));
    await waitFor(() => expectReadyBalance(hook.current.following, 5000));
    expect(hook.current.pinned.status).toBe('disabled');
  });

  it('re-checks the month at local midnight', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59));
    const { getReservations, resolveRequest } =
      createDeferredReservationsServer();
    const { wrapper } = setupReservationsStore();
    const { result: hook } = renderHook(
      () => useReservations(monthUtils.currentMonth()),
      { wrapper },
    );

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(getReservations).toHaveBeenCalledTimes(1);
    resolveRequest(0, result(120000));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expectReadyBalance(hook.current, 120000);

    global.currentMonth = '2026-10';
    await act(() => vi.advanceTimersByTimeAsync(60 * 1000));
    expect(getReservations).toHaveBeenCalledTimes(2);
    expect(getReservations).toHaveBeenLastCalledWith({ month: '2026-10' });
    expect(hook.current.status).toBe('loading');
  });

  it('leaves no listeners or timers behind after 100 mount cycles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initServer({
      'budget/get-reservations': async () => result(120000),
    });
    const { wrapper } = setupReservationsStore(
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      }),
    );

    let visibilityListeners = 0;
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'visibilitychange') {
          visibilityListeners++;
        }
        add(type, listener, options);
      },
    );
    vi.spyOn(document, 'removeEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'visibilitychange') {
          visibilityListeners--;
        }
        remove(type, listener, options);
      },
    );

    await act(() => vi.advanceTimersByTimeAsync(0));
    const baselineTimers = vi.getTimerCount();
    const baselineSyncListeners = syncEventListeners.count;

    for (let cycle = 0; cycle < 100; cycle++) {
      const { unmount } = renderHook(() => useReservations('2026-09'), {
        wrapper,
      });
      expect(visibilityListeners).toBe(1);
      unmount();
    }
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(visibilityListeners).toBe(0);
    expect(vi.getTimerCount()).toBe(baselineTimers);
    // Freshness is owned by the one app-level sync listener, never the hook
    expect(syncEventListeners.count).toBe(baselineSyncListeners);
  });
});
