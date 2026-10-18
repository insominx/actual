import { amountToInteger } from '#app-gocardless/utils';

import type { IBank } from './bank.interface';
import Fallback from './integration-bank';

export default {
  ...Fallback,

  institutionIds: ['ABNAMRO_ABNANL2A'],

  normalizeTransaction(transaction, booked) {
    const editedTrans = { ...transaction };

    const infoArray = transaction.remittanceInformationUnstructuredArray ?? [];

    // There is no remittanceInformationUnstructured, so we'll make it
    editedTrans.remittanceInformationUnstructured = infoArray.join(', ');

    // Remove clutter to extract the payee from remittanceInformationUnstructured ...
    // ... when not otherwise provided.
    const payeeName = infoArray
      .map(el => el.match(/^(?:.*\*)?(.+),PAS\d+$/))
      .find(match => match)?.[1];

    editedTrans.debtorName = transaction.debtorName || payeeName;
    editedTrans.creditorName = transaction.creditorName || payeeName;

    editedTrans.date = (transaction.valueDateTime ?? '').slice(0, 10);

    return Fallback.normalizeTransaction(transaction, booked, editedTrans);
  },

  sortTransactions(transactions = []) {
    return transactions.sort(
      (a, b) =>
        +new Date(b.valueDateTime ?? '') - +new Date(a.valueDateTime ?? ''),
    );
  },

  calculateStartingBalance(sortedTransactions = [], balances = []) {
    if (sortedTransactions.length) {
      const oldestTransaction =
        sortedTransactions[sortedTransactions.length - 1];
      const oldestKnownBalance = amountToInteger(
        oldestTransaction.balanceAfterTransaction?.balanceAmount.amount || 0,
        oldestTransaction.balanceAfterTransaction?.balanceAmount.currency,
      );
      const oldestTransactionAmount = amountToInteger(
        oldestTransaction.transactionAmount.amount,
        oldestTransaction.transactionAmount.currency,
      );

      return oldestKnownBalance - oldestTransactionAmount;
    } else {
      const booked = balances.find(
        balance => 'interimBooked' === balance.balanceType,
      );
      return amountToInteger(
        booked?.balanceAmount.amount || 0,
        booked?.balanceAmount.currency,
      );
    }
  },
} satisfies IBank;
