// Guarded transaction imports. The plan runs the same matching and
// reconciliation as importTransactions without writing, then projects away
// generated ids, sort orders and new payee ids so preview and apply compare
// deterministically. Apply calls the canonical owner and verifies the result.
import {
  PAYEE_NAME_NORMALIZATIONS,
  planReconciledTransactions,
  reconcileTransactions,
} from '#server/accounts/sync';
import type { ReconcileTransactionsOptions } from '#server/accounts/sync';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError, TransactionError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { canonicalJson } from '#shared/canonical-json';
import { q } from '#shared/query';
import type {
  TransactionImportProposal,
  TransactionImportRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

import { projectAddedTransaction } from './guarded-add';

const UPDATE_FIELDS = [
  'imported_id',
  'payee',
  'category',
  'imported_payee',
  'notes',
  'cleared',
  'date',
] as const;

type Row = Record<string, unknown>;

function options(
  request: TransactionImportRequest,
): ReconcileTransactionsOptions {
  const opts = request.opts ?? {};
  return {
    defaultCleared: opts.defaultCleared,
    reimportDeleted: opts.reimportDeleted,
    payeeNameNormalization: opts.payeeNameNormalization ?? 'title-case',
  };
}

function payeeRef(payee: unknown, newPayees: Map<string, string>) {
  return typeof payee === 'string' && newPayees.has(payee)
    ? { newPayee: newPayees.get(payee) }
    : (payee ?? null);
}

function projectUpdate(update: Row, newPayees: Map<string, string>): Row {
  const out: Row = { id: update.id };
  for (const key of UPDATE_FIELDS) {
    if (!(key in update)) continue;
    const value = update[key];
    out[key] =
      key === 'payee'
        ? payeeRef(value, newPayees)
        : key === 'cleared'
          ? Boolean(value)
          : (value ?? null);
  }
  return out;
}

function byId(a: Row, b: Row) {
  return String(a.id).localeCompare(String(b.id));
}

export async function planTransactionImport(request: TransactionImportRequest) {
  const { added, updated, payeesToCreate } = await planReconciledTransactions(
    request.accountId,
    structuredClone(request.transactions),
    { ...options(request), isPreview: true },
  );
  const newPayees = new Map<string, string>();
  for (const payee of payeesToCreate.values()) {
    newPayees.set(payee.id, payee.name);
  }
  const ids = added.map(row => row.id);
  return {
    added: added.map(row =>
      projectAddedTransaction(
        row,
        payeeRef(row.payee, newPayees),
        row.parent_id ? ids.indexOf(row.parent_id) : null,
      ),
    ),
    updated: (updated as Row[])
      .map(row => projectUpdate(row, newPayees))
      .sort(byId),
  };
}

export async function prepareTransactionImport(
  request: TransactionImportRequest,
): Promise<TransactionImportProposal> {
  const opts = request?.opts;
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['accountId', 'transactions', 'opts'].includes(key),
    ) ||
    typeof request.accountId !== 'string' ||
    !Array.isArray(request.transactions) ||
    !request.transactions.length ||
    request.transactions.some(
      row => typeof row !== 'object' || row === null || Array.isArray(row),
    ) ||
    (opts !== undefined &&
      (typeof opts !== 'object' ||
        opts === null ||
        Object.keys(opts).some(
          key =>
            ![
              'defaultCleared',
              'reimportDeleted',
              'payeeNameNormalization',
            ].includes(key),
        ) ||
        (opts.defaultCleared !== undefined &&
          typeof opts.defaultCleared !== 'boolean') ||
        (opts.reimportDeleted !== undefined &&
          typeof opts.reimportDeleted !== 'boolean') ||
        (opts.payeeNameNormalization !== undefined &&
          !PAYEE_NAME_NORMALIZATIONS.includes(opts.payeeNameNormalization))))
  ) {
    throw APIError(
      'Invalid transaction import request: provide accountId, a non-empty transactions array and optional defaultCleared, reimportDeleted and payeeNameNormalization options',
    );
  }
  const account = await db.first<{ closed: number }>(
    'SELECT closed FROM accounts WHERE id = ? AND tombstone = 0',
    [request.accountId],
  );
  if (!account || account.closed) {
    throw APIError(
      'Transactions can only be imported into a live open account',
    );
  }
  let planned;
  try {
    planned = await planTransactionImport(request);
  } catch (error) {
    if (error instanceof TransactionError || error instanceof Error) {
      throw APIError(error.message);
    }
    throw error;
  }
  return {
    schemaVersion: 1,
    operation: 'transactions.import',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash() },
    after: planned,
    references: {},
    sideEffects: [
      'reconcile the transactions through the canonical import owner: matched rows are updated, unmatched rows are inserted after running rules, and payees that do not exist are created',
    ],
  };
}

async function readRows(ids: string[]) {
  if (!ids.length) return new Map<string, TransactionEntity>();
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids } })
      .select('*')
      .options({ splits: 'all' }),
  );
  return new Map((data as TransactionEntity[]).map(row => [row.id, row]));
}

export async function performTransactionImport(
  current: TransactionImportProposal,
) {
  const before = new Set(
    (await db.all<{ id: string }>('SELECT id FROM payees')).map(row => row.id),
  );
  const result = await reconcileTransactions(
    current.request.accountId,
    structuredClone(current.request.transactions),
    options(current.request),
  );
  const newPayees = new Map<string, string>();
  const rows = await readRows([...result.added, ...result.updated]);
  for (const row of rows.values()) {
    if (row.payee && !before.has(row.payee) && !newPayees.has(row.payee)) {
      const created = await db.first<{ name: string }>(
        'SELECT name FROM payees WHERE id = ?',
        [row.payee],
      );
      newPayees.set(row.payee, created?.name ?? '');
    }
  }
  const added: Row[] = [];
  for (const id of result.added) {
    const row = rows.get(id);
    if (!row) {
      throw new Error('Transaction import acknowledgement is incomplete');
    }
    added.push(
      projectAddedTransaction(
        row,
        payeeRef(row.payee, newPayees),
        row.parent_id ? result.added.indexOf(row.parent_id) : null,
      ),
    );
  }
  const updated: Row[] = [];
  for (const planned of current.after.updated) {
    const row = rows.get(String(planned.id));
    if (!row) {
      throw new Error('Transaction import acknowledgement is incomplete');
    }
    const actual: Row = { id: row.id };
    for (const key of Object.keys(planned)) {
      if (key === 'id') continue;
      const value = row[key as keyof TransactionEntity];
      actual[key] =
        key === 'payee'
          ? payeeRef(value, newPayees)
          : key === 'cleared'
            ? Boolean(value)
            : (value ?? null);
    }
    updated.push(actual);
  }
  if (
    canonicalJson(added) !== canonicalJson(current.after.added) ||
    canonicalJson(updated) !== canonicalJson(current.after.updated) ||
    canonicalJson([...result.updated].sort()) !==
      canonicalJson(current.after.updated.map(row => String(row.id)).sort())
  ) {
    throw new Error('Transaction import acknowledgement does not match');
  }
  return {
    changed: result.added.length + result.updated.length > 0,
    affectedIds: [...result.added, ...result.updated],
    transactionImport: {
      addedIds: result.added,
      updatedIds: result.updated,
    },
  };
}
