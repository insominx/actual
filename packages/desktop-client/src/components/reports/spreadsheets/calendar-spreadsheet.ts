import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import type { RuleConditionEntity } from '@actual-app/core/types/models';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';
import * as d from 'date-fns';

import type { useSpreadsheet } from '#hooks/useSpreadsheet';
import { aqlQuery } from '#queries/aqlQuery';

export type CalendarDataType = {
  date: Date;
  incomeValue: number;
  expenseValue: number;
  incomeSize: number;
  expenseSize: number;
};
export function calendarSpreadsheet(
  start: string,
  end: string,
  conditions: RuleConditionEntity[] = [],
  conditionsOp: 'and' | 'or' = 'and',
  firstDayOfWeekIdx?: SyncedPrefs['firstDayOfWeekIdx'],
) {
  return async (
    spreadsheet: ReturnType<typeof useSpreadsheet>,
    setData: (data: {
      calendarData: {
        start: Date;
        end: Date;
        data: CalendarDataType[];
        totalExpense: number;
        totalIncome: number;
      }[];
    }) => void,
  ) => {
    let filters: unknown[];

    try {
      const { filters: filtersLocal } = await send(
        'make-filters-from-conditions',
        {
          conditions: conditions.filter(cond => !cond.customName),
        },
      );
      filters = filtersLocal;
    } catch (error) {
      console.error('Failed to make filters from conditions:', error);
      filters = [];
    }
    const conditionsOpKey = conditionsOp === 'or' ? '$or' : '$and';

    const startDay = monthUtils.firstDayOfMonth(start);
    const endDay = monthUtils.lastDayOfMonth(end);
    if (
      !monthUtils.isValidYearMonthDay(startDay) ||
      !monthUtils.isValidYearMonthDay(endDay)
    ) {
      throw new Error('Invalid date format provided');
    }

    const makeRootQuery = () =>
      q('transactions')
        .filter({
          $and: [{ date: { $gte: startDay } }, { date: { $lte: endDay } }],
        })
        .filter({
          [conditionsOpKey]: filters,
        })
        .groupBy(['date'])
        .select(['date', { amount: { $sum: '$amount' } }]);

    let expenseData;
    try {
      expenseData = await aqlQuery(
        makeRootQuery().filter({
          $and: { amount: { $lt: 0 } },
        }),
      );
    } catch (error) {
      console.error('Failed to fetch expense data:', error);
      expenseData = { data: [] };
    }

    let incomeData;
    try {
      incomeData = await aqlQuery(
        makeRootQuery().filter({
          $and: { amount: { $gt: 0 } },
        }),
      );
    } catch (error) {
      console.error('Failed to fetch income data:', error);
      incomeData = { data: [] };
    }

    const getOneDatePerMonth = (start: Date, end: Date) => {
      const months = [];
      let currentDate = new Date(start.getFullYear(), start.getMonth(), 1, 12);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1, 12);

      // Compare the first of each month. A start after the end does not
      // step away from the end forever.
      while (currentDate < endMonth) {
        months.push(currentDate);
        currentDate = d.addMonths(currentDate, 1);
      }
      months.push(end);

      return months;
    };

    setData(
      recalculate(
        incomeData.data,
        expenseData.data,
        getOneDatePerMonth(
          monthUtils.parseDate(startDay),
          monthUtils.parseDate(endDay),
        ),
        start,
        firstDayOfWeekIdx,
      ),
    );
  };
}

function recalculate(
  incomeData: Array<{
    date: string;
    amount: number;
  }>,
  expenseData: Array<{
    date: string;
    amount: number;
  }>,
  months: Date[],
  start: string,
  firstDayOfWeekIdx?: SyncedPrefs['firstDayOfWeekIdx'],
) {
  const incomeDataMap = new Map<string, number>();
  incomeData.forEach(item => {
    incomeDataMap.set(item.date, item.amount);
  });

  const expenseDataMap = new Map<string, number>();
  expenseData.forEach(item => {
    expenseDataMap.set(item.date, item.amount);
  });

  const parseAndCacheDate = (() => {
    const cache = new Map<string, Date>();
    return (dateStr: string) => {
      if (!cache.has(dateStr)) {
        cache.set(dateStr, monthUtils.parseDate(dateStr));
      }
      return cache.get(dateStr)!;
    };
  })();

  const getDaysArray = (month: Date) => {
    const expenseValues = expenseData
      .filter(f => d.isSameMonth(parseAndCacheDate(f.date), month))
      .map(m => Math.abs(m.amount));
    const incomeValues = incomeData
      .filter(f => d.isSameMonth(parseAndCacheDate(f.date), month))
      .map(m => Math.abs(m.amount));

    const totalExpenseValue = expenseValues.length
      ? expenseValues.reduce((acc, val) => acc + val, 0)
      : null;

    const totalIncomeValue = incomeValues.length
      ? incomeValues.reduce((acc, val) => acc + val, 0)
      : null;

    const getBarLength = (value: number) => {
      if (
        value < 0 &&
        typeof totalExpenseValue === 'number' &&
        totalExpenseValue > 0
      ) {
        const result = (Math.abs(value) / totalExpenseValue) * 100;
        return Number.isFinite(result) ? result : 0;
      } else if (
        value > 0 &&
        typeof totalIncomeValue === 'number' &&
        totalIncomeValue > 0
      ) {
        const result = (value / totalIncomeValue) * 100;
        return Number.isFinite(result) ? result : 0;
      } else {
        return 0;
      }
    };

    const weekStartsOn =
      firstDayOfWeekIdx !== undefined &&
      !Number.isNaN(parseInt(firstDayOfWeekIdx)) &&
      parseInt(firstDayOfWeekIdx) >= 0 &&
      parseInt(firstDayOfWeekIdx) <= 6
        ? parseInt(firstDayOfWeekIdx)
        : 0;
    const firstDay = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    const beginDay = d.subDays(
      firstDay,
      (firstDay.getDay() - weekStartsOn + 7) % 7,
    );
    let totalDays =
      d.differenceInDays(firstDay, beginDay) + d.getDaysInMonth(firstDay);
    if (totalDays % 7 !== 0) {
      totalDays += 7 - (totalDays % 7);
    }
    const daysArray = [];

    for (let i = 0; i < totalDays; i++) {
      const currentDate = d.addDays(beginDay, i);
      if (!d.isSameMonth(currentDate, firstDay)) {
        daysArray.push({
          date: currentDate,
          incomeValue: 0,
          expenseValue: 0,
          incomeSize: 0,
          expenseSize: 0,
        });
      } else {
        const dateKey = d.format(currentDate, 'yyyy-MM-dd');
        const currentIncome = incomeDataMap.get(dateKey) ?? 0;
        const currentExpense = expenseDataMap.get(dateKey) ?? 0;

        daysArray.push({
          date: currentDate,
          incomeSize: getBarLength(currentIncome),
          incomeValue: Math.abs(currentIncome),
          expenseSize: getBarLength(currentExpense),
          expenseValue: Math.abs(currentExpense),
        });
      }
    }

    return {
      data: daysArray as CalendarDataType[],
      totalExpense: totalExpenseValue ?? 0,
      totalIncome: totalIncomeValue ?? 0,
    };
  };

  return {
    calendarData: months.map(m => {
      return {
        ...getDaysArray(m),
        start: new Date(m.getFullYear(), m.getMonth(), 1, 12),
        end: new Date(m.getFullYear(), m.getMonth(), d.getDaysInMonth(m), 12),
      };
    }),
  };
}
