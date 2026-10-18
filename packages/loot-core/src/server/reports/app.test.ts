import { beforeEach, describe, expect, it } from 'vitest';

import type { CustomReportEntity } from '#types/models';

import { createReport, updateReport } from './app';

beforeEach(global.emptyDatabase());

describe('report names', () => {
  it('rejects empty and whitespace-only names on create', async () => {
    await expect(
      createReport({ name: '' } as CustomReportEntity),
    ).rejects.toThrow('Report name is required');
    await expect(
      createReport({ name: '   ' } as CustomReportEntity),
    ).rejects.toThrow('Report name is required');
  });

  it('rejects whitespace-only names on update', async () => {
    await expect(
      updateReport({ id: 'some-id', name: '  ' } as CustomReportEntity),
    ).rejects.toThrow('Report name is required');
  });
});
