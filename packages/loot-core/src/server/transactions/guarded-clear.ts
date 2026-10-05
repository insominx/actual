// Read-only plan and canonical writer for explicit clearing and unlocking.
// The plan freezes the selected transaction IDs (split parents carry their
// children, which inherit cleared and reconciled state from the parent) and
// the reconciled rows the caller explicitly unlocked. Reconciled rows are
// never changed without `unlock`, and unlocking only removes the reconciled
// flag; it never marks a transaction reconciled.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  TransactionClearingProposal,
  TransactionClearingRequest,
} from '#types/change-proposals';

import { CATEGORIZE_LIMIT } from './guarded-categorize';

import { batchUpdateTransactions } from '.';

type RawTransaction = {
  id: string;
  acct: string;
  amount: number;
  date: number;
  isParent: number;
  isChild: number;
  parent_id: string | null;
  cleared: number;
  reconciled: number;
  tombstone: number;
};

function raw(id: string) {
  return db.first<RawTransaction>('SELECT * FROM transactions WHERE id = ?', [
    id,
  ]);
}

function children(parentId: string) {
  return db.all<RawTransaction>(
    'SELECT * FROM transactions WHERE parent_id = ? AND tombstone = 0 ORDER BY id',
    [parentId],
  );
}

function invalid(message: string): never {
  throw APIError(`Invalid transaction clearing request: ${message}`);
}

export async function prepareTransactionClearing(
  request: TransactionClearingRequest,
): Promise<TransactionClearingProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['ids', 'cleared', 'unlock'].includes(key),
    )
  ) {
    invalid('provide ids, cleared and optional unlock');
  }
  const { ids, cleared, unlock = false } = request;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    !ids.every(id => typeof id === 'string' && id.length > 0)
  ) {
    invalid('ids must be a non-empty array of transaction IDs');
  }
  if (ids.length > CATEGORIZE_LIMIT) {
    invalid(`at most ${CATEGORIZE_LIMIT} transactions per batch`);
  }
  if (new Set(ids).size !== ids.length) {
    invalid('ids must not repeat');
  }
  if (typeof cleared !== 'boolean') {
    invalid('cleared must be a boolean');
  }
  if (typeof unlock !== 'boolean') {
    invalid('unlock must be a boolean');
  }

  const rows: RawTransaction[] = [];
  for (const id of [...ids].sort()) {
    const row = await raw(id);
    if (!row || row.tombstone) {
      throw APIError(`Transaction does not exist: ${id}`);
    }
    if (row.isChild) {
      throw APIError(
        `Transaction ${id} is a split child; its cleared state follows the split parent ${row.parent_id}`,
      );
    }
    if (row.reconciled && !unlock) {
      throw APIError(
        `Transaction ${id} is reconciled; pass unlock to change its cleared state or unlock it`,
      );
    }
    rows.push(row);
    if (row.isParent) rows.push(...(await children(row.id)));
  }

  const isChanged = (row: RawTransaction) =>
    (row.cleared === 1) !== cleared || (unlock && row.reconciled === 1);
  const changedIds = rows.filter(isChanged).map(row => row.id);
  const unlockedIds = unlock
    ? rows.filter(row => row.reconciled === 1).map(row => row.id)
    : [];
  return {
    schemaVersion: 1,
    operation: 'transactions.clear',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transactions: rows.map(row => ({
        id: row.id,
        account: row.acct,
        amount: row.amount,
        date: row.date,
        parentId: row.parent_id,
        cleared: row.cleared === 1,
        reconciled: row.reconciled === 1,
      })),
    },
    after: {
      cleared,
      changedIds,
      unchangedIds: rows.filter(row => !isChanged(row)).map(row => row.id),
      unlockedIds,
    },
    references: {},
    sideEffects: [
      changedIds.length
        ? `set cleared=${cleared} on ${changedIds.length} transaction row(s)${
            unlockedIds.length
              ? ` and remove the reconciled lock from ${unlockedIds.length}`
              : ''
          } through the canonical batch owner; amounts, dates, accounts and categories are unchanged and rules are not rerun`
        : 'no transaction changes; every selected transaction already has this state',
    ],
  };
}

export async function performTransactionClearing(
  current: TransactionClearingProposal,
) {
  const { changedIds, unlockedIds, cleared } = current.after;
  if (changedIds.length) {
    await batchUpdateTransactions({
      updated: changedIds.map(id =>
        unlockedIds.includes(id)
          ? { id, cleared, reconciled: false }
          : { id, cleared },
      ),
    });
  }
  for (const before of current.before.transactions) {
    const actual = await raw(before.id);
    const changed = changedIds.includes(before.id);
    if (
      !rowMatches(actual, {
        cleared: (changed ? cleared : before.cleared) ? 1 : 0,
        reconciled: unlockedIds.includes(before.id)
          ? 0
          : before.reconciled
            ? 1
            : 0,
        amount: before.amount,
        date: before.date,
        acct: before.account,
        tombstone: 0,
      })
    ) {
      throw new Error('Transaction clearing acknowledgement is incomplete');
    }
  }
  return { changed: changedIds.length > 0, affectedIds: changedIds };
}
