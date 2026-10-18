import type { IBank } from './bank.interface';
import Fallback from './integration-bank';
import { extractPayeeNameFromRemittanceInfo } from './util/extract-payeeName-from-remittanceInfo';

export default {
  ...Fallback,

  institutionIds: ['KBC_KREDBEBB', 'KBC_BRUSSELS_KREDBEBB'],

  /**
   * For negative amounts, the only payee information we have is returned in
   * remittanceInformationUnstructured.
   */
  normalizeTransaction(transaction, booked) {
    const editedTrans = { ...transaction };

    // When nothing usable is found, leave payeeName unset so the shared
    // formatPayeeName fallback applies instead of booking a payee literally
    // called "undefined" (or an empty one)
    if (Number(transaction.transactionAmount.amount) > 0) {
      editedTrans.payeeName =
        transaction.debtorName ||
        transaction.remittanceInformationUnstructured ||
        undefined;
    } else {
      editedTrans.payeeName =
        transaction.creditorName ||
        extractPayeeNameFromRemittanceInfo(
          transaction.remittanceInformationUnstructured ?? '',
          ['Betaling met', 'Domiciliëring', 'Overschrijving'],
        ) ||
        undefined;
    }

    return Fallback.normalizeTransaction(transaction, booked, editedTrans);
  },
} satisfies IBank;
