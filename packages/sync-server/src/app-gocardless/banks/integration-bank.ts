import * as d from 'date-fns';

import {
  amountToInteger,
  printIban,
  sortByBookingDateOrValueDate,
} from '#app-gocardless/utils';
import { formatPayeeName } from '#util/payee-name';

import type { IBank } from './bank.interface';

// A booking timestamp's leading date is the bank's calendar day. Formatting
// the instant in the server timezone moves a midnight booking to the
// previous day wherever that server is behind UTC.
function bookingDay(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) {
    const day = d.parseISO(match[1]);
    if (d.isValid(day)) {
      return d.format(day, 'yyyy-MM-dd');
    }
  }

  return d.format(d.parseISO(value), 'yyyy-MM-dd');
}

const SORTED_BALANCE_TYPE_LIST = [
  'closingBooked',
  'expected',
  'forwardAvailable',
  'interimAvailable',
  'interimBooked',
  'nonInvoiced',
  'openingBooked',
];

export default {
  institutionIds: ['IntegrationBank'],

  normalizeAccount(account) {
    return {
      account_id: account.id,
      institution: account.institution,
      mask: (account?.iban || '0000').slice(-4),
      iban: account?.iban || null,
      name: [
        account.name ?? account.displayName ?? account.product,
        printIban(account),
        account.currency,
      ]
        .filter(Boolean)
        .join(' '),
      official_name: account.product ?? `integration-${account.institution_id}`,
      type: 'checking',
    };
  },

  normalizeTransaction(transaction, _booked, editedTransaction?) {
    const trans = editedTransaction ?? transaction;

    const date =
      trans.date ||
      transaction.bookingDate ||
      transaction.bookingDateTime ||
      transaction.valueDate ||
      transaction.valueDateTime;

    // If we couldn't find a valid date field we filter out this transaction
    // and hope that we will import it again once the bank has processed the
    // transaction further.
    if (!date) {
      return null;
    }

    const notes =
      trans.notes ??
      trans.remittanceInformationUnstructured ??
      trans.remittanceInformationUnstructuredArray?.join(' ') ??
      '';

    transaction.remittanceInformationUnstructuredArrayString =
      transaction.remittanceInformationUnstructuredArray?.join(',');
    transaction.remittanceInformationStructuredArrayString =
      transaction.remittanceInformationStructuredArray?.join(',');

    return {
      ...transaction,
      payeeName: trans.payeeName ?? formatPayeeName(trans),
      date: bookingDay(date),
      notes,
    };
  },

  sortTransactions(transactions = []) {
    return sortByBookingDateOrValueDate(transactions);
  },

  calculateStartingBalance(sortedTransactions = [], balances = []) {
    const currentBalance = balances
      .filter(item => SORTED_BALANCE_TYPE_LIST.includes(item.balanceType))
      .sort(
        (a, b) =>
          SORTED_BALANCE_TYPE_LIST.indexOf(a.balanceType) -
          SORTED_BALANCE_TYPE_LIST.indexOf(b.balanceType),
      )[0];
    return sortedTransactions.reduce(
      (total, trans) => {
        return (
          total -
          amountToInteger(
            trans.transactionAmount.amount,
            trans.transactionAmount.currency,
          )
        );
      },
      amountToInteger(
        currentBalance?.balanceAmount.amount || 0,
        currentBalance?.balanceAmount.currency,
      ),
    );
  },
} satisfies IBank;
