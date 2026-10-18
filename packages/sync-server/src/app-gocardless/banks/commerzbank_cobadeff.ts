import type { IBank } from './bank.interface';
import Fallback from './integration-bank';
import { escapeRegExp } from './util/escape-regexp';

export default {
  ...Fallback,

  institutionIds: ['COMMERZBANK_COBADEFF'],

  normalizeTransaction(transaction, booked) {
    const editedTrans = { ...transaction };

    // remittanceInformationUnstructured is limited to 140 chars thus ...
    // ... missing information form remittanceInformationUnstructuredArray ...
    // ... so we recreate it.
    editedTrans.remittanceInformationUnstructured = (
      transaction.remittanceInformationUnstructuredArray ?? []
    ).join(' ');

    // The limitations of remittanceInformationUnstructuredArray ...
    // ... can result in split keywords. We fix these. Other ...
    // ... splits will need to be fixed by user with rules.
    const keywords = [
      'End-to-End-Ref.:',
      'Mandatsref:',
      'Gläubiger-ID:',
      'SEPA-BASISLASTSCHRIFT',
      'Kartenzahlung',
      'Dauerauftrag',
    ];
    keywords.forEach(keyword => {
      editedTrans.remittanceInformationUnstructured = (
        editedTrans.remittanceInformationUnstructured ?? ''
      ).replace(
        // There can be spaces in keywords
        RegExp(keyword.split('').join('\\s*'), 'gi'),
        ', ' + keyword + ' ',
      );
    });

    // Clean up remittanceInformation, deduplicate payee (removing slashes ...
    // ... that are added to the remittanceInformation field), and ...
    // ... remove clutter like "End-to-End-Ref.: NOTPROVIDED"
    const payee = escapeRegExp(
      transaction.creditorName || transaction.debtorName || '',
    );
    // An empty payee would build an empty regex, which matches between every
    // character and spaces out the whole text.
    let cleaned = editedTrans.remittanceInformationUnstructured.replace(
      /\s*(,)?\s+/g,
      '$1 ',
    );
    if (payee) {
      cleaned = cleaned.replace(
        RegExp(payee.split(' ').join('(/*| )'), 'gi'),
        ' ',
      );
    }
    editedTrans.remittanceInformationUnstructured = cleaned
      .replace(', End-to-End-Ref.: NOTPROVIDED', '')
      .trim();

    return Fallback.normalizeTransaction(transaction, booked, editedTrans);
  },
} satisfies IBank;
