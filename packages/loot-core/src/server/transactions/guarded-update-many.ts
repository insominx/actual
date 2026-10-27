// Read-only plan and canonical writer for guarded batch field updates: notes,
// category, payee and cleared on many transactions at once, each row with its
// own values. The plan freezes the exact IDs and their current fields, so apply
// rejects any change to the affected records instead of widening the batch.
// Amounts, dates and accounts are out of scope, and rules are not rerun.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  TransactionUpdateManyProposal,
  TransactionUpdateManyRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

import { batchUpdateTransactions } from '.';

export const UPDATE_MANY_LIMIT = 1000;

const FIELDS = ['notes', 'category', 'payee', 'cleared'] as const;
type Field = (typeof FIELDS)[number];

type RawTransaction = {
  id: string;
  acct: string;
  category: string | null;
  description: string | null;
  notes: string | null;
  cleared: number;
  amount: number;
  date: number;
  isParent: number;
  transferred_id: string | null;
  reconciled: number;
  tombstone: number;
};

function raw(id: string) {
  return db.first<RawTransaction>('SELECT * FROM transactions WHERE id = ?', [
    id,
  ]);
}

async function offBudget(accountId: string) {
  const account = await db.first<{ offbudget: number }>(
    'SELECT offbudget FROM accounts WHERE id = ?',
    [accountId],
  );
  return account ? account.offbudget === 1 : null;
}

function invalid(message: string): never {
  throw APIError(`Invalid transaction batch update: ${message}`);
}

function current(row: RawTransaction, field: Field) {
  if (field === 'payee') return row.description;
  if (field === 'cleared') return row.cleared === 1;
  return row[field];
}

async function checkCategory(row: RawTransaction, category: string | null) {
  if (category === null) return;
  const found = await db.first<{ tombstone: number }>(
    'SELECT tombstone FROM categories WHERE id = ?',
    [category],
  );
  if (!found || found.tombstone) {
    throw APIError(`Category does not exist: ${category}`);
  }
  if (row.isParent) {
    throw APIError(
      `Transaction ${row.id} is a split parent; categorize its split children instead`,
    );
  }
  if (await offBudget(row.acct)) {
    throw APIError(
      `Transaction ${row.id} is in an off-budget account; off-budget transactions are not categorized`,
    );
  }
  if (row.transferred_id) {
    const counterpart = await raw(row.transferred_id);
    if (
      counterpart &&
      !counterpart.tombstone &&
      (await offBudget(counterpart.acct)) === false
    ) {
      throw APIError(
        `Transaction ${row.id} is a transfer between on-budget accounts; such transfers carry no category`,
      );
    }
  }
}

async function checkPayee(row: RawTransaction, payee: string) {
  const found = await db.first<{
    tombstone: number;
    transfer_acct: string | null;
  }>('SELECT tombstone, transfer_acct FROM payees WHERE id = ?', [payee]);
  if (!found || found.tombstone) {
    throw APIError(`Payee does not exist: ${payee}`);
  }
  if (found.transfer_acct) {
    throw APIError(
      `Payee ${payee} is a transfer payee; link transfers with transfers match instead`,
    );
  }
  if (row.transferred_id) {
    throw APIError(
      `Transaction ${row.id} is a transfer; its payee is the transfer and cannot be replaced here`,
    );
  }
}

