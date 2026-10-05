// Guarded transfer match, unmatch and repair. Each plan freezes both legs and
// the whole-budget source hash, so apply rejects any later change instead of
// linking or unlinking a different pair. Matching links two existing
// opposite entries without creating money movement; unmatching keeps both
// entries as ordinary transactions; repair fixes one broken link through the
// engine's own transfer owner.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import { batchUpdateTransactions } from '#server/transactions';
import { transferClearsCategory } from '#server/transactions/transfer';
import type {
  TransferLegSnapshot,
  TransferMatchProposal,
  TransferMatchRequest,
  TransferRepairProposal,
  TransferRepairRequest,
  TransferUnmatchProposal,
  TransferUnmatchRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

import { classifyTransfer, inspectTransfer } from './inspect';

type RawRow = {
  id: string;
  acct: string;
  amount: number;
  date: number;
  description: string | null;
  category: string | null;
  isParent: number;
  isChild: number;
  parent_id: string | null;
  transferred_id: string | null;
  reconciled: number;
  tombstone: number;
};

function raw(id: string) {
  return db.first<RawRow>('SELECT * FROM transactions WHERE id = ?', [id]);
}

function snapshot(row: RawRow): TransferLegSnapshot {
  return {
    id: row.id,
    account: row.acct,
    amount: row.amount,
    date: row.date,
    payee: row.description,
    category: row.category,
    transferId: row.transferred_id,
    parentId: row.parent_id,
    reconciled: row.reconciled === 1,
  };
}

async function transferPayee(accountId: string) {
  const payee = await db.first<{ id: string }>(
    'SELECT id FROM payees WHERE transfer_acct = ? AND tombstone = 0',
    [accountId],
  );
  if (!payee) throw APIError(`Account has no transfer payee: ${accountId}`);
  return payee.id;
}

async function account(accountId: string) {
  const found = await db.first<{ offbudget: number; tombstone: number }>(
    'SELECT offbudget, tombstone FROM accounts WHERE id = ?',
    [accountId],
  );
  if (!found || found.tombstone) {
    throw APIError(`Account does not exist: ${accountId}`);
  }
  return found;
}

async function isTransferPayee(payeeId: string | null) {
  if (!payeeId) return false;
  const payee = await db.first<{ transfer_acct: string | null }>(
    'SELECT transfer_acct FROM payees WHERE id = ?',
    [payeeId],
  );
  return !!payee?.transfer_acct;
}

async function live(id: unknown, label: string) {
  if (typeof id !== 'string' || !id) {
    throw APIError(`Invalid ${label}: provide a transaction ID`);
  }
  const row = await raw(id);
  if (!row || row.tombstone) {
    throw APIError(`Transaction does not exist: ${id}`);
  }
  return row;
}

function onlyKeys(request: unknown, keys: string[], message: string) {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(key => !keys.includes(key))
  ) {
    throw APIError(message);
  }
}

function checkAllowReconciled(value: unknown) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw APIError('allowReconciled must be a boolean');
  }
  return value === true;
}

