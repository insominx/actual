import * as db from '#server/db';
import { APIError } from '#server/errors';
// Read-only account inspection for agent tools. Balances use the same rows as
// the engine's account balance (leaf transactions that are not deleted), split
// by cleared and reconciled status, with rows dated after the cutoff reported
// separately as future activity. Totals separate on-budget and off-budget
// accounts, and closed accounts with a balance are disclosed even when they
// are not listed.
import * as monthUtils from '#shared/months';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string) {
  if (!DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

type RawAccount = {
  id: string;
  name: string;
  offbudget: number;
  closed: number;
  account_group_id: string | null;
  group_name: string | null;
};

type RawBalance = {
  acct: string;
  ledger: number | null;
  cleared: number | null;
  reconciled: number | null;
  future: number | null;
  futureCount: number;
};

export type AccountBalances = {
  ledger: number;
  cleared: number;
  uncleared: number;
  reconciled: number;
  future: number;
  futureTransactionCount: number;
};

export type AccountInspection = {
  cutoff: string;
  accounts: Array<{
    id: string;
    name: string;
    offbudget: boolean;
    closed: boolean;
    group: { id: string; name: string | null } | null;
    sameNameIds: string[];
    balances: AccountBalances;
  }>;
  totals: { onBudget: number; offBudget: number; all: number };
  excludedClosedWithBalance: Array<{
    id: string;
    name: string;
    ledger: number;
  }>;
};

export async function inspectAccounts({
  cutoff,
  includeClosed = false,
}: {
  cutoff?: string;
  includeClosed?: boolean;
} = {}): Promise<AccountInspection> {
  const day = cutoff ?? monthUtils.currentDay();
  if (typeof day !== 'string' || !isCalendarDay(day)) {
    throw APIError('Cutoff must be a valid YYYY-MM-DD date');
  }
  const repr = db.toDateRepr(day);
  const accounts = await db.all<RawAccount>(
    `SELECT a.id, a.name, a.offbudget, a.closed, a.account_group_id,
            g.name AS group_name
       FROM accounts a
       LEFT JOIN account_groups g ON g.id = a.account_group_id AND g.tombstone = 0
      WHERE a.tombstone = 0
      ORDER BY a.sort_order, a.id`,
  );
  const balances = await db.all<RawBalance>(
    `SELECT acct,
            SUM(CASE WHEN date <= ? THEN amount ELSE 0 END) AS ledger,
            SUM(CASE WHEN date <= ? AND cleared = 1 THEN amount ELSE 0 END) AS cleared,
            SUM(CASE WHEN date <= ? AND reconciled = 1 THEN amount ELSE 0 END) AS reconciled,
            SUM(CASE WHEN date > ? THEN amount ELSE 0 END) AS future,
            SUM(CASE WHEN date > ? THEN 1 ELSE 0 END) AS futureCount
       FROM transactions
      WHERE isParent = 0 AND tombstone = 0
      GROUP BY acct`,
    [repr, repr, repr, repr, repr],
  );
  const byAccount = new Map(balances.map(row => [row.acct, row]));
  const names = new Map<string, string[]>();
  for (const account of accounts) {
    const key = account.name.trim().toLowerCase();
    names.set(key, [...(names.get(key) ?? []), account.id]);
  }
  const balanceOf = (id: string): AccountBalances => {
    const row = byAccount.get(id);
    const ledger = row?.ledger ?? 0;
    const cleared = row?.cleared ?? 0;
    return {
      ledger,
      cleared,
      uncleared: ledger - cleared,
      reconciled: row?.reconciled ?? 0,
      future: row?.future ?? 0,
      futureTransactionCount: row?.futureCount ?? 0,
    };
  };
  const listed = accounts.filter(account => includeClosed || !account.closed);
  const result = listed.map(account => ({
    id: account.id,
    name: account.name,
    offbudget: !!account.offbudget,
    closed: !!account.closed,
    group: account.account_group_id
      ? { id: account.account_group_id, name: account.group_name }
      : null,
    sameNameIds: (names.get(account.name.trim().toLowerCase()) ?? []).filter(
      id => id !== account.id,
    ),
    balances: balanceOf(account.id),
  }));
  const onBudget = result
    .filter(account => !account.offbudget)
    .reduce((sum, account) => sum + account.balances.ledger, 0);
  const offBudget = result
    .filter(account => account.offbudget)
    .reduce((sum, account) => sum + account.balances.ledger, 0);
  return {
    cutoff: day,
    accounts: result,
    totals: { onBudget, offBudget, all: onBudget + offBudget },
    excludedClosedWithBalance: includeClosed
      ? []
      : accounts
          .filter(
            account => account.closed && balanceOf(account.id).ledger !== 0,
          )
          .map(account => ({
            id: account.id,
            name: account.name,
            ledger: balanceOf(account.id).ledger,
          })),
  };
}
