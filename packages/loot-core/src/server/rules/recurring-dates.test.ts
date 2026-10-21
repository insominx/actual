import { parseDate } from '#shared/months';
import { getNextDate } from '#shared/schedules';

import { parseRecurDate } from './rule-utils';

describe('recurring date fixes', () => {
  it('finds a weekend occurrence moved past the start date', () => {
    const cond = {
      op: 'isapprox',
      field: 'date',
      value: {
        start: '2024-01-15',
        frequency: 'monthly',
        skipWeekend: true,
        weekendSolveMode: 'after',
      },
    };
    expect(getNextDate(cond, parseDate('2024-06-16'))).toBe('2024-06-17');
    expect(getNextDate(cond, parseDate('2024-06-18'))).toBe('2024-07-15');
  });

  it('skips an occurrence moved back to a Friday before the start date', () => {
    const cond = {
      op: 'isapprox',
      field: 'date',
      value: {
        start: '2025-05-04',
        frequency: 'weekly',
        skipWeekend: true,
        weekendSolveMode: 'before',
      },
    };
    // Sunday June 1st moves back to Friday May 30th, which is in the past
    expect(getNextDate(cond, parseDate('2025-06-01'))).toBe('2025-06-06');
    expect(getNextDate(cond, parseDate('2025-05-30'))).toBe('2025-05-30');
  });

  it('counts occurrences across mixed monthly patterns once', () => {
    const { schedule } = parseRecurDate({
      start: '2024-01-01',
      frequency: 'monthly',
      patterns: [
        { type: 'day', value: 10 },
        { type: 'FR', value: 1 },
      ],
      endMode: 'after_n_occurrences',
      endOccurrences: 3,
    });
    const dates = schedule
      .occurrences({ take: 10 })
      .toArray()
      .map(o => o.date.toISOString().slice(0, 10));
    expect(dates).toEqual(['2024-01-05', '2024-01-10', '2024-02-02']);
  });
});
