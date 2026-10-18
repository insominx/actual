import { describe, expect, it } from 'vitest';

import { simplefinUnixSeconds } from './simplefin-date';

describe('simplefinUnixSeconds', () => {
  it('keeps a date-only start on that UTC day', () => {
    expect(simplefinUnixSeconds(new Date('2026-01-15'))).toBe(
      Date.parse('2026-01-15T00:00:00Z') / 1000,
    );
  });

  it('sends a local month boundary as the same calendar day in UTC', () => {
    expect(simplefinUnixSeconds(new Date(2026, 0, 15))).toBe(
      Date.UTC(2026, 0, 15) / 1000,
    );
  });
});
