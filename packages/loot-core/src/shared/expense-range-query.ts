import { q } from '#shared/query';
import type { IntegerAmount } from '#shared/util';

export type ExpenseRange = { start: string; endExclusive: string };

export type ExpenseQueryRow = {
  id: string;
  date: string;
  amount: IntegerAmount;
  categoryId: string | null;
  isIncome: boolean | null;
  transferAccount: string | null;
  transferOffbudget: boolean | null;
};

export type ExpenseLeaf = {
  id: string;
  date: string;
  categoryId: string | null;
  spending: IntegerAmount;
};

export function buildExpenseRangeQuery({ start, endExclusive }: ExpenseRange) {
  return q('transactions')
    .options({ splits: 'inline' })
    .filter({
      date: { $gte: start },
      'account.offbudget': false,
      is_parent: false,
    })
    .filter({ date: { $lt: endExclusive } })
    .select([
      'id',
      'date',
      'amount',
      { categoryId: 'category' },
      { isIncome: 'category.is_income' },
      { transferAccount: 'payee.transfer_acct' },
      { transferOffbudget: 'payee.transfer_acct.offbudget' },
    ]);
}

export function normalizeExpenseLeaves(
  rows: readonly ExpenseQueryRow[],
): ExpenseLeaf[] {
  const leaves: ExpenseLeaf[] = [];
  for (const row of rows) {
    if (row.transferAccount && row.transferOffbudget === false) {
      continue;
    }
    if (row.isIncome || (row.categoryId === null && row.amount >= 0)) {
      continue;
    }
    leaves.push({
      id: row.id,
      date: row.date,
      categoryId: row.categoryId,
      spending: -row.amount,
    });
  }
  return leaves;
}
