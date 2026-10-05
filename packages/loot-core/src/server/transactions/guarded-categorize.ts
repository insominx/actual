// Read-only plan and canonical writer for guarded batch categorization. The
// plan freezes the exact transaction IDs, their current categories and the
// reconciled rows the caller explicitly unlocked, so apply rejects any change
// to the affected records instead of widening or narrowing the batch.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  TransactionCategorizationProposal,
  TransactionCategorizationRequest,
} from '#types/change-proposals';

import { batchUpdateTransactions } from '.';

export const CATEGORIZE_LIMIT = 1000;

type RawTransaction = {
  id: string;
  acct: string;
  category: string | null;
  amount: number;
  date: number;
  isParent: number;
  isChild: number;
  parent_id: string | null;
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
  const account = await db.first<{ offbudget: number; tombstone: number }>(
    'SELECT offbudget, tombstone FROM accounts WHERE id = ?',
    [accountId],
  );
  return account ? account.offbudget === 1 : null;
}

function invalid(message: string): never {
  throw APIError(`Invalid transaction categorization request: ${message}`);
}

export async function prepareTransactionCategorization(
  request: TransactionCategorizationRequest,
): Promise<TransactionCategorizationProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['ids', 'category', 'allowReconciled'].includes(key),
    )
  ) {
    invalid('provide ids, category and optional allowReconciled');
  }
  const { ids, category, allowReconciled = false } = request;
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
  if (category !== null && (typeof category !== 'string' || !category)) {
    invalid('category must be a category ID or null');
  }
  if (typeof allowReconciled !== 'boolean') {
    invalid('allowReconciled must be a boolean');
  }

  let target: { id: string; name: string } | null = null;
  if (category !== null) {
    const found = await db.first<{
      id: string;
      name: string;
      tombstone: number;
    }>('SELECT id, name, tombstone FROM categories WHERE id = ?', [category]);
    if (!found || found.tombstone) {
      throw APIError(`Category does not exist: ${category}`);
    }
    target = { id: found.id, name: found.name };
  }

  const rows: RawTransaction[] = [];
  const reconciledIds: string[] = [];
  for (const id of [...ids].sort()) {
    const row = await raw(id);
    if (!row || row.tombstone) {
      throw APIError(`Transaction does not exist: ${id}`);
    }
    if (row.isParent) {
      throw APIError(
        `Transaction ${id} is a split parent; categorize its split children instead`,
      );
    }
    const sourceOffBudget = await offBudget(row.acct);
    if (sourceOffBudget === null) {
      throw APIError(`Transaction ${id} belongs to a missing account`);
    }
    if (category !== null && sourceOffBudget) {
      throw APIError(
        `Transaction ${id} is in an off-budget account; off-budget transactions are not categorized`,
      );
    }
    if (category !== null && row.transferred_id) {
      const counterpart = await raw(row.transferred_id);
      if (
        counterpart &&
        !counterpart.tombstone &&
        (await offBudget(counterpart.acct)) === false
      ) {
        throw APIError(
          `Transaction ${id} is a transfer between on-budget accounts; such transfers carry no category`,
        );
      }
    }
    if (row.reconciled) {
      if (!allowReconciled) {
        throw APIError(
          `Transaction ${id} is reconciled; pass allowReconciled to change its category`,
        );
      }
      reconciledIds.push(id);
    }
    rows.push(row);
  }

  const changedIds = rows
    .filter(row => row.category !== category)
    .map(row => row.id);
  return {
    schemaVersion: 1,
    operation: 'transactions.categorize',
    budget: guardedBudgetIdentity(),
    request: { ids, category, allowReconciled },
    before: {
      sourceHash: await guardedSourceHash(),
      transactions: rows.map(row => ({
        id: row.id,
        account: row.acct,
        amount: row.amount,
        date: row.date,
        category: row.category,
        parentId: row.parent_id,
        transferId: row.transferred_id,
        reconciled: row.reconciled === 1,
      })),
    },
    after: {
      category: target ? { id: target.id, name: target.name } : null,
      changedIds,
      unchangedIds: rows
        .filter(row => row.category === category)
        .map(row => row.id),
      reconciledIds,
    },
    references: {},
    sideEffects: [
      changedIds.length
        ? `set the category of ${changedIds.length} transaction(s) through the canonical batch owner; amounts, dates, accounts, cleared and reconciled flags are unchanged and rules are not rerun`
        : 'no transaction changes; every selected transaction already has this category',
    ],
  };
}

export async function performTransactionCategorization(
  current: TransactionCategorizationProposal,
) {
  const { changedIds } = current.after;
  const category = current.request.category;
  if (changedIds.length) {
    await batchUpdateTransactions({
      updated: changedIds.map(id => ({ id, category })),
    });
  }
  for (const before of current.before.transactions) {
    const actual = await raw(before.id);
    if (
      !rowMatches(actual, {
        category: changedIds.includes(before.id) ? category : before.category,
        amount: before.amount,
        date: before.date,
        acct: before.account,
        tombstone: 0,
      })
    ) {
      throw new Error(
        'Transaction categorization acknowledgement is incomplete',
      );
    }
  }
  return { changed: changedIds.length > 0, affectedIds: changedIds };
}
