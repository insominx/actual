import { resolveMatches } from './query';

vi.mock('@actual-app/api', () => ({}));

const rows = [
  { id: 'a1', name: 'Grocery Store' },
  { id: 'a2', name: 'grocery store' },
  { id: 'a3', name: 'Groceries Plus' },
  { id: 'a4', name: 'Coffee' },
];

describe('entity lookup', () => {
  it('prefers an exact id', () => {
    expect(resolveMatches(rows, 'a4', 'name')).toMatchObject({
      status: 'unique',
      matchedBy: 'id',
      matches: [{ id: 'a4' }],
    });
  });

  it('reports case-insensitive exact name duplicates as ambiguous', () => {
    expect(resolveMatches(rows, ' GROCERY store ', 'name')).toMatchObject({
      status: 'ambiguous',
      matchedBy: 'exact-name',
      total: 2,
      matches: [{ id: 'a1' }, { id: 'a2' }],
    });
  });

  it('falls back to substring matches and reports none', () => {
    expect(resolveMatches(rows, 'plus', 'name')).toMatchObject({
      status: 'unique',
      matchedBy: 'partial-name',
    });
    expect(resolveMatches(rows, 'nothing', 'name')).toMatchObject({
      status: 'none',
      matchedBy: null,
      matches: [],
    });
  });

  it('uses the table name field and bounds the result', () => {
    const tags = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      tag: `tag-${i}`,
    }));
    const result = resolveMatches(tags, 'tag', 'tag');
    expect(result).toMatchObject({ total: 60, truncated: true });
    expect(result.matches).toHaveLength(50);
  });
});
