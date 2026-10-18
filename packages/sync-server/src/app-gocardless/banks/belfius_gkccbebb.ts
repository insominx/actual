import type { IBank } from './bank.interface';
import Fallback from './integration-bank';

export default {
  ...Fallback,

  institutionIds: ['BELFIUS_GKCCBEBB'],

  // The problem is that we have transaction with duplicated transaction ids.
  // This is not expected and the nordigen api has a work-around for some backs
  // They will set an internalTransactionId which is unique
  normalizeTransaction(transaction, booked) {
    // Keep the original id when no internal one is provided; overwriting it
    // with undefined would leave the transaction without an import id
    transaction.transactionId =
      transaction.internalTransactionId ?? transaction.transactionId;

    return Fallback.normalizeTransaction(transaction, booked);
  },
} satisfies IBank;
