import { describe, expect, it } from 'vitest';

import { syncRangeEnd } from './sync-range';

describe('syncRangeEnd', () => {
  it('ends on the next UTC date so a local morning is still included', () => {
    expect(syncRangeEnd(new Date('2026-01-14T12:00:00Z'))).toBe('2026-01-15');
    expect(syncRangeEnd(new Date('2026-01-15T22:00:00Z'))).toBe('2026-01-16');
  });
});
