import { describe, expect, it } from 'vitest';

import { nzDayStart } from './nz-time';

describe('nzDayStart', () => {
  it('starts a summer day at New Zealand midnight, not UTC midnight', () => {
    const start = nzDayStart('2026-01-15');

    expect(start.toISOString()).toBe('2026-01-14T11:00:00.000Z');
    expect(new Date('2026-01-14T11:30:00.000Z').getTime()).toBeGreaterThan(
      start.getTime(),
    );
    expect(new Date('2026-01-14T10:00:00.000Z').getTime()).toBeLessThan(
      start.getTime(),
    );
  });

  it('starts a winter day at New Zealand standard midnight', () => {
    expect(nzDayStart('2026-07-15').toISOString()).toBe(
      '2026-07-14T12:00:00.000Z',
    );
  });
});
