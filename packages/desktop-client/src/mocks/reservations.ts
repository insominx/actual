// Shared fixtures for reservation hook and sync tests. Callers must mock
// `@actual-app/core/platform/client/connection` with `#mocks/connection`.
import { createElement } from 'react';
import type { ReactNode } from 'react';

import { initServer } from '@actual-app/core/platform/client/connection';
import type {
  ReservationsRequest,
  ReservationsResult,
} from '@actual-app/core/types/models/reservations';
import type { QueryClient } from '@tanstack/react-query';
import { act } from '@testing-library/react';

import type { ReservationsState } from '#hooks/useReservations';
import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { mergeLocalPrefs, mergeSyncedPrefs } from '#prefs/prefsSlice';

export function reservationsResult(
  balance: number,
  month = '2026-09',
): ReservationsResult {
  return {
    month,
    categories: [
      {
        categoryId: 'bills',
        state: 'ready',
        balance,
        reserved: 60000,
        allowance: 0,
        allowanceTotal: 0,
        spare: balance - 60000,
        shortfall: Math.max(0, 60000 - balance),
        claims: [],
      },
    ],
  };
}

/** Each request stays pending until the test resolves it by index. */
export function createDeferredReservationsServer() {
  const pending: Array<(value: ReservationsResult) => void> = [];
  const getReservations = vi.fn(
    (_args: ReservationsRequest) =>
      new Promise<ReservationsResult>(resolve => {
        pending.push(resolve);
      }),
  );
  initServer({ 'budget/get-reservations': getReservations });

  function resolveRequest(index: number, value: ReservationsResult) {
    const resolve = pending[index];
    if (!resolve) {
      throw new Error(`No request ${index}`);
    }
    act(() => resolve(value));
  }

  return { getReservations, resolveRequest };
}

/** A store with a loaded envelope budget and the flag on. */
export function setupReservationsStore(
  queryClient: QueryClient = createTestQueryClient(),
) {
  const store = configureTestAppStore({ queryClient });
  store.dispatch(mergeLocalPrefs({ id: 'budget-1' }));
  store.dispatch(
    mergeSyncedPrefs({
      'flags.budgetReservations': 'true',
      budgetType: 'envelope',
    }),
  );

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(TestProviders, { store, queryClient, children });
  }

  return { store, queryClient, wrapper };
}

export function renderedBalances(history: ReservationsState[]) {
  return history.flatMap(state =>
    state.status === 'ready'
      ? state.result.categories.map(category =>
          category.state === 'ready' ? category.balance : null,
        )
      : [],
  );
}

export function expectReadyBalance(state: ReservationsState, balance: number) {
  expect(state.status).toBe('ready');
  if (state.status === 'ready') {
    expect(state.result.categories[0]).toMatchObject({ balance });
  }
}

export async function settle() {
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
}
