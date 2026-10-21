import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MonthSelector } from './BudgetPage';

function renderMonthSelector(month: string) {
  render(
    <MonthSelector
      month={month}
      monthBounds={{ start: '2024-01', end: '2025-06' }}
      onOpenMonthMenu={vi.fn()}
      onPrevMonth={vi.fn()}
      onNextMonth={vi.fn()}
    />,
    { wrapper: TestProviders },
  );
}

describe('MonthSelector', () => {
  it('allows moving to the last month of the budget bounds', () => {
    renderMonthSelector('2025-05');

    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  it('stops at the last month of the budget bounds', () => {
    renderMonthSelector('2025-06');

    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('stops at the first month of the budget bounds', () => {
    renderMonthSelector('2024-01');

    expect(
      screen.getByRole('button', { name: 'Previous month' }),
    ).toBeDisabled();
  });
});
