import React from 'react';

import { initServer } from '@actual-app/core/platform/client/connection';
import type { ReservationsResult } from '@actual-app/core/types/models/reservations';
import { render, screen, within } from '@testing-library/react';

import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { mergeLocalPrefs, mergeSyncedPrefs } from '#prefs/prefsSlice';

import { EnvelopeBalanceMenuModal } from './EnvelopeBalanceMenuModal';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

vi.mock('#hooks/useSheetValue', () => ({
  useSheetValue: () => 120000,
}));

vi.mock('#hooks/useCategory', () => ({
  useCategory: () => ({ data: { id: 'bills', name: 'Bills' } }),
}));

const F1_RESULT: ReservationsResult = {
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
};

let originalCurrentMonth: string | null;

beforeEach(() => {
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = '2026-09';
});

afterEach(() => {
  global.currentMonth = originalCurrentMonth;
});

function renderModal(flag: boolean) {
  const getReservations = vi.fn(async () => F1_RESULT);
  initServer({ 'budget/get-reservations': getReservations });

  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  store.dispatch(mergeLocalPrefs({ id: 'budget-1' }));
  store.dispatch(
    mergeSyncedPrefs({ 'flags.budgetReservations': String(flag) }),
  );

  render(
    <TestProviders store={store} queryClient={queryClient}>
      <EnvelopeBalanceMenuModal
        categoryId="bills"
        month="2026-09"
        onCarryover={vi.fn()}
        onTransfer={vi.fn()}
        onCover={vi.fn()}
      />
    </TestProviders>,
  );

  return { getReservations };
}

describe('EnvelopeBalanceMenuModal', () => {
  it('shows the same reservation amounts as the desktop menu', async () => {
    const { getReservations } = renderModal(true);

    expect(await screen.findByText('Reserved')).toBeInTheDocument();
    const panel = screen.getByTestId('reservation-breakdown');
    expect(within(panel).getByText('1,200.00')).toBeInTheDocument();
    expect(within(panel).getByText('600.00')).toBeInTheDocument();
    expect(within(panel).getByText('500.00')).toBeInTheDocument();
    expect(within(panel).getByText('100.00')).toBeInTheDocument();
    expect(
      within(panel).getByText('Insurance, due 03/15/2027'),
    ).toBeInTheDocument();
    expect(getReservations).toHaveBeenCalledWith({ month: '2026-09' });

    const transfer = screen.getByText('Transfer to another category');
    expect(
      panel.compareDocumentPosition(transfer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('leaves the modal unchanged when the flag is off', async () => {
    const { getReservations } = renderModal(false);

    expect(
      await screen.findByText('Transfer to another category'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('reservation-breakdown'),
    ).not.toBeInTheDocument();
    expect(getReservations).not.toHaveBeenCalled();
  });
});
