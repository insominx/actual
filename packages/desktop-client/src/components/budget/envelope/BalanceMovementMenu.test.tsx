import React from 'react';

import { initServer } from '@actual-app/core/platform/client/connection';
import type { ReservationsResult } from '@actual-app/core/types/models/reservations';
import { render, screen } from '@testing-library/react';

import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { mergeLocalPrefs, mergeSyncedPrefs } from '#prefs/prefsSlice';

import { BalanceMovementMenu } from './BalanceMovementMenu';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

vi.mock('#hooks/useSheetValue', () => ({
  useSheetValue: () => 120000,
}));

let originalCurrentMonth: string | null;

beforeEach(() => {
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = '2026-09';
});

afterEach(() => {
  global.currentMonth = originalCurrentMonth;
});

function renderMenu(flag: boolean) {
  const getReservations = vi.fn(
    async (): Promise<ReservationsResult> => ({
      month: '2026-09',
      categories: [
        {
          categoryId: 'bills',
          state: 'ready',
          balance: 120000,
          reserved: 60000,
          allowance: 50000,
          allowanceTotal: 50000,
          spare: 10000,
          shortfall: 0,
          claims: [
            {
              key: 'insurance',
              kind: 'schedule',
              label: 'Insurance',
              nextDate: '2027-03-15',
              target: 120000,
              accrued: 60000,
            },
          ],
        },
      ],
    }),
  );
  initServer({ 'budget/get-reservations': getReservations });

  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  store.dispatch(mergeLocalPrefs({ id: 'budget-1' }));
  store.dispatch(
    mergeSyncedPrefs({ 'flags.budgetReservations': String(flag) }),
  );

  render(
    <TestProviders store={store} queryClient={queryClient}>
      <BalanceMovementMenu
        categoryId="bills"
        month="2026-09"
        onBudgetAction={vi.fn()}
        onClose={vi.fn()}
      />
    </TestProviders>,
  );

  return { getReservations };
}

describe('BalanceMovementMenu', () => {
  it('shows the reservation breakdown above the balance menu', async () => {
    const { getReservations } = renderMenu(true);

    const panel = await screen.findByTestId('reservation-breakdown');
    expect(await screen.findByText('Reserved')).toBeInTheDocument();
    const transfer = screen.getByText('Transfer to another category');
    expect(
      panel.compareDocumentPosition(transfer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(getReservations).toHaveBeenCalledTimes(1);
  });

  it('leaves the balance menu unchanged when the flag is off', async () => {
    const { getReservations } = renderMenu(false);

    expect(
      await screen.findByText('Transfer to another category'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Remove overspending rollover'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('reservation-breakdown'),
    ).not.toBeInTheDocument();
    expect(getReservations).not.toHaveBeenCalled();
  });
});
