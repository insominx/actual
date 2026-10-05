import { q } from '#shared/query';

import { schema } from './schema';
import { describeQuerySchema, validateQuery } from './schema-metadata';

const FUNCTION_SAMPLES: Record<string, unknown> = {
  $sum: { $sum: '$amount' },
  $sumOver: { $sumOver: '$amount' },
  $count: { $count: '$id' },
  $substr: { $substr: ['$notes', 1, 2] },
  $lower: { $lower: '$notes' },
  $neg: { $neg: '$amount' },
  $abs: { $abs: '$amount' },
  $idiv: { $idiv: ['$amount', 100] },
  $id: { $id: '$amount' },
  $day: { $day: '$date' },
  $month: { $month: '$date' },
  $year: { $year: '$date' },
  $condition: { $condition: { amount: { $lt: 0 } } },
  $nocase: { $nocase: '$notes' },
  $literal: { $literal: 1 },
};

describe('query schema metadata', () => {
  test('describes every schema table and field from the core schema', () => {
    const metadata = describeQuerySchema();
    expect(metadata.tables.map(table => table.name)).toEqual(
      Object.keys(schema),
    );
    const transactions = metadata.tables.find(
      table => table.name === 'transactions',
    );
    expect(transactions?.fields.map(field => field.name)).toEqual(
      Object.keys(schema.transactions),
    );
    expect(
      transactions?.fields.find(field => field.name === 'account'),
    ).toEqual({ name: 'account', type: 'id', ref: 'accounts', required: true });
    expect(transactions?.fields.find(field => field.name === 'notes')).toEqual({
      name: 'notes',
      type: 'string',
      required: false,
    });
  });

  test('every advertised operator and function compiles', () => {
    const metadata = describeQuerySchema();
    for (const op of metadata.filterOperators) {
      const value =
        op === '$oneof' ? ['a'] : op === '$regexp' ? 'a.*' : 'value';
      expect(
        validateQuery(
          q('transactions')
            .filter({ notes: { [op]: value } })
            .serialize(),
        ),
      ).toMatchObject({ valid: true });
    }
    for (const op of metadata.logicalOperators) {
      expect(
        validateQuery(
          q('transactions')
            .filter({ [op]: [{ amount: { $lt: 0 } }, { notes: 'x' }] })
            .serialize(),
        ),
      ).toMatchObject({ valid: true });
    }
    expect(Object.keys(FUNCTION_SAMPLES).sort()).toEqual(
      [...metadata.functions].sort(),
    );
    for (const [name, expr] of Object.entries(FUNCTION_SAMPLES)) {
      const result = validateQuery(
        q('transactions')
          .select([{ value: expr }])
          .serialize(),
      );
      expect({ name, result }).toMatchObject({ name, result: { valid: true } });
    }
  });

  test('reports unsupported tables, fields, operators and functions without executing', () => {
    expect(validateQuery(q('missing').serialize())).toMatchObject({
      valid: false,
      table: 'missing',
    });
    expect(
      validateQuery(q('transactions').select(['nope']).serialize()),
    ).toMatchObject({ valid: false, table: 'transactions' });
    expect(
      validateQuery(
        q('transactions')
          .filter({ amount: { $between: [1, 2] } })
          .serialize(),
      ),
    ).toMatchObject({
      valid: false,
      message: expect.stringMatching(/operator/i),
    });
    expect(
      validateQuery(
        q('transactions')
          .select([{ x: { $median: '$amount' } }])
          .serialize(),
      ),
    ).toMatchObject({
      valid: false,
      message: expect.stringMatching(/function/i),
    });
    expect(
      validateQuery(
        q('transactions').filter({ 'payee.nope': 'x' }).serialize(),
      ),
    ).toMatchObject({ valid: false });
  });

  test('flags aggregate queries', () => {
    expect(
      validateQuery(
        q('transactions').calculate({ $sum: '$amount' }).serialize(),
      ),
    ).toMatchObject({ valid: true, aggregate: true });
    expect(
      validateQuery(
        q('transactions')
          .groupBy('category')
          .select(['category', { total: { $sum: '$amount' } }])
          .serialize(),
      ),
    ).toMatchObject({ valid: true, aggregate: true });
    expect(
      validateQuery(q('transactions').select(['id']).serialize()),
    ).toMatchObject({ valid: true, aggregate: false });
  });
});
