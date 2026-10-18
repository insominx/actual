import { beforeEach, describe, expect, it } from 'vitest';

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

  it('rejects whitespace-only names on update', async () => {
    await expect(updateFilter(state('  '))).rejects.toThrow(
      'Filter name is required',
    );
  });
});
