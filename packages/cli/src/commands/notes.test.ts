import { noteIdFromOptions } from './notes';

vi.mock('@actual-app/api', () => ({}));

describe('noteIdFromOptions', () => {
  it('maps each target flag onto the UI note ID convention', () => {
    expect(noteIdFromOptions('raw-id', {})).toBe('raw-id');
    expect(noteIdFromOptions(undefined, { account: 'a1' })).toBe('account-a1');
    expect(noteIdFromOptions(undefined, { group: 'g1' })).toBe('g1');
    expect(noteIdFromOptions(undefined, { category: 'c1' })).toBe('c1');
    expect(
      noteIdFromOptions(undefined, { category: 'c1', month: '2026-10' }),
    ).toBe('c1-2026-10');
    expect(noteIdFromOptions(undefined, { month: '2026-10' })).toBe(
      'budget-2026-10',
    );
  });

  it('rejects zero, several or malformed targets', () => {
    for (const [raw, options] of [
      [undefined, {}],
      ['raw', { account: 'a1' }],
      [undefined, { account: 'a1', group: 'g1' }],
      [undefined, { account: 'a1', month: '2026-10' }],
      ['raw', { month: '2026-10' }],
      [undefined, { month: '2026-13' }],
      [undefined, { category: 'c1', month: '26-10' }],
      ['  ', {}],
    ] as const) {
      expect(() => noteIdFromOptions(raw, options)).toThrow();
    }
  });
});
