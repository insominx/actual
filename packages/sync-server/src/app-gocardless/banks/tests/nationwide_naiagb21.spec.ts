import Nationwide, {
  pendingBookingDay,
} from '#app-gocardless/banks/nationwide_naiagb21';
import { mockTransactionAmount } from '#app-gocardless/services/tests/fixtures';

describe('Nationwide', () => {
  describe('#normalizeTransaction', () => {
    it('retains date for booked transaction', () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);

      const date = d.toISOString().split('T')[0];

      const transaction = {
        bookingDate: date,
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        true,
      );

      expect(normalizedTransaction?.date).toEqual(date);
    });

    it('clamps a future pending booking to the local calendar day', () => {
      const now = new Date(2026, 0, 15, 20, 0, 0);

      expect(pendingBookingDay('2099-01-01', now)).toBe('2026-01-15');
    });

    it('fixes date for pending transactions', () => {
      const d = new Date();
      const date = d.toISOString().split('T')[0];

      const transaction = {
        bookingDate: date,
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        false,
      );

      expect(
        new Date(normalizedTransaction?.date ?? '').getTime(),
      ).toBeLessThan(d.getTime());
    });

    it('does not throw for a pending transaction without a booking date', () => {
      const transaction = {
        valueDate: '2024-01-02',
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        false,
      );

      expect(normalizedTransaction?.date).toBe('2024-01-02');
    });

    it('drops a pending transaction that has no date at all', () => {
      const normalizedTransaction = Nationwide.normalizeTransaction(
        { transactionAmount: mockTransactionAmount },
        false,
      );

      expect(normalizedTransaction).toBeNull();
    });

    it('keeps transactionId if in the correct format', () => {
      const transactionId = 'a896729bb8b30b5ca862fe70bd5967185e2b5d3a';
      const transaction = {
        bookingDate: '2024-01-01T00:00:00Z',
        transactionId,
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        false,
      );

      expect(normalizedTransaction?.transactionId).toBe(transactionId);
    });

    it('unsets transactionId if not valid length', () => {
      const transaction = {
        bookingDate: '2024-01-01T00:00:00Z',
        transactionId: '0123456789',
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        false,
      );

      expect(normalizedTransaction?.transactionId).toBeUndefined();
    });

    it('unsets transactionId if debit placeholder found', () => {
      const transaction = {
        bookingDate: '2024-01-01T00:00:00Z',
        transactionId: '00DEBIT202401010000000000-1000SUPERMARKET',
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        false,
      );

      expect(normalizedTransaction?.transactionId).toBeUndefined();
    });

    it('unsets transactionId if credit placeholder found', () => {
      const transaction = {
        bookingDate: '2024-01-01T00:00:00Z',
        transactionId: '00CREDIT202401010000000000-1000SUPERMARKET',
        transactionAmount: mockTransactionAmount,
      };

      const normalizedTransaction = Nationwide.normalizeTransaction(
        transaction,
        false,
      );

      expect(normalizedTransaction?.transactionId).toBeUndefined();
    });
  });
});
