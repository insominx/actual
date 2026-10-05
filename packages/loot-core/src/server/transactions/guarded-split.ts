// Read-only plan and canonical writer for guarded split edits. The plan fixes
// the parent amount, the planned children and the children being replaced;
// apply writes through the shared split helpers and the batch owner, then
// verifies the live children match the plan and still sum to the parent.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { q } from '#shared/query';
import {
  updateTransaction as sharedUpdateTransaction,
  ungroupTransactions,
} from '#shared/transactions';
import type {
  TransactionSplitProposal,
  TransactionSplitRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

import { batchUpdateTransactions } from '.';

export const SPLIT_CHILD_LIMIT = 100;

type RawTransaction = {
  id: string;
  acct: string;
  amount: number;
  category: string | null;
  description: string | null;
  isParent: number;
  isChild: number;
  parent_id: string | null;
  transferred_id: string | null;
  reconciled: number;
  tombstone: number;
  error: string | null;
};

const CHILD_KEYS = ['amount', 'category', 'notes', 'payee'];

function raw(id: string) {
  return db.first<RawTransaction>('SELECT * FROM transactions WHERE id = ?', [
    id,
  ]);
}

function liveChildren(parentId: string) {
  return db.all<RawTransaction>(
    'SELECT * FROM transactions WHERE parent_id = ? AND isChild = 1 AND tombstone = 0 ORDER BY id',
    [parentId],
  );
}

function invalid(message: string): never {
  throw APIError(`Invalid split request: ${message}`);
}

export async function prepareTransactionSplit(
  request: TransactionSplitRequest,
): Promise<TransactionSplitProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['id', 'subtransactions', 'allowReconciled'].includes(key),
    ) ||
    typeof request.id !== 'string' ||
    !request.id
  ) {
    invalid('provide id, subtransactions and optional allowReconciled');
  }
  const { subtransactions } = request;
  if (
    !Array.isArray(subtransactions) ||
    !subtransactions.length ||
    subtransactions.length > SPLIT_CHILD_LIMIT
  ) {
    invalid(`provide 1 to ${SPLIT_CHILD_LIMIT} subtransactions`);
  }
  if (
    request.allowReconciled !== undefined &&
    typeof request.allowReconciled !== 'boolean'
  ) {
    invalid('allowReconciled must be a boolean');
  }
  const target = await raw(request.id);
  if (!target || target.tombstone) {
    throw APIError(`Transaction does not exist: ${request.id}`);
  }
  if (target.isChild) {
    throw APIError(
      `Transaction ${request.id} is a split child; edit its parent instead`,
    );
  }
  if (target.transferred_id) {
    throw APIError(
      `Transaction ${request.id} is a transfer; split transfers through the client`,
    );
  }
  if (target.reconciled && !request.allowReconciled) {
    throw APIError(
      `Transaction ${request.id} is reconciled; pass allowReconciled to split it`,
    );
  }
  const account = await db.first<{ offbudget: number }>(
    'SELECT offbudget FROM accounts WHERE id = ?',
    [target.acct],
  );
  const children: TransactionSplitProposal['after']['children'] = [];
  for (const [index, child] of subtransactions.entries()) {
    if (
      typeof child !== 'object' ||
      child === null ||
      Object.keys(child).some(key => !CHILD_KEYS.includes(key)) ||
      !Number.isSafeInteger(child.amount)
    ) {
      invalid(
        `subtransaction ${index} needs an integer amount and only category, notes or payee`,
      );
    }
    const category = child.category ?? null;
    if (category !== null) {
      if (typeof category !== 'string') {
        invalid(`subtransaction ${index} category must be an ID or null`);
      }
      if (account?.offbudget) {
        throw APIError(
          'Off-budget transactions are not categorized; omit split categories',
        );
      }
      const found = await db.first<{ tombstone: number }>(
        'SELECT tombstone FROM categories WHERE id = ?',
        [category],
      );
      if (!found || found.tombstone) {
        throw APIError(`Category does not exist: ${category}`);
      }
    }
    const payee = child.payee ?? target.description ?? null;
    if (child.payee !== undefined && child.payee !== null) {
      if (typeof child.payee !== 'string') {
        invalid(`subtransaction ${index} payee must be an ID or null`);
      }
      const found = await db.first<{ tombstone: number }>(
        'SELECT tombstone FROM payees WHERE id = ?',
        [child.payee],
      );
      if (!found || found.tombstone) {
        throw APIError(`Payee does not exist: ${child.payee}`);
      }
    }
    if (child.notes !== undefined && child.notes !== null) {
      if (typeof child.notes !== 'string') {
        invalid(`subtransaction ${index} notes must be text or null`);
      }
    }
    children.push({
      amount: child.amount,
      category,
      notes: child.notes ?? null,
      payee,
    });
  }
  const total = children.reduce((sum, child) => sum + child.amount, 0);
  if (total !== target.amount) {
    throw APIError(
      `Split amounts sum to ${total} but the transaction amount is ${target.amount}`,
    );
  }
  const previous = target.isParent ? await liveChildren(target.id) : [];
  return {
    schemaVersion: 1,
    operation: 'transactions.split',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transaction: {
        id: target.id,
        account: target.acct,
        amount: target.amount,
        category: target.category,
        isParent: target.isParent === 1,
        reconciled: target.reconciled === 1,
      },
      children: previous.map(row => ({
        id: row.id,
        amount: row.amount,
        category: row.category,
      })),
    },
    after: {
      amount: target.amount,
      children,
      removedChildIds: previous.map(row => row.id),
    },
    references: {},
    sideEffects: [
      `${target.isParent ? 'replace the split children of' : 'split'} the transaction into ${children.length} child row(s) through the shared split helpers and the canonical batch owner; the parent amount, date, account and cleared flag are unchanged, the parent category is cleared, and rules are not rerun`,
    ],
  };
}

export async function performTransactionSplit(
  current: TransactionSplitProposal,
) {
  const id = current.request.id;
  const { data } = await aqlQuery(
    q('transactions').filter({ id }).select('*').options({ splits: 'grouped' }),
  );
  const ungrouped = ungroupTransactions(data as TransactionEntity[]);
  const parent = (data as TransactionEntity[])[0];
  if (!parent) {
    throw new Error('Split target disappeared before the engine write');
  }
  const { diff } = sharedUpdateTransaction(ungrouped, {
    ...parent,
    category: null,
    is_parent: true,
    subtransactions: current.after.children.map((child, index) => ({
      amount: child.amount,
      category: child.category,
      notes: child.notes,
      payee: child.payee,
      sort_order: -(index + 1),
    })) as TransactionEntity[],
  });
  await batchUpdateTransactions(diff);

  const incomplete = () => {
    throw new Error('Split acknowledgement is incomplete');
  };
  const after = await raw(id);
  if (!after || after.tombstone || after.isParent !== 1) incomplete();
  if (after?.amount !== current.after.amount) incomplete();
  const kids = await liveChildren(id);
  const planned = current.after.children
    .map(child => `${child.amount}:${child.category}`)
    .sort();
  const actual = kids.map(row => `${row.amount}:${row.category}`).sort();
  if (JSON.stringify(planned) !== JSON.stringify(actual)) incomplete();
  for (const removed of current.after.removedChildIds) {
    const row = await raw(removed);
    if (row && !row.tombstone && row.parent_id === id) incomplete();
  }
  const childIds = kids.map(row => row.id);
  return {
    changed: true,
    affectedIds: [id, ...childIds, ...current.after.removedChildIds],
    transactionSplit: { childIds },
  };
}
