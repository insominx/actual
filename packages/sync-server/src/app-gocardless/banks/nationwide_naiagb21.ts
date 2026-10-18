import type { IBank } from './bank.interface';
import Fallback from './integration-bank';

export default {
  ...Fallback,

  institutionIds: ['NATIONWIDE_NAIAGB21'],

  normalizeTransaction(transaction, booked) {
    const editedTrans = { ...transaction };

    // Nationwide can sometimes return pending transactions with a date
    // representing the latest a transaction could be booked. This stops
    // actual's deduplication logic from working as it only checks 7 days
    // ahead/behind and the transactionID from Nationwide changes when a
    // transaction is booked
    if (!booked) {
      const bookingTime = new Date(transaction.bookingDate ?? '').getTime();
      // Without a usable booking date there is nothing to clamp; leave the
      // date to the fallback (value date, ...) instead of throwing on an
      // invalid date, which would abort the whole account sync.
      if (!Number.isNaN(bookingTime)) {
        const useDate = new Date(Math.min(bookingTime, new Date().getTime()));
        editedTrans.date = useDate.toISOString().slice(0, 10);
      }
    }

    // Nationwide also occasionally returns erroneous transaction_ids
    // that are malformed and can even change after import. This will ignore
    // these ids and unset them. When a correct ID is returned then it will
    // update via the deduplication logic
    const debitCreditRegex = /^00(DEB|CRED)IT.+$/;
    const validLengths = [
      40, // Nationwide credit cards
      32, // Nationwide current accounts
    ];

    if (
      transaction.transactionId?.match(debitCreditRegex) ||
      !validLengths.includes(transaction.transactionId?.length ?? -1)
    ) {
      transaction.transactionId = undefined;
    }

    return Fallback.normalizeTransaction(transaction, booked, editedTrans);
  },
} satisfies IBank;
