import { matchesAccountCondition } from './forecast-accounts';

describe('matchesAccountCondition matches', () => {
  const account = { id: 'a1', name: 'Savings Account', offbudget: 0 as const };

  it('matches case-insensitively', () => {
    expect(
      matchesAccountCondition(account, {
        field: 'account',
        op: 'matches',
        value: 'Sav.*',
      }),
    ).toBe(true);
    expect(
      matchesAccountCondition(account, {
        field: 'account',
        op: 'matches',
        value: 'savings',
      }),
    ).toBe(true);
  });

  it('does not match unrelated names and tolerates invalid patterns', () => {
    expect(
      matchesAccountCondition(account, {
        field: 'account',
        op: 'matches',
        value: 'Checking',
      }),
    ).toBe(false);
    expect(
      matchesAccountCondition(account, {
        field: 'account',
        op: 'matches',
        value: '(',
      }),
    ).toBe(false);
  });
});
