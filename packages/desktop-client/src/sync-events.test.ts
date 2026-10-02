import {
  initServer,
  serverPush,
} from '@actual-app/core/platform/client/connection';
import type { ReservationsResult } from '@actual-app/core/types/models/reservations';
import { renderHook, waitFor } from '@testing-library/react';

import { useReservations } from '#hooks/useReservations';
import type { ReservationsState } from '#hooks/useReservations';
import { configureTestAppStore, createTestQueryClient } from '#mocks';
import {
  createDeferredReservationsServer,
  expectReadyBalance,
  renderedBalances,
  reservationsResult,
  settle,
  setupReservationsStore,
} from '#mocks/reservations';
import { mergeLocalPrefs } from '#prefs/prefsSlice';

import { listenForSyncEvent } from './sync-events';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const RESULT: ReservationsResult = { month: '2026-09', categories: [] };
const KEY = ['reservations', 'budget-1', '2026-09'];

let unlisten: (() => void) | null = null;
let originalCurrentMonth: string | null;

beforeEach(() => {
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = '2026-09';
});

afterEach(() => {
  unlisten?.();
  unlisten = null;
  global.currentMonth = originalCurrentMonth;
});

function pushApplied() {
  serverPush('sync-event', { type: 'applied', tables: ['zero_budgets'] });
}

describe('reservation freshness through sync events', () => {
  function setupHook() {
    const server = createDeferredReservationsServer();
    const { store, queryClient, wrapper } = setupReservationsStore();
    unlisten = listenForSyncEvent(store, queryClient);

    const history: ReservationsState[] = [];
    const { result } = renderHook(
      () => {
        const state = useReservations('2026-09');
        history.push(state);
        return state;
      },
      { wrapper },
    );
    return { ...server, hook: result, history };
  }

  it('refetches once for an event during an in-flight read and renders the later response', async () => {
    const { getReservations, resolveRequest, hook, history } = setupHook();

    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(1));
    pushApplied();
    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(2));

    resolveRequest(0, reservationsResult(111));
    await settle();
    expect(hook.current.status).toBe('loading');

    resolveRequest(1, reservationsResult(222));
    await waitFor(() => expectReadyBalance(hook.current, 222));
    await settle();
    expect(getReservations).toHaveBeenCalledTimes(2);
    expect(renderedBalances(history)).not.toContain(111);
  });

  it('coalesces three events in one tick into one refetch', async () => {
    const { getReservations, resolveRequest, hook } = setupHook();

    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(1));
    resolveRequest(0, reservationsResult(120000));
    await waitFor(() => expectReadyBalance(hook.current, 120000));

    pushApplied();
    pushApplied();
    pushApplied();
    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(2));
    await settle();
    expect(getReservations).toHaveBeenCalledTimes(2);

    resolveRequest(1, reservationsResult(90000));
    await waitFor(() => expectReadyBalance(hook.current, 90000));
  });

  it('replaces the post-edit row with the pre-edit row after undo', async () => {
    const { getReservations, resolveRequest, hook, history } = setupHook();

    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(1));
    resolveRequest(0, reservationsResult(120000));
    await waitFor(() => expectReadyBalance(hook.current, 120000));

    // The edit
    pushApplied();
    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(2));
    resolveRequest(1, reservationsResult(70000));
    await waitFor(() => expectReadyBalance(hook.current, 70000));

    // The undo reaches the client as another `applied` event
    const beforeUndo = history.length;
    pushApplied();
    await waitFor(() => expect(getReservations).toHaveBeenCalledTimes(3));
    expect(hook.current.status).toBe('loading');
    resolveRequest(2, reservationsResult(120000));
    await waitFor(() => expectReadyBalance(hook.current, 120000));

    const afterUndo = history.slice(beforeUndo);
    const firstLoading = afterUndo.findIndex(s => s.status === 'loading');
    expect(firstLoading).toBeGreaterThanOrEqual(0);
    expect(renderedBalances(afterUndo.slice(firstLoading))).not.toContain(
      70000,
    );
  });
});

function setup({ hasBudget = true } = {}) {
  const getReservations = vi.fn(async () => RESULT);
  initServer({ 'budget/get-reservations': getReservations });

  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  if (hasBudget) {
    store.dispatch(mergeLocalPrefs({ id: 'budget-1' }));
  }
  queryClient.setQueryData(KEY, RESULT);
  const resetQueries = vi.spyOn(queryClient, 'resetQueries');
  unlisten = listenForSyncEvent(store, queryClient);

  return { queryClient, resetQueries, getReservations };
}

async function nextTicks() {
  await new Promise(resolve => setTimeout(resolve, 10));
}

describe('listenForSyncEvent reservations', () => {
  it.each(['applied', 'success'])(
    'resets the reservations prefix on %s',
    async type => {
      const { queryClient, resetQueries } = setup();

      serverPush('sync-event', { type, tables: ['zero_budgets'] });
      await nextTicks();

      expect(resetQueries).toHaveBeenCalledTimes(1);
      expect(resetQueries).toHaveBeenCalledWith({
        queryKey: ['reservations'],
      });
      expect(queryClient.getQueryData(KEY)).toBeUndefined();
    },
  );

  it('resets even when no watched table changed', async () => {
    const { resetQueries } = setup();

    serverPush('sync-event', { type: 'applied', tables: [] });
    await nextTicks();

    expect(resetQueries).toHaveBeenCalledTimes(1);
  });

  it('coalesces events in one tick', async () => {
    const { resetQueries } = setup();

    serverPush('sync-event', { type: 'applied', tables: ['transactions'] });
    serverPush('sync-event', { type: 'applied', tables: ['notes'] });
    serverPush('sync-event', { type: 'success', tables: ['schedules'] });
    await nextTicks();

    expect(resetQueries).toHaveBeenCalledTimes(1);
  });

  it('does not refetch an unobserved month in the background', async () => {
    const { queryClient, getReservations } = setup();

    serverPush('sync-event', { type: 'applied', tables: ['zero_budgets'] });
    await nextTicks();

    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    expect(getReservations).not.toHaveBeenCalled();
  });

  it('ignores events without a loaded budget', async () => {
    const { queryClient, resetQueries } = setup({ hasBudget: false });

    serverPush('sync-event', { type: 'applied', tables: ['zero_budgets'] });
    await nextTicks();

    expect(resetQueries).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(KEY)).toEqual(RESULT);
  });

  it('ignores error events', async () => {
    const { resetQueries } = setup();

    serverPush('sync-event', { type: 'error', subtype: 'network' });
    await nextTicks();

    expect(resetQueries).not.toHaveBeenCalled();
  });

  it('drops a pending reset when unlistened', async () => {
    const { resetQueries } = setup();

    pushApplied();
    await Promise.resolve();
    await Promise.resolve();
    unlisten?.();
    unlisten = null;
    await nextTicks();

    expect(resetQueries).not.toHaveBeenCalled();
  });
});
