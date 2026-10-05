// Read-only plans and canonical writers for guarded payee updates, deletions
// and merges. Plans read raw rows only; writers call the existing db owners and
// verify the raw rows they promised.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  PayeeDeletionProposal,
  PayeeDeletionRequest,
  PayeeMergeProposal,
  PayeeMergeRequest,
  PayeeUpdateProposal,
  PayeeUpdateRequest,
} from '#types/change-proposals';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function livePayee(id: string, label: string) {
  const row = await db.first<db.DbPayee>('SELECT * FROM payees WHERE id = ?', [
    id,
  ]);
  if (!row || row.tombstone) {
    throw APIError(`${label} payee does not exist: ${id}`);
  }
  return row;
}

async function referencingTransactions(ids: string[]) {
  if (!ids.length) {
    return 0;
  }
  const row = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM transactions
     WHERE tombstone = 0 AND description IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return row?.count ?? 0;
}

export async function preparePayeeUpdate(
  request: PayeeUpdateRequest,
): Promise<PayeeUpdateProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !isId(request.id) ||
    !isRecord(request.fields) ||
    Object.keys(request.fields).some(key => key !== 'name') ||
    typeof request.fields.name !== 'string' ||
    !request.fields.name.trim()
  ) {
    throw APIError(
      'Invalid payee update request: provide an id and a non-empty name',
    );
  }
  const payee = await livePayee(request.id, 'Update');
  if (payee.transfer_acct != null) {
    throw APIError(
      'Transfer payees take their name from the account; rename the account',
    );
  }
  return {
    schemaVersion: 1,
    operation: 'payees.update',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), payee: { ...payee } },
    after: { payee: { ...payee, name: request.fields.name } },
    references: {},
    sideEffects: [
      'rename one payee through the canonical owner; transactions, mappings, rules and schedules keep referencing the same payee id',
    ],
  };
}

export async function performPayeeUpdate(current: PayeeUpdateProposal) {
  await db.updatePayee({
    id: current.request.id,
    name: current.request.fields.name,
  });
  const actual = await db.first<db.DbPayee>(
    'SELECT * FROM payees WHERE id = ?',
    [current.request.id],
  );
  if (!rowMatches(actual, current.after.payee)) {
    throw new Error('Payee update acknowledgement is incomplete');
  }
  return {
    changed: current.before.payee.name !== current.request.fields.name,
    affectedIds: [current.request.id],
  };
}

export async function preparePayeeDeletion(
  request: PayeeDeletionRequest,
): Promise<PayeeDeletionProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => key !== 'id') ||
    !isId(request.id)
  ) {
    throw APIError('Invalid payee deletion request: provide an id');
  }
  const payee = await livePayee(request.id, 'Deleted');
  const transfer = payee.transfer_acct != null;
  return {
    schemaVersion: 1,
    operation: 'payees.delete',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), payee: { ...payee } },
    after: { action: transfer ? 'unchanged-transfer-payee' : 'tombstone' },
    references: {
      referencingTransactions: await referencingTransactions([request.id]),
    },
    sideEffects: [
      transfer
        ? 'transfer payees are never deleted; the canonical owner leaves the budget unchanged'
        : 'tombstone one payee through the canonical owner; transactions, mappings, rules and schedules that reference it are left unchanged',
    ],
  };
}

export async function performPayeeDeletion(current: PayeeDeletionProposal) {
  if (current.after.action === 'unchanged-transfer-payee') {
    return { changed: false, affectedIds: [] };
  }
  await db.deletePayee({ id: current.request.id });
  const actual = await db.first<db.DbPayee>(
    'SELECT * FROM payees WHERE id = ?',
    [current.request.id],
  );
  if (!actual || actual.tombstone !== 1) {
    throw new Error('Payee deletion acknowledgement is incomplete');
  }
  return { changed: true, affectedIds: [current.request.id] };
}

export async function preparePayeeMerge(
  request: PayeeMergeRequest,
): Promise<PayeeMergeProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !['targetId', 'mergeIds'].includes(key)) ||
    !isId(request.targetId) ||
    !Array.isArray(request.mergeIds) ||
    !request.mergeIds.length ||
    !request.mergeIds.every(isId) ||
    new Set(request.mergeIds).size !== request.mergeIds.length ||
    request.mergeIds.includes(request.targetId)
  ) {
    throw APIError(
      'Invalid payee merge request: provide a target and unique source ids that exclude the target',
    );
  }
  const target = await livePayee(request.targetId, 'Merge target');
  const sources: db.DbPayee[] = [];
  for (const id of request.mergeIds) {
    sources.push(await livePayee(id, 'Merge source'));
  }
  const transferTarget = target.transfer_acct != null;
  const skippedTransferIds = transferTarget
    ? []
    : sources.filter(row => row.transfer_acct != null).map(row => row.id);
  const mergedIds = transferTarget
    ? []
    : sources.filter(row => row.transfer_acct == null).map(row => row.id);
  const mappings: Array<{ id: string; targetId: string }> = [];
  for (const id of mergedIds) {
    const rows = await db.all<db.DbPayeeMapping>(
      'SELECT id FROM payee_mapping WHERE targetId = ? ORDER BY id',
      [id],
    );
    for (const row of rows) {
      mappings.push({ id: row.id, targetId: request.targetId });
    }
    if (!rows.some(row => row.id === id)) {
      mappings.push({ id, targetId: request.targetId });
    }
  }
  mappings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schemaVersion: 1,
    operation: 'payees.merge',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      target: { ...target },
      sources: sources.map(row => ({ ...row })),
    },
    after: {
      action: transferTarget ? 'unchanged-transfer-target' : 'merge',
      mergedIds,
      skippedTransferIds,
      mappings,
    },
    references: {
      referencingTransactions: await referencingTransactions(mergedIds),
    },
    sideEffects: [
      transferTarget
        ? 'a transfer payee cannot be a merge target; the canonical owner leaves the budget unchanged'
        : 'remap every payee mapping of the merged payees to the target and tombstone the merged payees through the canonical owner; transfer payees among the sources are skipped; transaction rows keep their stored payee ids and resolve through the mappings',
    ],
  };
}

export async function performPayeeMerge(current: PayeeMergeProposal) {
  const { targetId } = current.request;
  const { mergedIds, mappings } = current.after;
  if (!mergedIds.length) {
    return {
      changed: false,
      affectedIds: [],
      payeeMerge: { targetId, mergedIds },
    };
  }
  await db.mergePayees(targetId, current.request.mergeIds);
  for (const id of mergedIds) {
    const row = await db.first<db.DbPayee>(
      'SELECT * FROM payees WHERE id = ?',
      [id],
    );
    if (!row || row.tombstone !== 1) {
      throw new Error('Payee merge source acknowledgement is incomplete');
    }
  }
  for (const mapping of mappings) {
    const row = await db.first<db.DbPayeeMapping>(
      'SELECT * FROM payee_mapping WHERE id = ?',
      [mapping.id],
    );
    if (!rowMatches(row, mapping)) {
      throw new Error('Payee merge mapping acknowledgement is incomplete');
    }
  }
  const target = await db.first<db.DbPayee>(
    'SELECT * FROM payees WHERE id = ?',
    [targetId],
  );
  if (!target || target.tombstone) {
    throw new Error('Payee merge target acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [targetId, ...mergedIds],
    payeeMerge: { targetId, mergedIds },
  };
}
