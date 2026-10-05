// Guarded transaction additions. The plan runs the same normalization, rules
// and split expansion as addTransactions, then projects away generated ids and
// sort orders so preview and apply compare deterministically. Apply calls the
// canonical owner and verifies every inserted row against the projection.
import { addTransactions, planAddedTransactions } from '#server/accounts/sync';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { canonicalJson } from '#shared/canonical-json';
import { q } from '#shared/query';
import type {
  TransactionAdditionProposal,
  TransactionAdditionRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

const PROJECTED = [
  'account',
  'date',
  'amount',
  'notes',
  'category',
  'cleared',
  'reconciled',
  'imported_id',
  'imported_payee',
  'is_parent',
  'is_child',
] as const;

type PlannedRow = Record<string, unknown>;

function project(
  row: Partial<TransactionEntity>,
  payee: unknown,
  parentIndex: number | null,
): PlannedRow {
  const out: PlannedRow = { payee, parentIndex };
  for (const key of PROJECTED) {
    const value = row[key];
    out[key] =
      value === undefined
        ? null
        : key === 'cleared' || key === 'reconciled' || key.startsWith('is_')
          ? Boolean(value)
          : value;
  }
  return out;
}

async function plan(request: TransactionAdditionRequest) {
  const { added, payeesToCreate } = await planAddedTransactions(
    request.accountId,
    structuredClone(request.transactions),
  );
  const newPayees = new Map<string, string>();
  for (const payee of payeesToCreate.values()) {
    newPayees.set(payee.id, payee.name);
  }
  const ids = added.map(row => row.id);
  const rows = added.map(row =>
    project(
      row,
      newPayees.has(row.payee)
        ? { newPayee: newPayees.get(row.payee) }
        : (row.payee ?? null),
      row.parent_id ? ids.indexOf(row.parent_id) : null,
    ),
  );
  return { rows };
}

export async function prepareTransactionAddition(
  request: TransactionAdditionRequest,
): Promise<TransactionAdditionProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['accountId', 'transactions'].includes(key),
    ) ||
    typeof request.accountId !== 'string' ||
    !Array.isArray(request.transactions) ||
    !request.transactions.length ||
    request.transactions.some(
      row => typeof row !== 'object' || row === null || Array.isArray(row),
    )
  ) {
    throw APIError(
      'Invalid transaction addition request: provide accountId and a non-empty transactions array',
    );
  }
  const account = await db.first<{ closed: number }>(
    'SELECT closed FROM accounts WHERE id = ? AND tombstone = 0',
    [request.accountId],
  );
  if (!account || account.closed) {
    throw APIError('Transactions can only be added to a live open account');
  }
  let planned;
  try {
    planned = await plan(request);
  } catch (error) {
    throw APIError(
      error instanceof Error ? error.message : 'Invalid transactions',
    );
  }
  return {
    schemaVersion: 1,
    operation: 'transactions.add',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash() },
    after: planned,
    references: {},
    sideEffects: [
      'insert the planned transactions through the canonical addTransactions owner after running rules; payees named by payee_name that do not exist are created; transfers are not run and categories are not learned',
    ],
  };
}

export async function performTransactionAddition(
  current: TransactionAdditionProposal,
) {
  const before = new Set(
    (await db.all<{ id: string }>('SELECT id FROM payees')).map(row => row.id),
  );
  const ids =
    (await addTransactions(
      current.request.accountId,
      structuredClone(current.request.transactions),
      { runTransfers: false, learnCategories: false },
    )) ?? [];
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids } })
      .select('*')
      .options({ splits: 'all' }),
  );
  const byId = new Map((data as TransactionEntity[]).map(row => [row.id, row]));
  const actual: PlannedRow[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      throw new Error('Transaction addition acknowledgement is incomplete');
    }
    let payee: unknown = row.payee ?? null;
    if (row.payee && !before.has(row.payee)) {
      const created = await db.first<{ name: string }>(
        'SELECT name FROM payees WHERE id = ?',
        [row.payee],
      );
      payee = { newPayee: created?.name };
    }
    actual.push(
      project(row, payee, row.parent_id ? ids.indexOf(row.parent_id) : null),
    );
  }
  if (canonicalJson(actual) !== canonicalJson(current.after.rows)) {
    throw new Error('Transaction addition acknowledgement does not match');
  }
  return {
    changed: true,
    affectedIds: ids,
    transactionAddition: { transactionIds: ids },
  };
}
