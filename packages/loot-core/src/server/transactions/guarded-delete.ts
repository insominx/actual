// Read-only plan and canonical writer for guarded transaction deletion. The
// plan names every row the batch owner and transfer cascade will tombstone or
// unlink, so apply can verify the exact raw outcome.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import type {
  TransactionDeletionProposal,
  TransactionDeletionRequest,
} from '#types/change-proposals';

import { batchUpdateTransactions } from '.';

type RawTransaction = {
  id: string;
  isParent: number;
  isChild: number;
  parent_id: string | null;
  transferred_id: string | null;
  tombstone: number;
};

function raw(id: string) {
  return db.first<RawTransaction>('SELECT * FROM transactions WHERE id = ?', [
    id,
  ]);
}

export async function prepareTransactionDeletion(
  request: TransactionDeletionRequest,
): Promise<TransactionDeletionProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(key => key !== 'id') ||
    typeof request.id !== 'string' ||
    !request.id
  ) {
    throw APIError('Invalid transaction deletion request: provide an id');
  }
  const target = await raw(request.id);
  if (!target || target.tombstone) {
    throw APIError(`Transaction does not exist: ${request.id}`);
  }
  if (target.isChild) {
    throw APIError(
      'Deleting one split child recalculates its parent; edit the split through transactions.update instead',
    );
  }
  // Same expansion as the batch owner: the target and its live children.
  const children = await db.all<{ id: string }>(
    'SELECT id FROM v_transactions_internal WHERE parent_id = ? ORDER BY id',
    [request.id],
  );
  const deletedIds = [request.id, ...children.map(row => row.id)].sort();
  const transferDeletedIds: string[] = [];
  const transferUnlinkedIds: string[] = [];
  for (const id of deletedIds) {
    const row = await raw(id);
    if (!row?.transferred_id || deletedIds.includes(row.transferred_id)) {
      continue;
    }
    const counterpart = await raw(row.transferred_id);
    if (!counterpart || counterpart.tombstone) {
      continue;
    }
    (counterpart.isChild ? transferUnlinkedIds : transferDeletedIds).push(
      counterpart.id,
    );
  }
  return {
    schemaVersion: 1,
    operation: 'transactions.delete',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transaction: { ...target },
    },
    after: {
      deletedIds,
      transferDeletedIds: transferDeletedIds.sort(),
      transferUnlinkedIds: transferUnlinkedIds.sort(),
    },
    references: {},
    sideEffects: [
      'tombstone the transaction and its split children through the canonical batch owner; linked transfer counterparts are deleted, or unlinked when they are split children; allocations and other ledger rows are unchanged',
    ],
  };
}

export async function performTransactionDeletion(
  current: TransactionDeletionProposal,
) {
  await batchUpdateTransactions({ deleted: [{ id: current.request.id }] });
  const { deletedIds, transferDeletedIds, transferUnlinkedIds } = current.after;
  for (const id of [...deletedIds, ...transferDeletedIds]) {
    if ((await raw(id))?.tombstone !== 1) {
      throw new Error('Transaction deletion acknowledgement is incomplete');
    }
  }
  for (const id of transferUnlinkedIds) {
    const row = await raw(id);
    if (!row || row.tombstone || row.transferred_id !== null) {
      throw new Error('Transfer unlink acknowledgement is incomplete');
    }
  }
  return {
    changed: true,
    affectedIds: [...deletedIds, ...transferDeletedIds, ...transferUnlinkedIds],
  };
}
