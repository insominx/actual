import { describe, expect, it } from 'vitest';

import { parseEditedTransactionDate } from './editedTransactionDate';

describe('parseEditedTransactionDate', () => {
  it('keeps dates from the engine floor through 2000', () => {
    expect(parseEditedTransactionDate('1995-01-01', 'yyyy-MM-dd')).toBe(
      '1995-01-01',
    );
    expect(parseEditedTransactionDate('1999-06-15', 'yyyy-MM-dd')).toBe(
      '1999-06-15',
    );
    expect(parseEditedTransactionDate('2000-01-01', 'yyyy-MM-dd')).toBe(
      '2000-01-01',
    );
  });

  it('rejects dates before 1995 and a truncated year', () => {
    expect(parseEditedTransactionDate('1994-12-31', 'yyyy-MM-dd')).toBeNull();
    expect(parseEditedTransactionDate('01/15/201', 'MM/dd/yyyy')).toBeNull();
  });
});
