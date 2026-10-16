import '#server/main';
import { strictCashPlanningConfig } from './plan';

const base = { startDate: '2026-01-01', endDate: '2026-06-30' };
const asOf = '2026-10-16';

describe('strictCashPlanningConfig', () => {
  it('accepts integer cent targets up to the engine limit', () => {
    const config = strictCashPlanningConfig(
      { ...base, categoryTargets: { a: 0, b: 2 ** 51 - 1 } },
      asOf,
    );
    expect(config.categoryTargets).toEqual({ a: 0, b: 2 ** 51 - 1 });
  });

  it.each([10.5, 0.1, -1, 2 ** 51, 2 ** 53, 1e300, Infinity, NaN, '5', null])(
    'rejects the target %s',
    amount => {
      expect(() =>
        strictCashPlanningConfig(
          { ...base, categoryTargets: { a: amount } },
          asOf,
        ),
      ).toThrow('Invalid cash plan');
    },
  );

  it.each([0.5, 2 ** 51, 2 ** 53, Infinity])(
    'rejects the goal balance %s',
    balance => {
      expect(() =>
        strictCashPlanningConfig(
          { ...base, categoryTargets: {}, goal: { balance } },
          asOf,
        ),
      ).toThrow('Invalid cash plan');
    },
  );
});
