import { describe, expect, it } from 'vitest';

import { changeSplitAmountMethod } from './RuleEditor';

describe('changeSplitAmountMethod', () => {
  it('clears the value when the allocation method changes', () => {
    const action = {
      op: 'set-split-amount',
      value: 5000,
      options: { method: 'fixed-amount', splitIndex: 1 },
      inputKey: 'a',
    };

    const next = changeSplitAmountMethod(action, 'fixed-percent');

    expect(next).toMatchObject({
      value: null,
      options: { method: 'fixed-percent', splitIndex: 1 },
    });
    // remount the input so it doesn't keep showing the old amount
    expect(next.inputKey).not.toBe('a');
  });

  it('keeps the value when the same method is picked again', () => {
    const action = {
      op: 'set-split-amount',
      value: 50,
      options: { method: 'fixed-percent', splitIndex: 1 },
      inputKey: 'a',
    };

    expect(changeSplitAmountMethod(action, 'fixed-percent')).toBe(action);
  });
});
