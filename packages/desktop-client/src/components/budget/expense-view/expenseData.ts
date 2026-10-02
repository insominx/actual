import type {
  ExpenseLeaf,
  ExpenseRange,
} from '@actual-app/core/shared/expense-range-query';
import * as monthUtils from '@actual-app/core/shared/months';
import type { CategoryGroupEntity } from '@actual-app/core/types/models';

export type ExpensePeriod = 'month' | 'year';
export type ExpenseRow = {
  id: string;
  name: string;
  columns: Record<string, number>;
  total: number;
};
export type ExpenseGroup = ExpenseRow & { categories: ExpenseRow[] };
export type ExpenseSummary = {
  columns: string[];
  groups: ExpenseGroup[];
  uncategorized: ExpenseRow;
  total: ExpenseRow;
};

export function parseDisplayMode(value: unknown): 'budget' | 'expenses' {
  return value === 'expenses' ? 'expenses' : 'budget';
}

export function parseExpensePeriod(value: unknown): ExpensePeriod {
  return value === 'year' ? 'year' : 'month';
}

export function getExpenseRange(
  period: ExpensePeriod,
  anchor: string,
): ExpenseRange {
  if (period === 'year') {
    if (
      !/^\d{4}$/.test(anchor) ||
      Number(anchor) < 1 ||
      Number(anchor) >= 9999
    ) {
      throw new Error('Invalid expense year');
    }
    return {
      start: `${anchor}-01-01`,
      endExclusive: `${String(Number(anchor) + 1).padStart(4, '0')}-01-01`,
    };
  }
  if (
    !monthUtils.isValidYearMonth(anchor) ||
    anchor < '0001-01' ||
    anchor >= '9999-01'
  ) {
    throw new Error('Invalid expense month');
  }
  return {
    start: `${anchor}-01`,
    endExclusive: `${monthUtils.addMonths(anchor, 1)}-01`,
  };
}

export function buildExpenseSummary(
  leaves: readonly ExpenseLeaf[],
  categoryGroups: readonly CategoryGroupEntity[],
  period: ExpensePeriod,
  anchor: string,
): ExpenseSummary {
  const range = getExpenseRange(period, anchor);
  const columns =
    period === 'year'
      ? Array.from(
          { length: 12 },
          (_, index) => `${anchor}-${String(index + 1).padStart(2, '0')}`,
        )
      : monthUtils.dayRange(range.start, range.endExclusive);
  const makeRow = (id: string, name: string): ExpenseRow => ({
    id,
    name,
    columns: Object.fromEntries(columns.map(column => [column, 0])),
    total: 0,
  });
  const categoriesById = new Map<
    string,
    { category: ExpenseRow; group: ExpenseGroup }
  >();
  const groups: ExpenseGroup[] = categoryGroups
    .filter(group => !group.is_income)
    .map(group => {
      const result: ExpenseGroup = {
        ...makeRow(group.id, group.name),
        categories: [],
      };
      for (const category of group.categories ?? []) {
        if (!category.is_income) {
          const row = makeRow(category.id, category.name);
          result.categories.push(row);
          categoriesById.set(category.id, { category: row, group: result });
        }
      }
      return result;
    });
  const uncategorized = makeRow('uncategorized', '');
  const total = makeRow('total', '');
  const add = (row: ExpenseRow, column: string, spending: number) => {
    row.columns[column] += spending;
    row.total += spending;
  };
  for (const leaf of leaves) {
    if (leaf.date < range.start || leaf.date >= range.endExclusive) {
      continue;
    }
    const column = period === 'year' ? leaf.date.slice(0, 7) : leaf.date;
    if (!Object.hasOwn(total.columns, column)) {
      continue;
    }
    const entry = leaf.categoryId
      ? categoriesById.get(leaf.categoryId)
      : undefined;
    if (entry) {
      add(entry.category, column, leaf.spending);
      add(entry.group, column, leaf.spending);
    } else {
      add(uncategorized, column, leaf.spending);
    }
    add(total, column, leaf.spending);
  }
  return { columns, groups, uncategorized, total };
}
