import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory, createCategoryGroup } from './app';

beforeEach(global.emptyDatabase());

describe('category names', () => {
  it('rejects empty and whitespace-only category names', async () => {
    const groupId = await createCategoryGroup({ name: 'Bills' });
    await expect(createCategory({ name: '', groupId })).rejects.toThrow(
      'name is required',
    );
    await expect(createCategory({ name: '   ', groupId })).rejects.toThrow(
      'name is required',
    );
  });
});
