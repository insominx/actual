import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';

import { createFilter, updateFilter } from './app';

beforeEach(global.emptyDatabase());

const state = (name: string) => ({
  state: {
    id: 'filter-1',
    name,
    conditionsOp: 'and',
    conditions: [{ field: 'notes', op: 'contains', value: 'x' }],
  },
  filters: [],
});

describe('filter names', () => {
  it('rejects empty and whitespace-only names on create', async () => {
    await expect(createFilter(state(''))).rejects.toThrow(
      'Filter name is required',
    );
    await expect(createFilter(state('   '))).rejects.toThrow(
      'Filter name is required',
    );
  });

  it('saves a trimmed name and checks duplicates against it', async () => {
    const id = await createFilter(state('  Rent '));

    const row = await db.first<{ name: string }>(
      'SELECT name FROM transaction_filters WHERE id = ?',
      [id],
    );
    expect(row?.name).toBe('Rent');

    await expect(createFilter(state(' Rent'))).rejects.toThrow(
      'There is already a filter named Rent',
    );
  });

  it('rejects whitespace-only names on update', async () => {
    await expect(updateFilter(state('  '))).rejects.toThrow(
      'Filter name is required',
    );
  });
});
