// Read-only plan and canonical writer for a guarded duplicate merge. The plan
// names the kept and dropped transactions (chosen by the engine's own rule),
// the split children that move or are deleted, and any transfer counterparts
// merged alongside, so apply can verify the exact outcome.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { validForMergeExplanation } from '#shared/merge';
import type {
  TransactionMergeProposal,
  TransactionMergeRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

import { determineKeepDrop, mergeTransactions } from './merge';

type RawRow = { id: string; tombstone: number; parent_id: string | null };

async function live(id: string) {
  const row = (await db.getTransaction(id)) as TransactionEntity | undefined;
  if (!row || row.tombstone) {
    throw APIError(`Transaction does not exist: ${id}`);
  }
  return row;
}

async function childIds(parentId: string) {
  const rows = await db.all<{ id: string }>(
    'SELECT id FROM v_transactions_internal WHERE parent_id = ? ORDER BY id',
    [parentId],
  );
  return rows.map(row => row.id);
}

function summary(row: TransactionEntity) {
  return {
    id: row.id,
    account: row.account,
    date: row.date,
    amount: row.amount,
    payee: row.payee ?? null,
    category: row.category ?? null,
    notes: row.notes ?? null,
    cleared: !!row.cleared,
    reconciled: !!row.reconciled,
    importedId: row.imported_id ?? null,
    transferId: row.transfer_id ?? null,
    isParent: !!row.is_parent,
  };
}

export async function prepareTransactionMerge(
  request: TransactionMergeRequest,
): Promise<TransactionMergeProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['ids', 'allowReconciled'].includes(key),
    ) ||
    !Array.isArray(request.ids) ||
    request.ids.length !== 2 ||
    !request.ids.every(id => typeof id === 'string' && id.length > 0) ||
    request.ids[0] === request.ids[1] ||
    (request.allowReconciled !== undefined &&
      typeof request.allowReconciled !== 'boolean')
  ) {
    throw APIError(
      'Invalid transaction merge request: provide two distinct ids and optional allowReconciled',
    );
  }
  const [a, b] = await Promise.all(request.ids.map(live));
  for (const row of [a, b]) {
    if (row.is_child) {
      throw APIError(
        `Transaction ${row.id} is a split child; merge whole transactions only`,
      );
    }
    if (row.reconciled && !request.allowReconciled) {
      throw APIError(
        `Transaction ${row.id} is reconciled; pass allowReconciled to merge it`,
      );
    }
  }
  const explanation = validForMergeExplanation(a, b);
  if (explanation) throw APIError(explanation);
  const { keep, drop } = determineKeepDrop(a, b);
  const keepChildren = keep.is_parent ? await childIds(keep.id) : [];
  const dropChildren = drop.is_parent ? await childIds(drop.id) : [];
  const movedChildIds = keepChildren.length ? [] : dropChildren;
  const deletedChildIds = keepChildren.length ? dropChildren : [];
  // Both transfers: the counterparts are merged by the same rule.
  let transfer: { keepId: string; dropId: string } | null = null;
  if (keep.transfer_id && drop.transfer_id) {
    const [ka, kb] = await Promise.all([
      live(keep.transfer_id),
      live(drop.transfer_id),
    ]);
    const counterpart = determineKeepDrop(ka, kb);
    transfer = { keepId: counterpart.keep.id, dropId: counterpart.drop.id };
  }
  return {
    schemaVersion: 1,
    operation: 'transactions.merge',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transactions: [summary(keep), summary(drop)],
    },
    after: {
      keepId: keep.id,
      dropId: drop.id,
      movedChildIds,
      deletedChildIds,
      transfer,
    },
    references: {},
    sideEffects: [
      'keep the engine-chosen transaction (imported over manual, then the earlier date), fill its empty payee, category, notes and schedule from the dropped one, and tombstone the dropped transaction through the canonical merge owner',
      ...(movedChildIds.length
        ? ['move the dropped split children to the kept transaction']
        : []),
      ...(deletedChildIds.length
        ? ['delete the dropped split children; the kept split is unchanged']
        : []),
      ...(transfer
        ? ['merge the two transfer counterparts by the same rule']
        : []),
    ],
  };
}

async function raw(id: string) {
  return db.first<RawRow>(
    'SELECT id, tombstone, parent_id FROM transactions WHERE id = ?',
    [id],
  );
}

export async function performTransactionMerge(
  current: TransactionMergeProposal,
) {
  const { keepId, dropId, movedChildIds, deletedChildIds, transfer } =
    current.after;
  const kept = await mergeTransactions(current.request.ids.map(id => ({ id })));
  const incomplete = () => {
    throw new Error('Transaction merge acknowledgement is incomplete');
  };
  if (kept !== keepId) incomplete();
  if ((await raw(keepId))?.tombstone !== 0) incomplete();
  if ((await raw(dropId))?.tombstone !== 1) incomplete();
  for (const id of movedChildIds) {
    const row = await raw(id);
    if (!row || row.tombstone || row.parent_id !== keepId) incomplete();
  }
  for (const id of deletedChildIds) {
    if ((await raw(id))?.tombstone !== 1) incomplete();
  }
  if (transfer) {
    if ((await raw(transfer.dropId))?.tombstone !== 1) incomplete();
    if ((await raw(transfer.keepId))?.tombstone !== 0) incomplete();
  }
  return {
    changed: true,
    affectedIds: [
      keepId,
      dropId,
      ...movedChildIds,
      ...deletedChildIds,
      ...(transfer ? [transfer.keepId, transfer.dropId] : []),
    ],
    transactionMerge: { keptId: keepId },
  };
}
