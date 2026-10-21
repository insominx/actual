import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';

import { preparePayeeDeletion, preparePayeeMerge } from './guarded';

const documentDir = fs.join(__dirname, '../../mocks/files/budgets');
const budgetId = 'guarded-payee-references';
const budgetPath = fs.join(documentDir, budgetId);

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  fs._setDocumentDir(documentDir);
  await fs.mkdir(budgetPath);
  await fs.writeFile(
    fs.join(budgetPath, 'metadata.json'),
    JSON.stringify({ id: budgetId, budgetName: 'Guarded Payee References' }),
  );
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

describe('payee previews count transactions through earlier merges', () => {
  async function previouslyMerged() {
    const account = await db.insertAccount({ name: 'Checking', offbudget: 0 });
    const old = await db.insertPayee({ name: 'Old Shop' });
    const shop = await db.insertPayee({ name: 'Shop' });
    const target = await db.insertPayee({ name: 'Store' });
    for (const payee of [old, old, shop]) {
      await db.insertTransaction({
        account,
        date: '2026-09-01',
        amount: -100,
        payee,
      });
    }
    // The two "Old Shop" rows keep their stored payee id and now resolve to
    // "Shop" through the mapping.
    await db.mergePayees(shop, [old]);
    return { shop, target };
  }

  it('merge preview counts rows that resolve to the merged payee', async () => {
    const { shop, target } = await previouslyMerged();
    const proposal = await preparePayeeMerge({
      targetId: target,
      mergeIds: [shop],
    });
    expect(proposal.references).toMatchObject({ referencingTransactions: 3 });
  });

  it('deletion preview counts rows that resolve to the payee', async () => {
    const { shop } = await previouslyMerged();
    const proposal = await preparePayeeDeletion({ id: shop });
    expect(proposal.references).toMatchObject({ referencingTransactions: 3 });
  });
});
