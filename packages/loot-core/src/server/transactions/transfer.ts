// @ts-strict-ignore
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { q } from '#shared/query';
import { ungroupTransactions } from '#shared/transactions';
import type { TransactionEntity } from '#types/models';

import { planLinkedTransferUpdate } from './linked-transfer-plan';
import { runRules } from './transaction-rules';
import type { RuleLedgerContext } from './transaction-rules';

async function getPayee(acct) {
  return db.first<db.DbPayee>('SELECT * FROM payees WHERE transfer_acct = ?', [
    acct,
  ]);
}

export async function getTransferredAccount(transaction: TransactionEntity) {
  if (transaction.payee) {
    const result = await db.first<Pick<db.DbViewPayee, 'transfer_acct'>>(
      'SELECT transfer_acct FROM v_payees WHERE id = ?',
      [transaction.payee],
    );

    return result?.transfer_acct || null;
  }
  return null;
}

export function transferClearsCategory(
  fromOffBudget: number,
  toOffBudget: number,
) {
  return fromOffBudget === toOffBudget;
}

async function clearCategory(transaction, transferAcct) {
  const { offbudget: fromOffBudget } = await db.first<
    Pick<db.DbAccount, 'offbudget'>
  >('SELECT offbudget FROM accounts WHERE id = ?', [transaction.account]);
  const { offbudget: toOffBudget } = await db.first<
    Pick<db.DbAccount, 'offbudget'>
  >('SELECT offbudget FROM accounts WHERE id = ?', [transferAcct]);

  // If the transfer is between two on budget or two off budget accounts,
  // we should clear the category, because the category is not relevant
  if (transferClearsCategory(fromOffBudget, toOffBudget)) {
    await db.updateTransaction({ id: transaction.id, category: null });
    if (transaction.transfer_id) {
      await db.updateTransaction({
        id: transaction.transfer_id,
        category: null,
      });
    }
    return true;
  }
  return false;
}

export async function prepareTransferTransaction(
  transaction: TransactionEntity,
  transferredAccount: string,
  ledgerContext: RuleLedgerContext = {},
) {
  if (transaction.is_parent) {
    // For split transactions, we should create transfers using child transactions.
    // This is to ensure that the amounts received by the transferred account
    // reflects the amounts in the child transactions and not the parent transaction
    // amount which is the total amount.
    return null;
  }

  const { id: fromPayee } = await db.first<Pick<db.DbPayee, 'id'>>(
    'SELECT id FROM payees WHERE transfer_acct = ?',
    [transaction.account],
  );

  const transferTransaction = {
    account: transferredAccount,
    amount: -transaction.amount,
    payee: fromPayee,
    date: transaction.date,
    transfer_id: transaction.id,
    notes: transaction.notes || null,
    schedule: transaction.schedule,
    cleared: false,
  };
  const { notes, cleared, schedule } = await runRules(
    transferTransaction,
    null,
    ledgerContext,
  );
  const matchedSchedule = schedule ?? transaction.schedule;

  return {
    ...transferTransaction,
    notes,
    cleared,
    schedule: matchedSchedule,
  };
}

export async function addTransfer(transaction, transferredAccount) {
  const transferTransaction = await prepareTransferTransaction(
    transaction,
    transferredAccount,
  );
  if (!transferTransaction) {
    return null;
  }
  const matchedSchedule = transferTransaction.schedule;
  const id = await db.insertTransaction(transferTransaction);

  await db.updateTransaction({
    id: transaction.id,
    transfer_id: id,
    ...(matchedSchedule ? { schedule: matchedSchedule } : {}),
  });
  const categoryCleared = await clearCategory(transaction, transferredAccount);

  return {
    id: transaction.id,
    transfer_id: id,
    ...(categoryCleared ? { category: null } : {}),
  };
}

export async function removeTransfer(transaction) {
  const transferTrans = await db.getTransaction(transaction.transfer_id);

  // Perform operations on the transfer transaction only
  // if it is found. For example: when users delete both
  // (in & out) transfer transactions at the same time -
  // transfer transaction will not be found.
  if (transferTrans) {
    if (transferTrans.is_child) {
      // If it's a child transaction, we don't delete it because that
      // would invalidate the whole split transaction. Instead of turn
      // it into a normal transaction
      await db.updateTransaction({
        id: transaction.transfer_id,
        transfer_id: null,
        payee: null,
      });
    } else {
      await db.deleteTransaction({ id: transaction.transfer_id });
    }
  }
  await db.updateTransaction({ id: transaction.id, transfer_id: null });
  return { id: transaction.id, transfer_id: null };
}

export async function inspectTransferUpdate(
  transaction: TransactionEntity,
  transferredAccount: string,
) {
  const payee = await getPayee(transaction.account);
  const [fromAccount, toAccount, grouped] = await Promise.all([
    db.first<db.DbAccount>('SELECT * FROM accounts WHERE id = ?', [
      transaction.account,
    ]),
    db.first<db.DbAccount>('SELECT * FROM accounts WHERE id = ?', [
      transferredAccount,
    ]),
    aqlQuery(
      q('transactions')
        .filter({ id: transaction.transfer_id })
        .select('*')
        .options({ splits: 'grouped' }),
    ),
  ]);
  if (!payee || !fromAccount || !toAccount) {
    throw new Error('Transfer reference not found');
  }
  const before = ungroupTransactions(grouped.data);
  if (!before.some(row => row.id === transaction.transfer_id)) {
    throw new Error('Transfer counterpart not found');
  }
  return {
    before,
    references: { fromAccount, toAccount, fromPayee: payee },
    context: {
      account: transferredAccount,
      payee: payee.id,
      clearCategory: fromAccount.offbudget === toAccount.offbudget,
    },
  };
}

export async function updateTransfer(transaction, transferredAccount) {
  const observed = await inspectTransferUpdate(transaction, transferredAccount);
  const planned = planLinkedTransferUpdate(
    observed.before,
    transaction,
    observed.context,
  );
  await Promise.all(planned.diff.updated.map(row => db.updateTransaction(row)));

  const categoryCleared = await clearCategory(transaction, transferredAccount);
  if (categoryCleared) {
    return { id: transaction.id, category: null };
  }
}

export async function onInsert(transaction) {
  const transferredAccount = await getTransferredAccount(transaction);

  if (transferredAccount) {
    return addTransfer(transaction, transferredAccount);
  }
}

export async function onDelete(transaction) {
  if (transaction.transfer_id) {
    await removeTransfer(transaction);
  }
}

export async function onUpdate(transaction) {
  const transferredAccount = await getTransferredAccount(transaction);

  if (transaction.is_parent) {
    return removeTransfer(transaction);
  }

  if (transferredAccount && !transaction.transfer_id) {
    return addTransfer(transaction, transferredAccount);
  }

  if (!transferredAccount && transaction.transfer_id) {
    return removeTransfer(transaction);
  }

  if (transferredAccount && transaction.transfer_id) {
    return updateTransfer(transaction, transferredAccount);
  }
}
