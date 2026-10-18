import { format, getMonth } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { parseReportRangeDate } from './DateRange';

describe('parseReportRangeDate', () => {
  it('keeps the first of the month in that month', () => {
    const date = parseReportRangeDate('2017-01-01');

    expect(date).not.toBeNull();
    expect(getMonth(date!)).toBe(0);
    expect(format(date!, 'MMM yyyy')).toBe('Jan 2017');
  });

  it('rejects a value that is not a calendar date', () => {
    expect(parseReportRangeDate('not-a-date')).toBeNull();
    expect(parseReportRangeDate('')).toBeNull();
  });
});
