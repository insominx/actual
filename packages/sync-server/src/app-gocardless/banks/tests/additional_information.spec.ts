import BerlinerSparkasse from '#app-gocardless/banks/berliner_sparkasse_beladebexxx';
import SpkKarlsruhe from '#app-gocardless/banks/spk_karlsruhe_karsde66';
import SskMunchen from '#app-gocardless/banks/ssk_munchen';

describe.each([
  ['Berliner Sparkasse', BerlinerSparkasse],
  ['Sparkasse Karlsruhe', SpkKarlsruhe],
  ['Stadtsparkasse München', SskMunchen],
])('%s', (_name, bank) => {
  const base = {
    transactionId: '1234567890',
    bookingDate: '2025-01-01',
    valueDate: '2025-01-01',
    transactionAmount: { amount: '-10.00', currency: 'EUR' },
    internalTransactionId: 'abcdef1234567890',
  };

  it('appends additionalInformation to the remittance information', () => {
    const normalized = bank.normalizeTransaction(
      {
        ...base,
        remittanceInformationUnstructured: 'Rent',
        additionalInformation: 'January',
      },
      true,
    );
    expect(normalized?.notes).toEqual('Rent January');
  });

  it('uses additionalInformation alone when there is no remittance information', () => {
    const normalized = bank.normalizeTransaction(
      { ...base, additionalInformation: 'January' },
      true,
    );
    expect(normalized?.notes).toEqual('January');
  });
});
