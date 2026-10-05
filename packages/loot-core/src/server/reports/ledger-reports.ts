// Ledger reports for agents with declared semantics. Definitions follow the
// app's report spreadsheets: cash flow and spending count on-budget
// accounts only, use split children instead of their parents, and leave
// transfers out (transfers to off-budget accounts are reported on their
// own); net worth sums every account's top-level transactions up to each
// month end, with off-budget ("tracking") accounts split out so net cash
// excludes them. Future-dated rows are excluded unless requested, and
// periods before the first recorded transaction are reported as unknown.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import * as monthUtils from '#shared/months';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 60;
const ID_LIMIT = 1000;

export type ReportRequest = {
  start: string;
  end: string;
  accountIds?: string[];
  includeFuture?: boolean;
  details?: boolean;
};

export type ReportScope = {
  start: string;
  end: string;
  cutoff: string;
  accounts: 'on-budget' | 'all';
  accountIds: string[] | null;
  transfers: string;
  splits: string;
  opening: string;
  futureDated: 'excluded' | 'included';
  currency: string | null;
  amounts: 'integer cents';
};

export type ReportCompleteness = {
  firstTransactionDate: string | null;
  unknownBefore: string | null;
  note: string | null;
};

export type ReportDetailRow = {
  id: string;
  date: string;
  account: string;
  payee: string | null;
  category: string | null;
  notes: string | null;
  amount: number;
};

type Row = {
  id: string;
  date: number;
  account: string;
  account_name: string;
  payee_name: string | null;
  category: string | null;
  category_name: string | null;
  category_tombstone: number | null;
  is_income: number | null;
  notes: string | null;
  amount: number;
  transfer_acct: string | null;
  transfer_offbudget: number | null;
};

function invalid(message: string): never {
  throw APIError(`Invalid report request: ${message}`);
}

function validate(request: ReportRequest, extra: string[] = []) {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key =>
        ![
          'start',
          'end',
          'accountIds',
          'includeFuture',
          'details',
          ...extra,
        ].includes(key),
    )
  ) {
    invalid(
      'provide start, end and optional accountIds, includeFuture, details',
    );
  }
  if (
    typeof request.start !== 'string' ||
    typeof request.end !== 'string' ||
    !MONTH.test(request.start) ||
    !MONTH.test(request.end) ||
    request.end < request.start
  ) {
    invalid('start and end must be YYYY-MM with end on or after start');
  }
  const months = monthUtils.rangeInclusive(request.start, request.end);
  if (months.length > MAX_MONTHS) invalid(`at most ${MAX_MONTHS} months`);
  if (
    request.accountIds !== undefined &&
    (!Array.isArray(request.accountIds) ||
      !request.accountIds.every(id => typeof id === 'string'))
  ) {
    invalid('accountIds must be a list of IDs');
  }
  for (const flag of ['includeFuture', 'details'] as const) {
    if (request[flag] !== undefined && typeof request[flag] !== 'boolean') {
      invalid(`${flag} must be a boolean`);
    }
  }
  const today = monthUtils.currentDay();
  const last = monthUtils.lastDayOfMonth(request.end);
  const cutoff = request.includeFuture || last <= today ? last : today;
  return { months, cutoff };
}

async function currency() {
  const row = await db.first<{ value: string }>(
    "SELECT value FROM preferences WHERE id = 'defaultCurrencyCode'",
  );
  return row?.value || null;
}

async function completeness(start: string): Promise<ReportCompleteness> {
  const row = await db.first<{ first: number | null }>(
    'SELECT MIN(date) AS first FROM v_transactions_internal_alive WHERE is_child = 0',
  );
  const first = row?.first ? db.fromDateRepr(row.first) : null;
  const startDay = monthUtils.firstDayOfMonth(start);
  if (!first || first > startDay) {
    return {
      firstTransactionDate: first,
      unknownBefore: first ?? null,
      note: first
        ? `No transactions are recorded before ${first}; earlier periods are unknown, not zero.`
        : 'No transactions are recorded; every period is unknown, not zero.',
    };
  }
  return { firstTransactionDate: first, unknownBefore: null, note: null };
}

