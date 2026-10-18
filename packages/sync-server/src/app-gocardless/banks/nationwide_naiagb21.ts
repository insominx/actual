import type { IBank } from './bank.interface';
import Fallback from './integration-bank';

// A future pending booking is "today", the server's local calendar day.
// Formatting the current instant as a UTC date makes that tomorrow during
// the evening in timezones behind UTC, and yesterday during the morning
// in timezones ahead of UTC.
export function pendingBookingDay(
  bookingDate: string | undefined,
  now = new Date(),
): string | null {
  if (!bookingDate) {
    return null;
  }

  const bookingTime = new Date(bookingDate).getTime();
  if (Number.isNaN(bookingTime)) {
    return null;
  }

  if (bookingTime > now.getTime()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(bookingDate);
  return match ? match[1] : new Date(bookingTime).toISOString().slice(0, 10);
}

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
      // Without a usable booking date there is nothing to clamp; leave the
      // date to the fallback (value date, ...) instead of throwing on an
      // invalid date, which would abort the whole account sync.
      const pendingDate = pendingBookingDay(transaction.bookingDate);
      if (pendingDate) {
        editedTrans.date = pendingDate;
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
