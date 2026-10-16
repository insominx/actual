import * as db from '#server/db';
import { APIError } from '#server/errors';
import { MAX_SAFE_NUMBER } from '#shared/util';

// The budget spreadsheet adds amounts with safeNumber, which throws above
// 2^51. A throwing cell never settles, so every later load of the budget
// waits forever. Each amount is already bounded on its own, but several
// valid amounts can still add up past the limit. Every sheet value is a sum
// of a subset of the stored amounts, so keeping the total absolute amount
// (transactions, subtransactions and budgeted allocations) under the limit
// keeps every sum safe.
export async function assertEngineHeadroom(
  additionalAmounts: number[],
  replacedAmount = 0,
) {
  const stored = await db.first<{ mass: number }>(
    `SELECT
       (SELECT TOTAL(ABS(amount)) FROM v_transactions_internal_alive) +
       (SELECT TOTAL(ABS(amount)) FROM zero_budgets) +
       (SELECT TOTAL(ABS(amount)) FROM reflect_budgets) AS mass`,
  );
  const added = additionalAmounts.reduce(
    (sum, amount) => sum + Math.abs(amount),
    0,
  );
  if (
    (stored?.mass ?? 0) - Math.abs(replacedAmount) + added >
    MAX_SAFE_NUMBER
  ) {
    throw APIError(
      'This change would make the amounts in the budget add up to more than the budget engine can calculate (about 22 trillion in total); a budget past that limit stops loading.',
    );
  }
}

// The budgeted amount a category already holds in a month (YYYY-MM), which a
// new allocation replaces.
export async function budgetedAmount(month: string, categoryId: string) {
  const monthInt = Number(month.replace('-', ''));
  let total = 0;
  for (const table of ['zero_budgets', 'reflect_budgets']) {
    const row = await db.first<{ amount: number | null }>(
      `SELECT amount FROM ${table} WHERE month = ? AND category = ?`,
      [monthInt, categoryId],
    );
    total = Math.max(total, Math.abs(row?.amount ?? 0));
  }
  return total;
}

// Every numeric amount in rows, including subtransactions.
export function rowAmounts(rows: unknown): number[] {
  const amounts: number[] = [];
  if (!Array.isArray(rows)) return amounts;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const { amount, subtransactions } = row as {
      amount?: unknown;
      subtransactions?: unknown;
    };
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      amounts.push(amount);
    }
    amounts.push(...rowAmounts(subtransactions));
  }
  return amounts;
}
