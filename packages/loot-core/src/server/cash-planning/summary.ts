import { calendarMonths, UNCATEGORIZED_ID } from '#shared/cash-planning';
import type {
  CashPlanningRequest,
  CashPlanningSummary,
} from '#types/models/cash-planning';

export type PlanningAccount = {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  tombstone: boolean;
};
export type PlanningCategory = {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  tombstone: boolean;
};
export type PlanningTransaction = {
  id: string;
  account: string;
  date: string;
  amount: number;
  category: string | null;
  payee: string | null;
  transfer_id: string | null;
  is_parent: boolean;
  parent_id: string | null;
  starting_balance_flag: boolean;
  tombstone: boolean;
};
export type PlanningPayee = { id: string; transfer_acct: string | null };

export function summarizeCashPlanning(
  request: CashPlanningRequest,
  asOf: string,
  accounts: PlanningAccount[],
  transactions: PlanningTransaction[],
  categories: PlanningCategory[],
  payees: PlanningPayee[],
): CashPlanningSummary {
  if (request.endDate > asOf) {
    throw new Error('Cash planning history cannot include future dates');
  }
  const months = calendarMonths(request.startDate, request.endDate);
  const included = accounts.filter(
    account => !account.tombstone && !account.offbudget,
  );
  const accountIds = new Set(included.map(account => account.id));
  const categoryMap = new Map(
    categories.map(category => [category.id, category]),
  );
  const transferAccounts = new Map(
    payees.map(payee => [payee.id, payee.transfer_acct]),
  );
  const transactionMap = new Map(
    transactions.map(transaction => [transaction.id, transaction]),
  );
  const balances = new Map<string, number>();
  const outflows = new Map<string, number>();
  // Include available categories with no historical activity so they can have targets.
  for (const category of categories) {
    if (!category.is_income && !category.tombstone && !category.hidden) {
      outflows.set(category.id, 0);
    }
  }
  let income = 0;
  let externalMovement = 0;
  let transactionCount = 0;
  for (const transaction of transactions) {
    if (
      transaction.tombstone ||
      transaction.is_parent ||
      !accountIds.has(transaction.account) ||
      transaction.date > asOf
    ) {
      continue;
    }
    const parent = transaction.parent_id
      ? transactionMap.get(transaction.parent_id)
      : undefined;
    if (parent?.tombstone || (transaction.parent_id && !parent)) {
      continue;
    }
    balances.set(
      transaction.account,
      (balances.get(transaction.account) ?? 0) + transaction.amount,
    );
    if (
      transaction.date < request.startDate ||
      transaction.date > request.endDate ||
      transaction.starting_balance_flag ||
      parent?.starting_balance_flag
    ) {
      continue;
    }
    const destination =
      (transaction.payee ? transferAccounts.get(transaction.payee) : null) ??
      (transaction.transfer_id
        ? transactionMap.get(transaction.transfer_id)?.account
        : null);
    if (destination) {
      if (!accountIds.has(destination)) {
        externalMovement += transaction.amount;
        transactionCount++;
      }
      continue;
    }
    transactionCount++;
    const category = transaction.category
      ? categoryMap.get(transaction.category)
      : undefined;
    if (
      category?.is_income ||
      (!transaction.category && transaction.amount > 0)
    ) {
      income += transaction.amount;
    } else {
      const id = transaction.category ?? UNCATEGORIZED_ID;
      outflows.set(id, (outflows.get(id) ?? 0) - transaction.amount);
    }
  }
  const categoryRows = [...outflows]
    .map(([id, outflow]) => {
      const category = categoryMap.get(id);
      return {
        id,
        name: category?.name ?? null,
        available:
          id === UNCATEGORIZED_ID ||
          Boolean(category && !category.tombstone && !category.hidden),
        outflow,
        monthlyOutflow: outflow / months,
      };
    })
    .sort((a, b) => b.outflow - a.outflow || a.id.localeCompare(b.id));
  const accountRows = included.map(account => ({
    id: account.id,
    name: account.name,
    closed: account.closed,
    balance: balances.get(account.id) ?? 0,
  }));
  const outflow = categoryRows.reduce(
    (sum, category) => sum + category.outflow,
    0,
  );
  return {
    ...request,
    asOf,
    balance: accountRows.reduce((sum, account) => sum + account.balance, 0),
    accounts: accountRows,
    months,
    transactionCount,
    income,
    outflow,
    externalMovement,
    monthlyIncome: income / months,
    monthlyOutflow: outflow / months,
    monthlyExternalMovement: externalMovement / months,
    categories: categoryRows,
  };
}
