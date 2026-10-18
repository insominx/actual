import type { IBank } from './bank.interface';
import Fallback from './integration-bank';

export default {
  ...Fallback,

  institutionIds: ['HYPE_HYEEIT22'],

  normalizeTransaction(transaction, booked) {
    const editedTrans = { ...transaction };

    /** Online card payments - identified by "crd" transaction code
     *  always start with PAGAMENTO PRESSO + <payee name>
     */
    if (transaction.proprietaryBankTransactionCode === 'crd') {
      // remove PAGAMENTO PRESSO and set payee name
      editedTrans.debtorName =
        transaction.remittanceInformationUnstructured?.slice(
          'PAGAMENTO PRESSO '.length,
        );
    }
    /**
     * In-app money transfers (p2p) and bank transfers (bon) have remittance info structure like
     * DENARO (INVIATO/RICEVUTO) (A/DA) {payee_name} - {payment_info} (p2p)
     * HAI (INVIATO/RICEVUTO) UN BONIFICO (A/DA) {payee_name} - {payment_info} (bon)
     */
    if (
      transaction.proprietaryBankTransactionCode === 'p2p' ||
      transaction.proprietaryBankTransactionCode === 'bon'
    ) {
      // keep only {payment_info} portion of remittance info
      // NOTE: if {payee_name} contains dashes (unlikely / impossible?), this probably gets bugged!
      const remittance = transaction.remittanceInformationUnstructured ?? '';
      const idx = remittance.indexOf(' - ');
      editedTrans.remittanceInformationUnstructured =
        idx === -1 ? remittance : remittance.slice(idx + 3).trim();
    }
    /**
     * CONVERT ESCAPED UNICODE TO CODEPOINTS
     * p2p payments allow user to write arbitrary unicode strings as messages
     * gocardless reports unicode codepoints as \Uxxxx
     * so it groups them in 4bytes bundles
     * the code below assumes this is always the case
     */
    if (transaction.proprietaryBankTransactionCode === 'p2p') {
      // Only well-formed escapes are decoded: user-typed text such as a
      // literal "\Uzzzz" has no code point and used to throw a RangeError
      // Decode the already-trimmed text: reading the original here would
      // discard the payment-info extraction above
      editedTrans.remittanceInformationUnstructured = (
        editedTrans.remittanceInformationUnstructured ?? ''
      ).replace(/(?:\\U[0-9a-fA-F]{4})+/g, run =>
        String.fromCharCode(
          ...Array.from({ length: run.length / 6 }, (_, i) =>
            parseInt(run.slice(i * 6 + 2, i * 6 + 6), 16),
          ),
        ),
      );
    }

    editedTrans.date = transaction.valueDate || transaction.bookingDate;

    return Fallback.normalizeTransaction(transaction, booked, editedTrans);
  },
} satisfies IBank;
