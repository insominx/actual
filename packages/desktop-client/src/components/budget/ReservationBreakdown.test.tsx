import React from 'react';

import { initServer } from '@actual-app/core/platform/client/connection';
import type {
  ReservationRow,
  ReservationsRequest,
  ReservationsResult,
} from '@actual-app/core/types/models/reservations';
import { render, screen, waitFor } from '@testing-library/react';

import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { mergeLocalPrefs, mergeSyncedPrefs } from '#prefs/prefsSlice';

import { ReservationBreakdown } from './ReservationBreakdown';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

vi.mock('#hooks/useSheetValue', () => ({
  useSheetValue: () => 120000,
}));

const F1_ROW: ReservationRow = {
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
};

const F2_ROW: ReservationRow = {
  ...F1_ROW,
  balance: 40000,
  allowance: 0,
  spare: -20000,
  shortfall: 20000,
};

let originalCurrentMonth: string | null;

beforeEach(() => {
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = '2026-09';
});

afterEach(() => {
  global.currentMonth = originalCurrentMonth;
});

function setup({
  handler,
  flag = true,
  budgetType = 'envelope',
}: {
  handler: (args: ReservationsRequest) => Promise<ReservationsResult>;
  flag?: boolean;
  budgetType?: 'envelope' | 'tracking';
}) {
  const getReservations = vi.fn(handler);
  initServer({ 'budget/get-reservations': getReservations });

  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  store.dispatch(mergeLocalPrefs({ id: 'budget-1' }));
  store.dispatch(
    mergeSyncedPrefs({
      'flags.budgetReservations': String(flag),
      budgetType,
    }),
  );

  return { getReservations, store, queryClient };
}

function result(...categories: ReservationRow[]): ReservationsResult {
  return { month: '2026-09', categories };
}

function renderBreakdown(
  { store, queryClient }: ReturnType<typeof setup>,
  month = '2026-09',
) {
  return render(
    <TestProviders store={store} queryClient={queryClient}>
      <ReservationBreakdown categoryId="bills" month={month} />
    </TestProviders>,
  );
}

describe('ReservationBreakdown', () => {
  it('renders the F1 breakdown', async () => {
    const context = setup({ handler: async () => result(F1_ROW) });
    renderBreakdown(context);

    expect(await screen.findByText('Reserved')).toBeInTheDocument();
    expect(screen.getByText('Total balance')).toBeInTheDocument();
    expect(screen.getByText('1,200.00')).toBeInTheDocument();
    expect(screen.getByText('600.00')).toBeInTheDocument();
    expect(screen.getByText('Allowance remaining')).toBeInTheDocument();
    expect(screen.getByText('500.00')).toBeInTheDocument();
    expect(screen.getByText('Spare')).toBeInTheDocument();
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('Insurance, due 03/15/2027')).toBeInTheDocument();
    expect(screen.getByText('600.00 of 1,200.00')).toBeInTheDocument();
    expect(context.getReservations).toHaveBeenCalledWith({ month: '2026-09' });
  });

  it('renders a negative spare for F2', async () => {
    renderBreakdown(setup({ handler: async () => result(F2_ROW) }));

    expect(await screen.findByText('-200.00')).toBeInTheDocument();
  });

  it('renders the reason for an unavailable row', async () => {
    renderBreakdown(
      setup({
        handler: async () =>
          result({
            categoryId: 'bills',
            state: 'unavailable',
            reason: 'missing-schedule',
          }),
      }),
    );

    expect(
      await screen.findByText(
        'A schedule used by this category no longer exists.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
  });

  it('shows only the canonical balance while loading', async () => {
    // A request that never settles
    const context = setup({ handler: () => new Promise(vi.fn()) });
    renderBreakdown(context);

    expect(
      await screen.findByText('Calculating reservations…'),
    ).toBeInTheDocument();
    expect(screen.getByText('1,200.00')).toBeInTheDocument();
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
    expect(screen.queryByText('Spare')).not.toBeInTheDocument();
  });

  it('shows no figures after an error', async () => {
    renderBreakdown(
      setup({
        handler: async () => {
          throw new Error('boom');
        },
      }),
    );

    expect(
      await screen.findByText('Reservations are unavailable right now.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
  });

  it('renders nothing for a category without claims or allowance', async () => {
    const context = setup({
      handler: async () =>
        result({
          categoryId: 'bills',
          state: 'ready',
          balance: 3000,
          reserved: 0,
          allowance: 0,
          allowanceTotal: 0,
          spare: 3000,
          shortfall: 0,
          claims: [],
        }),
    });
    renderBreakdown(context);

    await waitFor(() => expect(context.getReservations).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByTestId('reservation-breakdown'),
      ).not.toBeInTheDocument(),
    );
  });

  it.each([
    { case: 'flag off', options: { flag: false }, month: '2026-09' },
    {
      case: 'tracking budget',
      options: { budgetType: 'tracking' as const },
      month: '2026-09',
    },
    { case: 'non-current month', options: {}, month: '2026-08' },
  ])('is absent and sends nothing: $case', async ({ options, month }) => {
    const context = setup({ handler: async () => result(F1_ROW), ...options });
    renderBreakdown(context, month);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(
      screen.queryByTestId('reservation-breakdown'),
    ).not.toBeInTheDocument();
    expect(context.getReservations).not.toHaveBeenCalled();
  });
});
