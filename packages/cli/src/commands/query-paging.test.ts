import { decodeCursor, encodeCursor, planPage } from './query';

vi.mock('@actual-app/api', () => ({}));

type State = {
  table: string;
  orderExpressions: unknown[];
  limit: number | null;
  offset: number | null;
  filterExpressions: unknown[];
};

class FakeQuery {
  constructor(readonly state: State) {}
  serialize() {
    return this.state;
  }
  orderBy(expr: unknown) {
    return new FakeQuery({
      ...this.state,
      orderExpressions: [...this.state.orderExpressions, expr],
    });
  }
  limit(limit: number) {
    return new FakeQuery({ ...this.state, limit });
  }
  offset(offset: number) {
    return new FakeQuery({ ...this.state, offset });
  }
}

function query(partial: Partial<State> = {}) {
  return new FakeQuery({
    table: 'transactions',
    orderExpressions: [{ date: 'desc' }],
    limit: null,
    offset: null,
    filterExpressions: [],
    ...partial,
  }) as never;
}

describe('version 2 query paging', () => {
  it('bounds the page, adds an id tie-breaker and fetches one extra row', () => {
    const page = planPage(query({ limit: 2 }), {
      aggregate: false,
      hasIdField: true,
    });
    expect(page.tieBreaker).toBe('id');
    expect(page.orderBy).toEqual([{ date: 'desc' }, { id: 'asc' }]);
    expect(page.limit).toBe(2);
    expect(page.query.serialize()).toMatchObject({ limit: 3, offset: 0 });
  });

  it('uses the default limit and keeps an explicit id order', () => {
    const page = planPage(query({ orderExpressions: ['id'] }), {
      aggregate: false,
      hasIdField: true,
    });
    expect(page.tieBreaker).toBeNull();
    expect(page.limit).toBe(1000);
  });

  it('does not add a tie-breaker to aggregate queries', () => {
    const page = planPage(query(), { aggregate: true, hasIdField: true });
    expect(page.tieBreaker).toBeNull();
    expect(page.orderBy).toEqual([{ date: 'desc' }]);
  });

  it('continues from a cursor bound to the same query', () => {
    const first = planPage(query({ limit: 2 }), {
      aggregate: false,
      hasIdField: true,
    });
    const token = encodeCursor({ v: 1, q: first.hash, o: 2, s: '3:x' });
    const next = planPage(query({ limit: 2 }), {
      aggregate: false,
      hasIdField: true,
      cursor: token,
    });
    expect(next.offset).toBe(2);
    expect(next.cursor?.s).toBe('3:x');
    expect(() =>
      planPage(query({ limit: 2, filterExpressions: [{ amount: 1 }] }), {
        aggregate: false,
        hasIdField: true,
        cursor: token,
      }),
    ).toThrow('different query');
    expect(() =>
      planPage(query({ limit: 2, offset: 4 }), {
        aggregate: false,
        hasIdField: true,
        cursor: token,
      }),
    ).toThrow('offset');
  });

  it('rejects malformed cursors and out-of-range limits', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow('cursor');
    expect(() =>
      planPage(query({ limit: 20000 }), { aggregate: false, hasIdField: true }),
    ).toThrow('between 1 and');
  });
});