export async function prepareTransferMatch(
  request: TransferMatchRequest,
): Promise<TransferMatchProposal> {
  onlyKeys(
    request,
    ['ids', 'allowReconciled'],
    'Invalid transfer match request: provide ids and optional allowReconciled',
  );
  const allowReconciled = checkAllowReconciled(request.allowReconciled);
  if (
    !Array.isArray(request.ids) ||
    request.ids.length !== 2 ||
    request.ids[0] === request.ids[1]
  ) {
    throw APIError(
      'Invalid transfer match request: ids must be two distinct IDs',
    );
  }
  const rows = [
    await live(request.ids[0], 'ids'),
    await live(request.ids[1], 'ids'),
  ];
  for (const row of rows) {
    if (row.isParent || row.isChild) {
      throw APIError(
        `Transaction ${row.id} is part of a split; split transfers are set on the child's payee with transactions split`,
      );
    }
    if (row.transferred_id) {
      throw APIError(
        `Transaction ${row.id} is already linked to ${row.transferred_id}; unmatch it first`,
      );
    }
    if (await isTransferPayee(row.description)) {
      throw APIError(
        `Transaction ${row.id} has a transfer payee without a link; use transfers repair`,
      );
    }
    if (row.reconciled && !allowReconciled) {
      throw APIError(
        `Transaction ${row.id} is reconciled; pass allowReconciled to link it`,
      );
    }
  }
  const [a, b] = rows;
  if (a.acct === b.acct) {
    throw APIError('Both transactions are in the same account');
  }
  if (a.amount === 0 || a.amount + b.amount !== 0) {
    throw APIError('Transfer amounts must cancel each other out');
  }
  const [from, to] = a.amount < 0 ? [a, b] : [b, a];
  const fromAccount = await account(from.acct);
  const toAccount = await account(to.acct);
  const clears = transferClearsCategory(
    fromAccount.offbudget,
    toAccount.offbudget,
  );
  const fromPayee = await transferPayee(to.acct);
  const toPayee = await transferPayee(from.acct);
  const plan = [
    {
      id: from.id,
      payee: fromPayee,
      transferId: to.id,
      category: clears || fromAccount.offbudget ? null : from.category,
    },
    {
      id: to.id,
      payee: toPayee,
      transferId: from.id,
      category: clears || toAccount.offbudget ? null : to.category,
    },
  ];
  return {
    schemaVersion: 1,
    operation: 'transfers.match',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transactions: [snapshot(from), snapshot(to)],
    },
    after: {
      classification: classifyTransfer(
        !!fromAccount.offbudget,
        !!toAccount.offbudget,
      ),
      categoryCleared: clears,
      transactions: plan,
      reconciledIds: rows.filter(row => row.reconciled).map(row => row.id),
    },
    references: {},
    sideEffects: [
      `link ${from.id} and ${to.id} as one transfer through the canonical batch owner without running transfer creation; no transaction is added or deleted, amounts and dates are unchanged${
        clears ? ', and both categories are cleared' : ''
      }`,
    ],
  };
}

async function writeAndVerify(
  plan: Array<{
    id: string;
    payee: string | null;
    transferId: string | null;
    category: string | null;
  }>,
  before: TransferLegSnapshot[],
  noun: string,
) {
  await batchUpdateTransactions({
    // Null payee, transfer_id or category clears the field; the entity type
    // omits null.
    updated: plan.map(
      row =>
        ({
          id: row.id,
          payee: row.payee,
          transfer_id: row.transferId,
          category: row.category,
        }) as unknown as Partial<TransactionEntity>,
    ),
    runTransfers: false,
  });
  for (const row of plan) {
    const original = before.find(b => b.id === row.id)!;
    if (
      !rowMatches(await raw(row.id), {
        description: row.payee,
        transferred_id: row.transferId,
        category: row.category,
        amount: original.amount,
        date: original.date,
        acct: original.account,
        tombstone: 0,
      })
    ) {
      throw new Error(`${noun} acknowledgement is incomplete`);
    }
  }
  return { changed: true, affectedIds: plan.map(row => row.id) };
}

export async function performTransferMatch(current: TransferMatchProposal) {
  return writeAndVerify(
    current.after.transactions,
    current.before.transactions,
    'Transfer match',
  );
}

