import { describe, expect, it } from 'vitest';

import { reportAmountUnit } from './ledger-reports';

describe('reportAmountUnit', () => {
  it('reports integer cents in every currency', () => {
    expect(reportAmountUnit()).toBe('integer cents');
  });
});