export async function prepareTransactionUpdateMany(
  request: TransactionUpdateManyRequest,
): Promise<TransactionUpdateManyProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(key => !['rows', 'allowReconciled'].includes(key))
  ) {
    invalid('provide rows and optional allowReconciled');
  }
  const { rows: requested, allowReconciled = false } = request;
  if (!Array.isArray(requested) || !requested.length) {
    invalid('rows must be a non-empty array');
  }
  if (requested.length > UPDATE_MANY_LIMIT) {
    invalid(`at most ${UPDATE_MANY_LIMIT} transactions per batch`);
  }
  if (typeof allowReconciled !== 'boolean') {
    invalid('allowReconciled must be a boolean');
  }
  const seen = new Set<string>();
  for (const item of requested) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.id !== 'string' ||
      !item.id
    ) {
      invalid('every row needs a transaction id');
    }
    const fields = Object.keys(item).filter(key => key !== 'id');
    if (!fields.length || fields.some(key => !FIELDS.includes(key as Field))) {
      invalid(`row ${item.id} must set one or more of ${FIELDS.join(', ')}`);
    }
    if (seen.has(item.id)) invalid(`transaction ${item.id} appears twice`);
    seen.add(item.id);
    if (
      'notes' in item &&
      item.notes !== null &&
      typeof item.notes !== 'string'
    ) {
      invalid(`notes for ${item.id} must be a string or null`);
    }
    if (
      'category' in item &&
      item.category !== null &&
      (typeof item.category !== 'string' || !item.category)
    ) {
      invalid(`category for ${item.id} must be a category ID or null`);
    }
    if ('payee' in item && (typeof item.payee !== 'string' || !item.payee)) {
      invalid(`payee for ${item.id} must be a payee ID`);
    }
    if ('cleared' in item && typeof item.cleared !== 'boolean') {
      invalid(`cleared for ${item.id} must be a boolean`);
    }
  }

  const before: TransactionUpdateManyProposal['before']['transactions'] = [];
  const changes: TransactionUpdateManyProposal['after']['changes'] = [];
  const unchangedIds: string[] = [];
  const reconciledIds: string[] = [];
  for (const item of [...requested].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const row = await raw(item.id);
    if (!row || row.tombstone) {
      throw APIError(`Transaction does not exist: ${item.id}`);
    }
    if ('category' in item) await checkCategory(row, item.category ?? null);
    if ('payee' in item) await checkPayee(row, item.payee as string);
    const fields: Record<string, unknown> = {};
    for (const field of FIELDS) {
      if (field in item && item[field] !== current(row, field)) {
        fields[field] = item[field];
      }
    }
    if (Object.keys(fields).length && row.reconciled) {
      if (!allowReconciled) {
        throw APIError(
          `Transaction ${item.id} is reconciled; pass allowReconciled to change it`,
        );
      }
      reconciledIds.push(item.id);
    }
    before.push({
      id: row.id,
      account: row.acct,
      amount: row.amount,
      date: row.date,
      notes: row.notes,
      category: row.category,
      payee: row.description,
      cleared: row.cleared === 1,
      transferId: row.transferred_id,
      reconciled: row.reconciled === 1,
    });
    if (Object.keys(fields).length) changes.push({ id: item.id, fields });
    else unchangedIds.push(item.id);
  }

  const counts = FIELDS.map(
    field =>
      [field, changes.filter(change => field in change.fields).length] as const,
  ).filter(([, n]) => n > 0);
  return {
    schemaVersion: 1,
    operation: 'transactions.update-many',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), transactions: before },
    after: {
      changes,
      changedIds: changes.map(change => change.id),
      unchangedIds,
      reconciledIds,
    },
    references: {},
    sideEffects: changes.length
      ? [
          `update ${changes.length} transaction(s) through the canonical batch owner (${counts
            .map(([field, n]) => `${field}: ${n}`)
            .join(
              ', ',
            )}); amounts, dates, accounts and reconciled flags are unchanged, rules are not rerun and transfer counterparts are not touched`,
        ]
      : ['no transaction changes; every row already has the requested values'],
  };
}

export async function performTransactionUpdateMany(
  current: TransactionUpdateManyProposal,
) {
  const { changes } = current.after;
  if (changes.length) {
    await batchUpdateTransactions({
      // A null notes or category clears the field; the entity type omits null.
      updated: changes.map(
        change =>
          ({
            id: change.id,
            ...change.fields,
          }) as unknown as Partial<TransactionEntity>,
      ),
      // One leg only: the transfer owner would resync the counterpart's notes,
      // which the proposal neither requests nor discloses.
      runTransfers: false,
    });
  }
  const changed = new Map(changes.map(change => [change.id, change.fields]));
  for (const before of current.before.transactions) {
    const fields = changed.get(before.id) ?? {};
    const expected = {
      notes: 'notes' in fields ? fields.notes : before.notes,
      category: 'category' in fields ? fields.category : before.category,
      description: 'payee' in fields ? fields.payee : before.payee,
      cleared: ('cleared' in fields ? fields.cleared : before.cleared) ? 1 : 0,
      amount: before.amount,
      date: before.date,
      acct: before.account,
      tombstone: 0,
    };
    if (!rowMatches(await raw(before.id), expected)) {
      throw new Error('Transaction batch update acknowledgement is incomplete');
    }
  }
  return { changed: changes.length > 0, affectedIds: [...changed.keys()] };
}
