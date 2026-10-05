// Read-only transfer review for agent tools. Candidates are pairs of unlinked
// leaf transactions in different accounts whose amounts cancel within a date
// window, with the evidence and ambiguity that decide whether a match is
// safe. Inspection checks one transaction's link from both sides. The
// classification follows the engine's own transfer rule: a transfer between
// two on-budget (or two off-budget) accounts clears the category and leaves
// net budget cash unchanged; an on-budget to off-budget transfer crosses the
// budget boundary and keeps its category.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { fromDateRepr, toDateRepr } from '#server/models';
import { transferClearsCategory } from '#server/transactions/transfer';

const DAY_MS = 86400000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type TransferClassification =
  | 'internal'
  | 'off-budget-internal'
  | 'budget-boundary';

export type TransferIssue =
  | 'missing-counterpart'
  | 'not-reciprocal'
  | 'amount-mismatch'
  | 'payee-mismatch'
  | 'same-account'
  | 'unlinked-transfer-payee';

export type TransferLeg = {
  id: string;
  account: { id: string; name: string; offbudget: boolean } | null;
  date: string;
  amount: number;
  payee: { id: string; name: string; transferAccount: string | null } | null;
  category: string | null;
  notes: string | null;
  imported: boolean;
  cleared: boolean;
  reconciled: boolean;
  parentId: string | null;
  transferId: string | null;
};

export type TransferCandidate = {
  from: TransferLeg;
  to: TransferLeg;
  amount: number;
  dateGapDays: number;
  classification: TransferClassification;
  ambiguous: boolean;
  alternatives: { fromId: string[]; toId: string[] };
  splitChild: boolean;
  reconciled: boolean;
};

export type TransferCandidates = {
  window: { start: string | null; end: string | null; days: number };
  account: string | null;
  candidates: TransferCandidate[];
  truncated: boolean;
  ambiguousCount: number;
};

export type TransferInspection = {
  transaction: TransferLeg;
  counterpart: TransferLeg | null;
  linked: boolean;
  classification: TransferClassification | null;
  issues: TransferIssue[];
  categoryCleared: boolean | null;
  repair: 'none' | 'resync' | 'unlink' | 'relink';
};

type RawRow = {
  id: string;
  acct: string;
  amount: number;
  date: number;
  description: string | null;
  category: string | null;
  notes: string | null;
  imported_id: string | null;
  cleared: number;
  reconciled: number;
  isParent: number;
  isChild: number;
  parent_id: string | null;
  transferred_id: string | null;
  starting_balance_flag: number;
  tombstone: number;
};

type RawAccount = {
  id: string;
  name: string;
  offbudget: number;
  tombstone: number;
};

type RawPayee = {
  id: string;
  name: string;
  transfer_acct: string | null;
};

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

async function lookups() {
  const accounts = new Map(
    (
      await db.all<RawAccount>(
        'SELECT id, name, offbudget, tombstone FROM accounts',
      )
    ).map(row => [row.id, row]),
  );
  const payees = new Map(
    (
      await db.all<RawPayee>(
        'SELECT id, name, transfer_acct FROM payees WHERE tombstone = 0',
      )
    ).map(row => [row.id, row]),
  );
  return { accounts, payees };
}

type Lookups = Awaited<ReturnType<typeof lookups>>;

function leg(row: RawRow, { accounts, payees }: Lookups): TransferLeg {
  const account = accounts.get(row.acct);
  const payee = row.description ? payees.get(row.description) : undefined;
  return {
    id: row.id,
    account: account
      ? { id: account.id, name: account.name, offbudget: !!account.offbudget }
      : null,
    date: fromDateRepr(row.date),
    amount: row.amount,
    payee: payee
      ? {
          id: payee.id,
          name: payee.name,
          transferAccount: payee.transfer_acct,
        }
      : null,
    category: row.category,
    notes: row.notes,
    imported: !!row.imported_id,
    cleared: row.cleared === 1,
    reconciled: row.reconciled === 1,
    parentId: row.parent_id,
    transferId: row.transferred_id,
  };
}

export function classifyTransfer(
  fromOffBudget: boolean,
  toOffBudget: boolean,
): TransferClassification {
  if (fromOffBudget !== toOffBudget) return 'budget-boundary';
  return fromOffBudget ? 'off-budget-internal' : 'internal';
}

