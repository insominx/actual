import { initServer } from '@actual-app/core/platform/client/connection';
import type { ExpenseQueryRow } from '@actual-app/core/shared/expense-range-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { mergeLocalPrefs, mergeSyncedPrefs } from '#prefs/prefsSlice';

import { BudgetDisplayModeSelector } from './BudgetDisplayModeSelector';
import { ExpenseView } from './ExpenseView';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const row: ExpenseQueryRow = {
  id: 'expense',
  date: '2025-03-15',
  amount: -10000,
  categoryId: 'food',
  isIncome: false,
  transferAccount: null,
  transferOffbudget: null,
};
const grouped = [
  {
    id: 'everyday',
    name: 'Everyday',
    categories: [{ id: 'food', name: 'Food', group: 'everyday' }],
  },
];

function setup(
  query = async () => ({ data: [row], dependencies: ['transactions'] }),
  privacy = false,
) {
  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  store.dispatch(mergeLocalPrefs({ id: 'expense-budget' }));
  store.dispatch(mergeSyncedPrefs({ isPrivacyEnabled: String(privacy) }));
  initServer({
    'get-categories': async () => ({
      grouped,
      list: grouped.flatMap(group => group.categories),
    }),
    query,
  });
  const rendered = render(
    <TestProviders store={store} queryClient={queryClient}>
      <BudgetDisplayModeSelector />
      <ExpenseView initialMonth="2025-03" />
    </TestProviders>,
  );
  return { ...rendered, store };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('discloses categories by keyboard and names day and year headers and scroll region', async () => {
  setup();
  const user = userEvent.setup();
  const toggle = await screen.findByRole('button', { name: 'Everyday' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.queryByRole('rowheader', { name: 'Food' }),
  ).not.toBeInTheDocument();
  screen.getByRole('region', { name: 'Expense grid' }).focus();
  await user.tab();
  expect(toggle).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('rowheader', { name: 'Food' })).toBeVisible();
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.getByRole('columnheader', { name: 'March 15, 2025' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Year' }));
  await screen.findByRole('columnheader', { name: 'January 2025' });
  expect(screen.getAllByRole('columnheader')).toHaveLength(14);
});

it('navigates only working state and writes only the two display preferences', async () => {
  localStorage.setItem(
    'expense-budget-budget.startMonth',
    JSON.stringify('2025-03'),
  );
  setup();
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Everyday' });
  await user.click(
    screen.getByRole('button', { name: 'Previous expense period' }),
  );
  expect(screen.getByTestId('expense-period')).toHaveTextContent(
    'February 2025',
  );
  await user.click(screen.getByRole('button', { name: 'Year' }));
  expect(screen.getByTestId('expense-period')).toHaveTextContent('2025');
  await user.click(screen.getByRole('button', { name: 'Month' }));
  expect(screen.getByTestId('expense-period')).toHaveTextContent(
    'February 2025',
  );
  await user.click(screen.getByRole('button', { name: 'Expenses' }));
  await user.click(screen.getByRole('button', { name: 'Budget' }));
  expect(new Set(write.mock.calls.map(([key]) => key))).toEqual(
    new Set([
      'expense-budget-budget.displayMode',
      'expense-budget-budget.expensePeriod',
    ]),
  );
  expect(localStorage.getItem('expense-budget-budget.startMonth')).toBe(
    JSON.stringify('2025-03'),
  );
});

it('uses the existing privacy overlay and removes it when privacy is disabled', async () => {
  const { store } = setup(undefined, true);
  const total = await screen.findByRole('row', { name: /Total net spending/ });
  const amountCell = within(total).getAllByRole('cell').at(-1);
  if (!amountCell) {
    throw new Error('Missing total cell');
  }
  const amount = within(amountCell).getByText('100.00');
  if (!amount.parentElement) {
    throw new Error('Missing privacy overlay');
  }
  expect(getComputedStyle(amount.parentElement).opacity).toBe('0');
  expect(amountCell.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  act(() => {
    store.dispatch(mergeSyncedPrefs({ isPrivacyEnabled: 'false' }));
  });
  expect(
    amountCell.querySelector('[aria-hidden="true"]'),
  ).not.toBeInTheDocument();
  expect(within(amountCell).getByText('100.00')).toBeVisible();
});

it('shows no amounts while loading or failed and retries the query', async () => {
  let respond:
    | ((value: { data: ExpenseQueryRow[]; dependencies: string[] }) => void)
    | undefined;
  let reject: ((error: Error) => void) | undefined;
  const query = vi.fn(
    () =>
      new Promise<{ data: ExpenseQueryRow[]; dependencies: string[] }>(
        (resolve, fail) => {
          respond = resolve;
          reject = fail;
        },
      ),
  );
  setup(query);
  expect(screen.getByRole('status')).toHaveTextContent('Loading expenses');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await waitFor(() => expect(reject).toBeDefined());
  act(() => reject?.(new Error('Read failed')));
  await screen.findByRole('alert');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  act(() => respond?.({ data: [row], dependencies: ['transactions'] }));
  await screen.findByRole('table');
});
