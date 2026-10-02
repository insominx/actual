import type { CashPlanningSummary } from '#types/models/cash-planning';

import {
  calendarMonths,
  cashPlanningChart,
  dateAfterMonths,
  defaultCashPlanningConfig,
  isPlanningDate,
  parseCashPlanningConfig,
  projectCashPlanning,
} from './cash-planning';

const summary: CashPlanningSummary = {
  startDate: '2024-01-01',
  endDate: '2024-02-29',
  asOf: '2024-02-29',
  balance: 800000,
  accounts: [],
  months: 2,
  transactionCount: 3,
  income: 1200000,
  outflow: 800000,
  externalMovement: 0,
  monthlyIncome: 600000,
  monthlyOutflow: 400000,
  monthlyExternalMovement: 0,
  categories: [
    {
      id: 'food',
      name: 'Food',
      available: true,
      outflow: 800000,
      monthlyOutflow: 400000,
    },
  ],
};
const config = {
  ...defaultCashPlanningConfig(summary.asOf),
  goal: { balance: 2000000, deadline: '2024-08-31' },
};

describe('calendar month fractions', () => {
  it('uses complete calendar months, leap days and zero-activity days', () => {
    expect(calendarMonths('2024-01-01', '2024-02-29')).toBe(2);
    expect(calendarMonths('2024-02-01', '2024-02-29')).toBe(1);
    expect(calendarMonths('2023-02-01', '2023-02-28')).toBe(1);
    expect(calendarMonths('2024-01-16', '2024-02-15')).toBeCloseTo(
      16 / 31 + 15 / 29,
    );
    expect(calendarMonths('2024-03-10', '2024-03-10')).toBeCloseTo(1 / 31);
  });
  it('rejects malformed, impossible and reversed dates', () => {
    expect(isPlanningDate('2023-02-29')).toBe(false);
    expect(isPlanningDate('2024-02-29')).toBe(true);
    expect(() => calendarMonths('2024-03-01', '2024-02-29')).toThrow();
  });
  it('inverts fractions for projection dates without rounding rates', () => {
    expect(dateAfterMonths('2024-02-29', 6)).toBe('2024-08-31');
    expect(dateAfterMonths('2024-01-15', 16 / 31 + 1)).toBe('2024-02-29');
    expect(dateAfterMonths('2024-02-29', Infinity)).toBeNull();
  });
});

describe('cash planning projections', () => {
  it('reaches the $20,000 goal from $8,000 after six complete months at $2,000 per month', () => {
    expect(projectCashPlanning(summary, config, false)).toMatchObject({
      monthlySurplus: 200000,
      remaining: 1200000,
      completionDate: '2024-08-31',
      goalState: 'reachable',
      deadline: {
        requiredSurplus: 200000,
        maximumOutflow: 400000,
        surplusGap: 0,
        balanceGap: 0,
      },
    });
  });
  it('changes only the target projection when an override changes and clearing restores history', () => {
    const changed = { ...config, categoryTargets: { food: 300000 } };
    expect(projectCashPlanning(summary, changed, true).monthlySurplus).toBe(
      300000,
    );
    expect(projectCashPlanning(summary, changed, false).monthlySurplus).toBe(
      200000,
    );
    expect(projectCashPlanning(summary, config, true)).toEqual(
      projectCashPlanning(summary, config, false),
    );
    expect(summary.monthlyOutflow).toBe(400000);
  });
  it('keeps refunds and unavailable category amounts in target totals and includes external movements', () => {
    const adjusted = {
      ...summary,
      monthlyExternalMovement: -50000,
      categories: [
        {
          id: 'old',
          name: 'Old',
          available: false,
          outflow: -200,
          monthlyOutflow: -100,
        },
        ...summary.categories,
      ],
    };
    expect(
      projectCashPlanning(
        adjusted,
        { ...config, categoryTargets: { old: 999999 } },
        true,
      ).monthlySurplus,
    ).toBe(150100);
  });
  it('reports reached, unreachable, overdue and depletion states', () => {
    expect(
      projectCashPlanning(
        summary,
        { ...config, goal: { balance: 200000, deadline: '2024-08-31' } },
        false,
      ).deadline,
    ).toMatchObject({ requiredSurplus: -100000, maximumOutflow: 700000 });
    expect(
      projectCashPlanning(
        summary,
        { ...config, goal: { balance: 700000 } },
        false,
      ).goalState,
    ).toBe('reached');
    const declining = { ...summary, monthlyIncome: 200000 };
    expect(projectCashPlanning(declining, config, false)).toMatchObject({
      goalState: 'unreachable',
      completionDate: null,
      depletionDate: '2024-06-30',
    });
    expect(
      projectCashPlanning({ ...summary, monthlyIncome: 400000 }, config, false)
        .goalState,
    ).toBe('unreachable');
    expect(
      projectCashPlanning(
        summary,
        { ...config, goal: { balance: 2000000, deadline: '2024-01-01' } },
        false,
      ).deadline,
    ).toMatchObject({ requiredSurplus: null, balanceGap: -1200000 });
  });
  it('charts twelve months by default and keeps forecast end independent of the deadline', () => {
    expect(cashPlanningChart(summary, config).at(-1)).toMatchObject({
      date: '2025-02-28',
      historical: 3200000,
    });
    expect(
      cashPlanningChart(summary, {
        ...config,
        forecastEndDate: '2024-03-15',
      }).at(-1)?.historical,
    ).toBeCloseTo(800000 + (200000 * 15) / 31);
  });
  it('loads missing settings without writes and filters invalid persisted overrides', () => {
    expect(parseCashPlanningConfig(undefined, summary.asOf)).toEqual(
      defaultCashPlanningConfig(summary.asOf),
    );
    const saved = JSON.stringify({
      ...config,
      categoryTargets: { bad: -1, food: 0 },
    });
    expect(
      parseCashPlanningConfig(saved, summary.asOf).categoryTargets,
    ).toEqual({ food: 0 });
    expect(parseCashPlanningConfig('invalid', summary.asOf)).toEqual(
      defaultCashPlanningConfig(summary.asOf),
    );
  });
});