export async function prepareTransferUnmatch(
  request: TransferUnmatchRequest,
): Promise<TransferUnmatchProposal> {
  onlyKeys(
    request,
    ['id', 'allowReconciled'],
    'Invalid transfer unmatch request: provide id and optional allowReconciled',
  );
  const allowReconciled = checkAllowReconciled(request.allowReconciled);
  const row = await live(request.id, 'id');
  if (row.isParent) {
    throw APIError(
      `Transaction ${row.id} is a split parent; unmatch the split child that carries the transfer`,
    );
  }
  if (!row.transferred_id) {
    throw APIError(`Transaction ${row.id} is not linked to a transfer`);
  }
  const other = await raw(row.transferred_id);
  if (!other || other.tombstone || other.transferred_id !== row.id) {
    throw APIError(
      `Transaction ${row.id} has a broken transfer link; use transfers repair`,
    );
  }
  for (const leg of [row, other]) {
    if (leg.reconciled && !allowReconciled) {
      throw APIError(
        `Transaction ${leg.id} is reconciled; pass allowReconciled to unlink it`,
      );
    }
  }
  const legs = [row, other].sort((x, y) => x.id.localeCompare(y.id));
  return {
    schemaVersion: 1,
    operation: 'transfers.unmatch',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transactions: legs.map(snapshot),
    },
    after: {
      transactions: legs.map(leg => ({
        id: leg.id,
        payee: null,
        transferId: null,
        category: leg.category,
      })),
      reconciledIds: legs.filter(leg => leg.reconciled).map(leg => leg.id),
    },
    references: {},
    sideEffects: [
      `unlink ${legs[0].id} and ${legs[1].id}; both stay as ordinary transactions with no payee (a transfer payee would relink them on the next edit), amounts, dates and categories are unchanged, and nothing is deleted`,
    ],
  };
}

export async function performTransferUnmatch(current: TransferUnmatchProposal) {
  return writeAndVerify(
    current.after.transactions,
    current.before.transactions,
    'Transfer unmatch',
  );
}

export async function prepareTransferRepair(
  request: TransferRepairRequest,
): Promise<TransferRepairProposal> {
  onlyKeys(
    request,
    ['id', 'allowReconciled'],
    'Invalid transfer repair request: provide id and optional allowReconciled',
  );
  const allowReconciled = checkAllowReconciled(request.allowReconciled);
  const row = await live(request.id, 'id');
  const inspection = await inspectTransfer(row.id);
  if (inspection.repair === 'none') {
    throw APIError(`Transaction ${row.id} has no transfer issues to repair`);
  }
  const counterpart =
    inspection.repair === 'resync' && row.transferred_id
      ? await raw(row.transferred_id)
      : null;
  for (const leg of [row, counterpart]) {
    if (leg?.reconciled && !allowReconciled) {
      throw APIError(
        `Transaction ${leg.id} is reconciled; pass allowReconciled to repair it`,
      );
    }
  }
  const legs = [row, ...(counterpart ? [counterpart] : [])];
  const effect = {
    unlink: `remove the broken link from ${row.id} and clear its transfer payee; no other transaction changes`,
    resync: `make counterpart ${row.transferred_id} follow ${row.id} through the engine's linked transfer update (opposite amount, payee account, date)`,
    relink: `create the missing counterpart for ${row.id} in its transfer payee's account through the engine's transfer creation; this adds one transaction`,
  }[inspection.repair];
  return {
    schemaVersion: 1,
    operation: 'transfers.repair',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      transactions: legs.map(snapshot),
    },
    after: {
      repair: inspection.repair,
      issues: inspection.issues,
    },
    references: {},
    sideEffects: [effect],
  };
}

export async function performTransferRepair(current: TransferRepairProposal) {
  const [row] = current.before.transactions;
  if (current.after.repair === 'unlink') {
    const keepPayee = !(await isTransferPayee(row.payee));
    const result = await writeAndVerify(
      [
        {
          id: row.id,
          payee: keepPayee ? row.payee : null,
          transferId: null,
          category: row.category,
        },
      ],
      current.before.transactions,
      'Transfer repair',
    );
    return { ...result, counterpartId: null };
  }
  // Resync and relink run the engine's transfer owner for this row.
  await batchUpdateTransactions({
    updated: [{ id: row.id }],
    runTransfers: true,
  });
  const after = await inspectTransfer(row.id);
  if (after.issues.length || !after.counterpart) {
    throw new Error('Transfer repair acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [row.id, after.counterpart.id],
    counterpartId: after.counterpart.id,
  };
}
