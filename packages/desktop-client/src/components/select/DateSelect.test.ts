import { describe, expect, it } from 'vitest';

import { parseTypedDate } from './DateSelect';

describe('parseTypedDate', () => {
  it('parses a full date', () => {
    expect(parseTypedDate('1/5/2024', 'MM/dd/yyyy')).toEqual({
      date: '2024-01-05',
      displayValue: '1/5/2024',
    });
  });

  it('parses a two-digit year', () => {
    expect(parseTypedDate('1/5/24', 'MM/dd/yyyy')).toEqual({
      date: '2024-01-05',
      displayValue: '01/05/2024',
    });
  });

  it('rejects a partially typed year', () => {
    expect(parseTypedDate('1/5/202', 'MM/dd/yyyy')).toBeNull();
    expect(parseTypedDate('1/5/2', 'MM/dd/yyyy')).toBeNull();
    expect(parseTypedDate('05.01.202', 'dd.MM.yyyy')).toBeNull();
  });

  it('rejects dates before the minimum the server accepts', () => {
    expect(parseTypedDate('12/31/1994', 'MM/dd/yyyy')).toBeNull();
    expect(parseTypedDate('1/1/1995', 'MM/dd/yyyy')).toEqual({
      date: '1995-01-01',
      displayValue: '1/1/1995',
    });
  });
});