function gapDays(a: number, b: number) {
  return Math.round(
    Math.abs(
      Date.parse(`${fromDateRepr(a)}T00:00:00Z`) -
        Date.parse(`${fromDateRepr(b)}T00:00:00Z`),
    ) / DAY_MS,
  );
}

export async function findTransferCandidates(
  options: {
    account?: string;
    start?: string;
    end?: string;
    days?: number;
    limit?: number;
  } = {},
): Promise<TransferCandidates> {
  const { account, start, end, days = 3, limit = 200 } = options;
  if (start !== undefined && !isCalendarDay(start)) {
    throw APIError('start must be a YYYY-MM-DD date');
  }
  if (end !== undefined && !isCalendarDay(end)) {
    throw APIError('end must be a YYYY-MM-DD date');
  }
  if (start && end && start > end) {
    throw APIError('start must not be after end');
  }
  if (!Number.isInteger(days) || days < 0 || days > 31) {
    throw APIError('days must be an integer from 0 to 31');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw APIError('limit must be an integer from 1 to 1000');
  }
  const maps = await lookups();
  if (account !== undefined) {
    const found = maps.accounts.get(account);
    if (!found || found.tombstone) {
      throw APIError(`Account does not exist: ${account}`);
    }
  }
  // Widen the scan by the window so a pair straddling the range edge is seen.
  const params: number[] = [];
  let where =
    't.tombstone = 0 AND t.isParent = 0 AND t.transferred_id IS NULL AND COALESCE(t.starting_balance_flag, 0) = 0 AND t.amount != 0 AND a.tombstone = 0';
  if (start) {
    where += ' AND t.date >= ?';
    params.push(
      toDateRepr(
        new Date(Date.parse(`${start}T00:00:00Z`) - days * DAY_MS)
          .toISOString()
          .slice(0, 10),
      ),
    );
  }
  if (end) {
    where += ' AND t.date <= ?';
    params.push(
      toDateRepr(
        new Date(Date.parse(`${end}T00:00:00Z`) + days * DAY_MS)
          .toISOString()
          .slice(0, 10),
      ),
    );
  }
  const rows = await db.all<RawRow>(
    `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.acct WHERE ${where} ORDER BY t.date, t.id`,
    params,
  );
  // A row whose payee is already a transfer payee would be linked by the
  // engine; it is reported by inspection, not offered as a candidate.
  const unlinked = rows.filter(row => {
    const payee = row.description ? maps.payees.get(row.description) : null;
    return !payee?.transfer_acct;
  });
  const byAmount = new Map<number, RawRow[]>();
  for (const row of unlinked) {
    const list = byAmount.get(row.amount) ?? [];
    list.push(row);
    byAmount.set(row.amount, list);
  }
  const startRepr = start ? toDateRepr(start) : null;
  const endRepr = end ? toDateRepr(end) : null;
  const inRange = (row: RawRow) =>
    (startRepr === null || row.date >= startRepr) &&
    (endRepr === null || row.date <= endRepr);
  const pairs: Array<[RawRow, RawRow]> = [];
  for (const from of unlinked) {
    if (from.amount >= 0) continue;
    for (const to of byAmount.get(-from.amount) ?? []) {
      if (to.acct === from.acct) continue;
      if (gapDays(from.date, to.date) > days) continue;
      if (!inRange(from) && !inRange(to)) continue;
      if (account && from.acct !== account && to.acct !== account) continue;
      pairs.push([from, to]);
    }
  }
  const fromAlternatives = new Map<string, string[]>();
  const toAlternatives = new Map<string, string[]>();
  for (const [from, to] of pairs) {
    fromAlternatives.set(from.id, [
      ...(fromAlternatives.get(from.id) ?? []),
      to.id,
    ]);
    toAlternatives.set(to.id, [...(toAlternatives.get(to.id) ?? []), from.id]);
  }
  const candidates = pairs.map(([from, to]): TransferCandidate => {
    const fromLeg = leg(from, maps);
    const toLeg = leg(to, maps);
    const otherTo = fromAlternatives.get(from.id)!.filter(id => id !== to.id);
    const otherFrom = toAlternatives.get(to.id)!.filter(id => id !== from.id);
    return {
      from: fromLeg,
      to: toLeg,
      amount: -from.amount,
      dateGapDays: gapDays(from.date, to.date),
      classification: classifyTransfer(
        !!fromLeg.account?.offbudget,
        !!toLeg.account?.offbudget,
      ),
      ambiguous: otherTo.length > 0 || otherFrom.length > 0,
      alternatives: { fromId: otherFrom, toId: otherTo },
      splitChild: !!(from.isChild || to.isChild),
      reconciled: !!(from.reconciled || to.reconciled),
    };
  });
  return {
    window: { start: start ?? null, end: end ?? null, days },
    account: account ?? null,
    candidates: candidates.slice(0, limit),
    truncated: candidates.length > limit,
    ambiguousCount: candidates.filter(c => c.ambiguous).length,
  };
}

