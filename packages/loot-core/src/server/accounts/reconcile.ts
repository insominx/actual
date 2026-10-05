// Statement reconciliation for agents, owned by core. The status read uses
// the same cleared-balance definition as the app's reconcile bar (sum of
// cleared top-level transactions), optionally cut off at a statement date.
// Finishing locks exactly the frozen set of cleared, unreconciled
// transactions (split children with their parent) when the difference is
// zero, and stamps last_reconciled as the app does. Adjustments are a
// separate explicit proposal; nothing here invents a transaction to force a
// match. Unlocking stays with the guarded `transactions.clear` unlock.
import { addTransactions, planAddedTransactions } from '#server/accounts/sync';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { batchUpdateTransactions } from '#server/transactions';
import { projectAddedTransaction } from '#server/transactions/guarded-add';
import { canonicalJson } from '#shared/canonical-json';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import type {
  ReconcileAdjustProposal,
  ReconcileAdjustRequest,
  ReconcileFinishProposal,
  ReconcileFinishRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ADJUSTMENT_NOTE = 'Reconciliation balance adjustment';

export type ReconciliationStatusRequest = {
  accountId: string;
  statementBalance?: number;
  statementDate?: string;
};

export type ReconciliationStatus = {
  account: {
    id: string;
    name: string;
    closed: boolean;
    lastReconciled: string | null;
  };
  statementDate: string | null;
  statementBalance: number | null;
  clearedBalance: number;
  reconciledBalance: number;
  difference: number | null;
  candidateIds: string[];
  unclearedCount: number;
  clearedAfterCutoffCount: number;
  canFinish: boolean;
};

function invalid(noun: string, message: string): never {
  throw APIError(`Invalid ${noun} request: ${message}`);
}

async function account(id: string) {
  const row = await db.first<{
    id: string;
    name: string;
    closed: number;
    last_reconciled: string | null;
  }>(
    'SELECT id, name, closed, last_reconciled FROM accounts WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!row) throw APIError(`Account does not exist: ${id}`);
  return row;
}

function iso(lastReconciled: string | null) {
  if (!lastReconciled) return null;
  const ms = Number(lastReconciled);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : lastReconciled;
}

export async function reconciliationStatus(
  request: ReconciliationStatusRequest,
): Promise<ReconciliationStatus> {
  const noun = 'reconciliation status';
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['accountId', 'statementBalance', 'statementDate'].includes(key),
    )
  ) {
    invalid(
      noun,
      'provide accountId and optional statementBalance, statementDate',
    );
  }
  if (typeof request.accountId !== 'string' || !request.accountId) {
    invalid(noun, 'accountId is required');
  }
  if (
    request.statementBalance !== undefined &&
    !Number.isSafeInteger(request.statementBalance)
  ) {
    invalid(noun, 'statementBalance must be integer cents');
  }
  if (
    request.statementDate !== undefined &&
    (typeof request.statementDate !== 'string' ||
      !DATE.test(request.statementDate))
  ) {
    invalid(noun, 'statementDate must be YYYY-MM-DD');
  }
  const acct = await account(request.accountId);
  const cutoff =
    request.statementDate === undefined
      ? null
      : db.toDateRepr(request.statementDate);
  const dateClause = cutoff === null ? '' : ' AND date <= ?';
  const params = (): Array<string | number> =>
    cutoff === null ? [request.accountId] : [request.accountId, cutoff];
  const sum = async (where: string) =>
    (
      await db.first<{ total: number | null }>(
        `SELECT SUM(amount) AS total FROM v_transactions WHERE account = ? AND is_child = 0 AND ${where}${dateClause}`,
        params(),
      )
    )?.total ?? 0;
  const clearedBalance = await sum('cleared = 1');
  const reconciledBalance = await sum('reconciled = 1');
  const candidateIds = (
    await db.all<{ id: string }>(
      `SELECT id FROM v_transactions WHERE account = ? AND is_child = 0 AND cleared = 1 AND reconciled = 0${dateClause} ORDER BY date, id`,
      params(),
    )
  ).map(row => row.id);
  const unclearedCount =
    (
      await db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM v_transactions WHERE account = ? AND is_child = 0 AND cleared = 0${dateClause}`,
        params(),
      )
    )?.n ?? 0;
  const clearedAfterCutoffCount =
    cutoff === null
      ? 0
      : ((
          await db.first<{ n: number }>(
            'SELECT COUNT(*) AS n FROM v_transactions WHERE account = ? AND is_child = 0 AND cleared = 1 AND reconciled = 0 AND date > ?',
            [request.accountId, cutoff],
          )
        )?.n ?? 0);
  const difference =
    request.statementBalance === undefined
      ? null
      : request.statementBalance - clearedBalance;
  return {
    account: {
      id: acct.id,
      name: acct.name,
      closed: Boolean(acct.closed),
      lastReconciled: iso(acct.last_reconciled),
    },
    statementDate: request.statementDate ?? null,
    statementBalance: request.statementBalance ?? null,
    clearedBalance,
    reconciledBalance,
    difference,
    candidateIds,
    unclearedCount,
    clearedAfterCutoffCount,
    canFinish: difference === 0 && !acct.closed,
  };
}

export async function prepareReconcileFinish(
  request: ReconcileFinishRequest,
): Promise<ReconcileFinishProposal> {
  const noun = 'reconciliation finish';
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key =>
        !['accountId', 'statementBalance', 'statementDate', 'ids'].includes(
          key,
        ),
    )
  ) {
    invalid(
      noun,
      'provide accountId, statementBalance, ids and optional statementDate',
    );
  }
  if (request.statementBalance === undefined) {
    invalid(noun, 'statementBalance is required');
  }
  if (
    !Array.isArray(request.ids) ||
    !request.ids.every(id => typeof id === 'string') ||
    new Set(request.ids).size !== request.ids.length
  ) {
    invalid(noun, 'ids must be the unique candidate IDs from status');
  }
  const status = await reconciliationStatus({
    accountId: request.accountId,
    statementBalance: request.statementBalance,
    ...(request.statementDate === undefined
      ? {}
      : { statementDate: request.statementDate }),
  });
  if (status.account.closed) {
    throw APIError(`Account ${status.account.name} is closed`);
  }
  if (status.difference !== 0) {
    throw APIError(
      `The statement does not match: difference is ${status.difference} (statement ${request.statementBalance}, cleared ${status.clearedBalance})`,
    );
  }
  const expected = [...status.candidateIds].sort();
  const given = [...request.ids].sort();
  if (canonicalJson(expected) !== canonicalJson(given)) {
    throw APIError(
      'The cleared transaction set changed; read the status again and pass its candidateIds',
    );
  }
  return {
    schemaVersion: 1,
    operation: 'reconcile.finish',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      clearedBalance: status.clearedBalance,
      lastReconciled: status.account.lastReconciled,
    },
    after: { lockedIds: expected, difference: 0, setsLastReconciled: true },
    references: {},
    sideEffects: [
      'mark the listed cleared transactions (and their split children) reconciled',
      "set the account's last reconciled time, as finishing in the app does",
    ],
  };
}

export async function performReconcileFinish(current: ReconcileFinishProposal) {
  const ids = current.after.lockedIds;
  const children = ids.length
    ? (
        await db.all<{ id: string }>(
          `SELECT id FROM transactions WHERE tombstone = 0 AND parent_id IN (${ids
            .map(() => '?')
            .join(',')})`,
          ids,
        )
      ).map(row => row.id)
    : [];
  const all = [...ids, ...children];
  if (all.length) {
    await batchUpdateTransactions({
      updated: all.map(id => ({ id, reconciled: true })),
    });
  }
  const lastReconciled = String(Date.now());
  await db.updateWithSchema('accounts', {
    id: current.request.accountId,
    last_reconciled: lastReconciled,
  });
  const locked = all.length
    ? await db.all<{ id: string; reconciled: number }>(
        `SELECT id, reconciled FROM transactions WHERE id IN (${all
          .map(() => '?')
          .join(',')})`,
        all,
      )
    : [];
  if (
    locked.length !== all.length ||
    locked.some(row => row.reconciled !== 1)
  ) {
    throw new Error('Reconciliation acknowledgement does not match');
  }
  return {
    changed: true,
    affectedIds: [current.request.accountId, ...all],
    reconciliation: {
      lockedIds: all,
      lastReconciled: new Date(Number(lastReconciled)).toISOString(),
    },
  };
}

function adjustmentRow(request: ReconcileAdjustRequest) {
  return {
    account: request.accountId,
    amount: request.amount,
    date: request.date ?? monthUtils.currentDay(),
    cleared: true,
    reconciled: false,
    notes: ADJUSTMENT_NOTE,
  };
}

export async function prepareReconcileAdjust(
  request: ReconcileAdjustRequest,
): Promise<ReconcileAdjustProposal> {
  const noun = 'reconciliation adjustment';
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['accountId', 'amount', 'date'].includes(key),
    )
  ) {
    invalid(noun, 'provide accountId, amount and optional date');
  }
  if (!Number.isSafeInteger(request.amount) || request.amount === 0) {
    invalid(noun, 'amount must be non-zero integer cents');
  }
  if (
    request.date !== undefined &&
    (typeof request.date !== 'string' || !DATE.test(request.date))
  ) {
    invalid(noun, 'date must be YYYY-MM-DD');
  }
  const status = await reconciliationStatus({ accountId: request.accountId });
  if (status.account.closed) {
    throw APIError(`Account ${status.account.name} is closed`);
  }
  const { added, payeesToCreate } = await planAddedTransactions(
    request.accountId,
    [adjustmentRow(request)],
  );
  if (payeesToCreate.size > 0) {
    throw APIError(
      'Rules would create a new payee for the adjustment; adjust it in the app instead',
    );
  }
  const ids = added.map(row => row.id);
  return JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      operation: 'reconcile.adjust',
      budget: guardedBudgetIdentity(),
      request,
      before: {
        sourceHash: await guardedSourceHash(),
        clearedBalance: status.clearedBalance,
      },
      after: {
        rows: added.map(row =>
          projectAddedTransaction(
            row,
            row.payee ?? null,
            row.parent_id ? ids.indexOf(row.parent_id) : null,
          ),
        ),
        clearedBalance: status.clearedBalance + request.amount,
      },
      references: {},
      sideEffects: [
        "add one cleared 'Reconciliation balance adjustment' transaction, with rules run as the app's adjustment does",
      ],
    }),
  );
}

export async function performReconcileAdjust(current: ReconcileAdjustProposal) {
  const ids =
    (await addTransactions(current.request.accountId, [
      adjustmentRow(current.request),
    ])) ?? [];
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids } })
      .select('*')
      .options({ splits: 'all' }),
  );
  const byId = new Map((data as TransactionEntity[]).map(row => [row.id, row]));
  const actual = ids.map(id => {
    const row = byId.get(id);
    if (!row) throw new Error('Adjustment acknowledgement is incomplete');
    return projectAddedTransaction(
      row,
      row.payee ?? null,
      row.parent_id ? ids.indexOf(row.parent_id) : null,
    );
  });
  if (canonicalJson(actual) !== canonicalJson(current.after.rows)) {
    throw new Error('Adjustment acknowledgement does not match');
  }
  return {
    changed: true,
    affectedIds: ids,
    adjustment: { transactionIds: ids },
  };
}
