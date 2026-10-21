import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';

import {
  performTransactionCategorization,
  prepareTransactionCategorization,
} from './guarded-categorize';
import {
  performTransactionClearing,
  prepareTransactionClearing,
} from './guarded-clear';

import { batchUpdateTransactions } from '.';

const documentDir = fs.join(__dirname, '../../mocks/files/budgets');
const budgetId = 'guarded-transfer-legs';
const budgetPath = fs.join(documentDir, budgetId);

type Leg = {
  id: string;
  notes: string | null;
  cleared: number;
  category: string | null;
  schedule: string | null;
};

function leg(id: string) {
  return db.first<Leg>(
    'SELECT id, notes, cleared, category, schedule FROM transactions WHERE id = ?',
    [id],
  );
}

// A transfer from an on-budget account to an off-budget account whose legs
// carry different notes, as a rule on the counterpart can leave them.
async function divergedTransfer() {
  const checking = await db.insertAccount({ name: 'Checking', offbudget: 0 });
  const savings = await db.insertAccount({ name: 'Savings', offbudget: 1 });
  await db.insertPayee({ name: '', transfer_acct: checking });
  const toSavings = await db.insertPayee({ name: '', transfer_acct: savings });
  const group = await db.insertCategoryGroup({ name: 'Group' });
  const category = await db.insertCategory({ name: 'Food', cat_group: group });
  const source = await db.insertTransaction({
    account: checking,
    date: '2026-09-01',
    amount: -500,
    notes: 'source note',
    cleared: false,
  });
  await batchUpdateTransactions({
    updated: [{ id: source, payee: toSavings }],
  });
  const counterpartId = (await db.first<{ transferred_id: string }>(
    'SELECT transferred_id FROM transactions WHERE id = ?',
    [source],
  ))!.transferred_id;
  expect(counterpartId).toBeTruthy();
  await db.updateTransaction({ id: counterpartId, notes: 'counterpart note' });
  return { source, counterpartId, category };
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  fs._setDocumentDir(documentDir);
  await fs.mkdir(budgetPath);
  await fs.writeFile(
    fs.join(budgetPath, 'metadata.json'),
    JSON.stringify({ id: budgetId, budgetName: 'Guarded Transfer Legs' }),
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

describe('guarded writes on a transfer leg', () => {
  it('clearing one leg leaves the counterpart untouched', async () => {
    const { source, counterpartId } = await divergedTransfer();
    const before = await leg(counterpartId);
    const proposal = await prepareTransactionClearing({
      ids: [source],
      cleared: true,
    });
    await performTransactionClearing(proposal);
    expect((await leg(source))?.cleared).toBe(1);
    expect(await leg(counterpartId)).toEqual(before);
  });

  it('categorizing one leg leaves the counterpart untouched', async () => {
    const { source, counterpartId, category } = await divergedTransfer();
    const before = await leg(counterpartId);
    const proposal = await prepareTransactionCategorization({
      ids: [source],
      category,
    });
    await performTransactionCategorization(proposal);
    expect((await leg(source))?.category).toBe(category);
    expect(await leg(counterpartId)).toEqual(before);
  });
});
