import { theme } from '@actual-app/components/theme';
import { setNumberFormat } from '@actual-app/core/shared/util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeBalanceAmountStyle } from './util';

describe('makeBalanceAmountStyle', () => {
  afterEach(() => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
  });

  it('treats dollars that hide cents as the same displayed amount', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });

    expect(makeBalanceAmountStyle(0, 1_249, 1_234, 'USD').color).toBe(
      theme.templateNumberFunded,
    );
  });

  it('keeps whole-unit currencies distinct when cents are hidden', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });

    expect(makeBalanceAmountStyle(0, 1_249, 1_234, 'JPY').color).toBe(
      theme.templateNumberUnderFunded,
    );
    expect(makeBalanceAmountStyle(0, 100, 50, 'JPY').color).toBe(
      theme.templateNumberUnderFunded,
    );
  });
});
