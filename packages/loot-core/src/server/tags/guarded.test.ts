import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';

import { performTagCreation, prepareTagCreation } from './guarded';

const documentDir = fs.join(__dirname, '../../mocks/files/budgets');
const budgetId = 'tag-empty-color';
const budgetPath = fs.join(documentDir, budgetId);

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();

  fs._setDocumentDir(documentDir);
  await fs.mkdir(budgetPath);
  await fs.writeFile(
    fs.join(budgetPath, 'metadata.json'),
    JSON.stringify({ id: budgetId, budgetName: 'Tag Empty Color' }),
  );
  // Prefer an explicit id so inspectCopySource reads this fixture.
  prefs.unloadPrefs();
  await prefs.loadPrefs(budgetId);
});

afterEach(async () => {
  prefs.unloadPrefs();
  fs._setDocumentDir(null);
  if (await fs.exists(budgetPath)) {
    await fs.removeDirRecursively(budgetPath);
  }
});

describe('prepareTagCreation', () => {
  it('plans null color for empty string and completes create fully', async () => {
    const proposal = await prepareTagCreation({
      tag: 'EmptyColor',
      color: '',
      description: null,
    });

    expect(proposal.after.action).toBe('insert');
    expect(proposal.after.tag).toMatchObject({
      tag: 'EmptyColor',
      color: null,
      description: null,
      tombstone: 0,
    });

    const result = await performTagCreation(proposal);

    expect(result).toEqual({
      changed: true,
      affectedIds: [expect.any(String)],
      tagCreation: { tagId: expect.any(String), action: 'insert' },
    });

    const row = await db.first<{ color: string | null; tag: string }>(
      'SELECT tag, color FROM tags WHERE id = ?',
      [result.tagCreation.tagId],
    );
    expect(row).toEqual({ tag: 'EmptyColor', color: null });
  });
});