function raw(id: string) {
  return db.first<RawRow>('SELECT * FROM transactions WHERE id = ?', [id]);
}

export async function inspectTransfer(id: string): Promise<TransferInspection> {
  if (typeof id !== 'string' || !id) {
    throw APIError('Transfer inspection needs a transaction ID');
  }
  const row = await raw(id);
  if (!row || row.tombstone) {
    throw APIError(`Transaction does not exist: ${id}`);
  }
  const maps = await lookups();
  const transaction = leg(row, maps);
  const issues: TransferIssue[] = [];
  const payeeAccount = transaction.payee?.transferAccount ?? null;
  if (row.isParent) {
    // Split parents never carry the link; their children do.
    return {
      transaction,
      counterpart: null,
      linked: false,
      classification: null,
      issues,
      categoryCleared: null,
      repair: 'none',
    };
  }
  if (!row.transferred_id) {
    if (payeeAccount) issues.push('unlinked-transfer-payee');
    return {
      transaction,
      counterpart: null,
      linked: false,
      classification: null,
      issues,
      categoryCleared: null,
      repair: issues.length ? 'relink' : 'none',
    };
  }
  const other = await raw(row.transferred_id);
  if (!other || other.tombstone) {
    issues.push('missing-counterpart');
    return {
      transaction,
      counterpart: null,
      linked: true,
      classification: null,
      issues,
      categoryCleared: null,
      repair: 'unlink',
    };
  }
  const counterpart = leg(other, maps);
  if (other.transferred_id !== row.id) issues.push('not-reciprocal');
  if (other.acct === row.acct) issues.push('same-account');
  if (other.amount + row.amount !== 0) issues.push('amount-mismatch');
  if (payeeAccount !== other.acct) issues.push('payee-mismatch');
  const fromOff = !!transaction.account?.offbudget;
  const toOff = !!counterpart.account?.offbudget;
  const structural =
    issues.includes('not-reciprocal') || issues.includes('same-account');
  return {
    transaction,
    counterpart,
    linked: true,
    classification: classifyTransfer(fromOff, toOff),
    issues,
    categoryCleared: transferClearsCategory(fromOff ? 1 : 0, toOff ? 1 : 0),
    repair: !issues.length
      ? 'none'
      : structural || !payeeAccount
        ? 'unlink'
        : 'resync',
  };
}

export async function auditTransfers(options: { account?: string } = {}) {
  const params: string[] = [];
  let where =
    't.tombstone = 0 AND t.isParent = 0 AND (t.transferred_id IS NOT NULL OR p.transfer_acct IS NOT NULL)';
  if (options.account !== undefined) {
    if (typeof options.account !== 'string' || !options.account) {
      throw APIError('account must be an account ID');
    }
    where += ' AND t.acct = ?';
    params.push(options.account);
  }
  const ids = await db.all<{ id: string }>(
    `SELECT t.id FROM transactions t LEFT JOIN payees p ON p.id = t.description AND p.tombstone = 0 WHERE ${where} ORDER BY t.date, t.id`,
    params,
  );
  const findings: TransferInspection[] = [];
  let linked = 0;
  for (const { id } of ids) {
    const inspection = await inspectTransfer(id);
    if (inspection.linked) linked++;
    if (inspection.issues.length) findings.push(inspection);
  }
  return { checked: ids.length, linked, findings };
}