async function accountsFilter(accountIds: string[] | undefined) {
  if (!accountIds) return null;
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM accounts WHERE tombstone = 0 AND id IN (${accountIds
      .map(() => '?')
      .join(',')})`,
    accountIds,
  );
  if (rows.length !== new Set(accountIds).size) {
    throw APIError('One or more accounts do not exist');
  }
  return accountIds;
}

// Leaf rows (split children instead of parents) of on-budget accounts.
async function leafRows(
  start: string,
  cutoff: string,
  accountIds: string[] | null,
) {
  const accountClause = accountIds
    ? ` AND t.account IN (${accountIds.map(() => '?').join(',')})`
    : '';
  return db.all<Row>(
    `SELECT t.id, t.date, t.account, a.name AS account_name, p.name AS payee_name,
            t.category, c.name AS category_name, c.tombstone AS category_tombstone,
            c.is_income, t.notes, t.amount, p.transfer_acct,
            ta.offbudget AS transfer_offbudget
     FROM v_transactions_internal_alive t
     JOIN accounts a ON a.id = t.account AND a.tombstone = 0
     LEFT JOIN payees p ON p.id = t.payee
     LEFT JOIN accounts ta ON ta.id = p.transfer_acct
     LEFT JOIN categories c ON c.id = t.category
     WHERE t.is_parent = 0 AND a.offbudget = 0
       AND t.date >= ? AND t.date <= ?${accountClause}
     ORDER BY t.date, t.id`,
    [
      db.toDateRepr(monthUtils.firstDayOfMonth(start)),
      db.toDateRepr(cutoff),
      ...(accountIds ?? []),
    ],
  );
}

function monthOf(date: number) {
  const day = db.fromDateRepr(date);
  return day.slice(0, 7);
}

function detail(row: Row): ReportDetailRow {
  return {
    id: row.id,
    date: db.fromDateRepr(row.date),
    account: row.account_name,
    payee: row.payee_name,
    category: row.category_name,
    notes: row.notes,
    amount: row.amount,
  };
}

function bounded(rows: Row[]) {
  return {
    contributingIds: rows.slice(0, ID_LIMIT).map(row => row.id),
    contributingTruncated: rows.length > ID_LIMIT,
  };
}

async function scope(
  request: ReportRequest,
  cutoff: string,
  accounts: 'on-budget' | 'all',
  accountIds: string[] | null,
  transfers: string,
): Promise<ReportScope> {
  return {
    start: request.start,
    end: request.end,
    cutoff,
    accounts,
    accountIds,
    transfers,
    splits:
      accounts === 'all'
        ? 'balances use top-level transactions (a split counts once)'
        : 'split children are counted instead of their parent',
    opening:
      'starting balances are ordinary transactions; earlier history is reported under completeness',
    futureDated: request.includeFuture ? 'included' : 'excluded',
    currency: await currency(),
    amounts: 'integer cents',
  };
}

export async function cashFlowReport(request: ReportRequest) {
  const { months, cutoff } = validate(request);
  const accountIds = await accountsFilter(request.accountIds);
  const rows = await leafRows(request.start, cutoff, accountIds);
  const counted = rows.filter(row => !row.transfer_acct);
  const offBudget = rows.filter(
    row => row.transfer_acct && row.transfer_offbudget,
  );
  const byMonth = months.map(month => {
    const inMonth = counted.filter(row => monthOf(row.date) === month);
    const transfers = offBudget.filter(row => monthOf(row.date) === month);
    const income = inMonth
      .filter(row => row.amount > 0)
      .reduce((sum, row) => sum + row.amount, 0);
    const expense = inMonth
      .filter(row => row.amount < 0)
      .reduce((sum, row) => sum + row.amount, 0);
    const transfersOffBudget = transfers.reduce(
      (sum, row) => sum + row.amount,
      0,
    );
    return {
      month,
      income,
      expense,
      net: income + expense,
      transfersOffBudget,
      count: inMonth.length,
    };
  });
  const totals = byMonth.reduce(
    (sum, m) => ({
      income: sum.income + m.income,
      expense: sum.expense + m.expense,
      net: sum.net + m.net,
      transfersOffBudget: sum.transfersOffBudget + m.transfersOffBudget,
    }),
    { income: 0, expense: 0, net: 0, transfersOffBudget: 0 },
  );
  return {
    report: 'cash-flow' as const,
    scope: await scope(
      request,
      cutoff,
      'on-budget',
      accountIds,
      'transfers between accounts are excluded; transfers to off-budget accounts are listed as transfersOffBudget',
    ),
    completeness: await completeness(request.start),
    months: byMonth,
    totals,
    ...bounded(counted),
    ...(request.details ? { details: counted.map(detail) } : {}),
  };
}

export async function categoryReport(request: ReportRequest) {
  const { months, cutoff } = validate(request);
  const accountIds = await accountsFilter(request.accountIds);
  const rows = (await leafRows(request.start, cutoff, accountIds)).filter(
    row => !row.transfer_acct,
  );
  type Bucket = {
    categoryId: string | null;
    name: string;
    kind: 'expense' | 'income' | 'uncategorized';
    deleted: boolean;
    months: Record<string, number>;
    total: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const key = row.category ?? 'uncategorized';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        categoryId: row.category,
        name: row.category
          ? (row.category_name ?? row.category)
          : 'Uncategorized',
        kind: !row.category
          ? 'uncategorized'
          : row.is_income
            ? 'income'
            : 'expense',
        deleted: Boolean(row.category_tombstone),
        months: Object.fromEntries(months.map(month => [month, 0])),
        total: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.months[monthOf(row.date)] += row.amount;
    bucket.total += row.amount;
  }
  const categories = [...buckets.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
  const total = (kind: Bucket['kind']) =>
    categories
      .filter(c => c.kind === kind)
      .reduce((sum, c) => sum + c.total, 0);
  return {
    report: 'categories' as const,
    scope: await scope(
      request,
      cutoff,
      'on-budget',
      accountIds,
      'transfers are excluded; refunds net against their category; deleted categories keep their history and are flagged',
    ),
    completeness: await completeness(request.start),
    categories,
    totals: {
      spending: total('expense'),
      income: total('income'),
      uncategorized: total('uncategorized'),
    },
    ...bounded(rows),
    ...(request.details ? { details: rows.map(detail) } : {}),
  };
}

export async function netWorthReport(request: ReportRequest) {
  const { months, cutoff } = validate(request);
  const accountIds = await accountsFilter(request.accountIds);
  const accounts = await db.all<{
    id: string;
    name: string;
    offbudget: number;
    closed: number;
  }>(
    'SELECT id, name, offbudget, closed FROM accounts WHERE tombstone = 0 ORDER BY sort_order, id',
  );
  const scoped = accountIds
    ? accounts.filter(a => accountIds.includes(a.id))
    : accounts;
  const byMonth = [];
  for (const month of months) {
    const monthEnd = monthUtils.lastDayOfMonth(month);
    const at = monthEnd < cutoff ? monthEnd : cutoff;
    const balances = await db.all<{ account: string; balance: number }>(
      `SELECT account, SUM(amount) AS balance FROM v_transactions_internal_alive
       WHERE is_child = 0 AND date <= ? GROUP BY account`,
      [db.toDateRepr(at)],
    );
    const balance = new Map(balances.map(b => [b.account, b.balance]));
    const rows = scoped.map(a => ({
      id: a.id,
      name: a.name,
      offBudget: Boolean(a.offbudget),
      closed: Boolean(a.closed),
      balance: balance.get(a.id) ?? 0,
    }));
    const netCash = rows
      .filter(r => !r.offBudget)
      .reduce((sum, r) => sum + r.balance, 0);
    const tracking = rows
      .filter(r => r.offBudget)
      .reduce((sum, r) => sum + r.balance, 0);
    byMonth.push({
      month,
      asOf: at,
      netWorth: netCash + tracking,
      netCash,
      tracking,
      accounts: rows,
    });
  }
  return {
    report: 'net-worth' as const,
    scope: await scope(
      request,
      cutoff,
      'all',
      accountIds,
      'transfers between included accounts net to zero; netCash excludes off-budget (tracking) accounts, netWorth includes them',
    ),
    completeness: await completeness(request.start),
    months: byMonth,
  };
}
