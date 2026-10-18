import AmericanExpress from '#app-gocardless/banks/american_express_aesudef1';
import Belfius from '#app-gocardless/banks/belfius_gkccbebb';
import HypeHyeeit22 from '#app-gocardless/banks/hype_hyeeit22';
import IntegrationBank from '#app-gocardless/banks/integration-bank';
import type {
  Balance,
  Transaction,
} from '#app-gocardless/gocardless-node.types';
import type { DetailedAccountWithInstitution } from '#app-gocardless/gocardless.types';
import {
  mockExtendAccountsAboutInstitutions,
  mockInstitution,
} from '#app-gocardless/services/tests/fixtures';

describe('IntegrationBank', () => {
  it('keeps the calendar day of a booking timestamp', () => {
    const normalized = IntegrationBank.normalizeTransaction(
      {
        transactionAmount: { amount: '-1.00', currency: 'EUR' },
        bookingDateTime: '2026-01-15T23:30:00-08:00',
      },
      true,
    );

    expect(normalized?.date).toBe('2026-01-15');
  });

  describe('normalizeAccount', () => {
    const account = mockExtendAccountsAboutInstitutions[0];

    it('should return a normalized account object', () => {
      const normalizedAccount = IntegrationBank.normalizeAccount(account);
      expect(normalizedAccount).toEqual({
        account_id: account.id,
        institution: mockInstitution,
        mask: '4321',
        iban: account.iban,
        name: 'account-example-one (XXX 4321) PLN',
        official_name: 'Savings Account for Individuals (Retail)',
        type: 'checking',
      });
    });

    it('should return a normalized account object with masked value "0000" when no iban property is provided', () => {
      const normalizedAccount = IntegrationBank.normalizeAccount({
        ...account,
        iban: undefined,
      } as unknown as DetailedAccountWithInstitution);
      expect(normalizedAccount).toEqual({
        account_id: account.id,
        institution: mockInstitution,
        mask: '0000',
        iban: null,
        name: 'account-example-one PLN',
        official_name: 'Savings Account for Individuals (Retail)',
        type: 'checking',
      });
    });
  });

  describe('sortTransactions', () => {
    const transactions = [
      {
        date: '2022-01-01',
        bookingDate: '2022-01-01',
        transactionAmount: { amount: '100', currency: 'EUR' },
      },
      {
        date: '2022-01-03',
        bookingDate: '2022-01-03',
        transactionAmount: { amount: '100', currency: 'EUR' },
      },
      {
        date: '2022-01-02',
        bookingDate: '2022-01-02',
        transactionAmount: { amount: '100', currency: 'EUR' },
      },
    ];

    it('should return transactions sorted by bookingDate', () => {
      const sortedTransactions = IntegrationBank.sortTransactions(transactions);
      expect(sortedTransactions).toEqual([
        {
          date: '2022-01-03',
          bookingDate: '2022-01-03',
          transactionAmount: { amount: '100', currency: 'EUR' },
        },
        {
          date: '2022-01-02',
          bookingDate: '2022-01-02',
          transactionAmount: { amount: '100', currency: 'EUR' },
        },
        {
          date: '2022-01-01',
          bookingDate: '2022-01-01',
          transactionAmount: { amount: '100', currency: 'EUR' },
        },
      ]);
    });
  });

  describe('calculateStartingBalance', () => {
    const transactions: Transaction[] = [
      {
        bookingDate: '2022-01-01',
        transactionAmount: { amount: '100', currency: 'EUR' },
      },
      {
        bookingDate: '2022-02-01',
        transactionAmount: { amount: '100', currency: 'EUR' },
      },
      {
        bookingDate: '2022-03-01',
        transactionAmount: { amount: '100', currency: 'EUR' },
      },
    ];

    const balances: Balance[] = [
      {
        balanceAmount: { amount: '1000.00', currency: 'EUR' },
        balanceType: 'interimBooked',
      },
    ];

    it('should return 0 when no transactions or balances are provided', () => {
      const startingBalance = IntegrationBank.calculateStartingBalance([], []);
      expect(startingBalance).toEqual(0);
    });

    it('should return 70000 when transactions and balances are provided', () => {
      const startingBalance = IntegrationBank.calculateStartingBalance(
        transactions,
        balances,
      );
      expect(startingBalance).toEqual(70000);
    });
  });
});

// Banks without a spec file of their own
describe('HypeHyeeit22', () => {
  const p2p = (remittanceInformationUnstructured: string) =>
    HypeHyeeit22.normalizeTransaction(
      {
        transactionAmount: { amount: '-1.00', currency: 'EUR' },
        proprietaryBankTransactionCode: 'p2p',
        remittanceInformationUnstructured,
        bookingDate: '2024-09-21',
      },
      true,
    );

  it('keeps only the payment info of a p2p transfer', () => {
    expect(p2p('DENARO INVIATO A Mario - pizza')?.notes).toEqual('pizza');
  });

  it('decodes escaped unicode code units, including surrogate pairs', () => {
    expect(p2p('x - ciao \\U0041\\U0042 \\UD83D\\UDE00 fine')?.notes).toEqual(
      'ciao AB \u{1F600} fine',
    );
  });

  it('leaves malformed escapes untouched instead of throwing', () => {
    expect(p2p('x - \\Uzzzz and \\U12 and \\U0041')?.notes).toEqual(
      '\\Uzzzz and \\U12 and A',
    );
  });
});

describe('BelfiusGkccbebb #normalizeTransaction', () => {
  const base = {
    transactionAmount: { amount: '-1.00', currency: 'EUR' },
    bookingDate: '2024-09-21',
  };

  it('uses the internal transaction id when present', () => {
    const result = Belfius.normalizeTransaction(
      { ...base, transactionId: 'dup', internalTransactionId: 'unique' },
      true,
    );

    expect(result?.transactionId).toEqual('unique');
  });

  it('keeps the original transaction id when there is no internal one', () => {
    const result = Belfius.normalizeTransaction(
      { ...base, transactionId: 'original' },
      true,
    );

    expect(result?.transactionId).toEqual('original');
  });
});

describe('AmericanExpressAesudef1 #normalizeAccount', () => {
  const base = {
    id: 'account-id',
    institution_id: 'AMERICAN_EXPRESS_AESUDEF1',
    institution: { name: 'American Express' },
    details: 'Gold Card',
    currency: 'EUR',
  };

  it('uses the last five characters of the masked PAN', () => {
    const account = AmericanExpress.normalizeAccount({
      ...base,
      iban: 'XXXXXXXXXX12345',
    } as never);

    expect(account.mask).toEqual('12345');
    expect(account.iban).toBeNull();
    expect(account.name).toEqual('Gold Card (12345)');
  });

  it('does not throw when the bank provides no masked PAN', () => {
    const account = AmericanExpress.normalizeAccount(base as never);

    expect(account.mask).toEqual('');
    expect(account.name).toEqual('Gold Card');
  });
});
