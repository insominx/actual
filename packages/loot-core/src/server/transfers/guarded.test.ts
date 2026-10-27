import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { guardedApply } from '#server/guarded-proposal';
import * as prefs from '#server/prefs';

import { performTransferCreate, prepareTransferCreate } from './guarded';

const documentDir = fs.join(__dirname, '../../mocks/files/budgets');
const budgetId = 'guarded-transfer-create';
const budgetPath = fs.join(documentDir, budgetId);

type Row = {
  id: string;
  acct: string;
  amount: number;
  date: number;
  category: string | null;
  transferred_id: string | null;
  description: string | null;
};

function row(id: string) {
  return db.first<Row>(
    'SELECT id, acct, amount, date, category, transferred_id, description FROM transactions WHERE id = ?',
    [id],
  );
}

const apply = guardedApply({
  operation: 'transfers.create',
  noun: 'Transfer creation',
  prepare: prepareTransferCreate,
  perform: performTransferCreate,
});

async function fixture() {
  const checking = await db.insertAccount({ name: 'Checking', offbudget: 0 });
  const savings = await db.insertAccount({ name: 'Savings', offbudget: 0 });
  const brokerage = await db.insertAccount({ name: 'Brokerage', offbudget: 1 });
  for (const acct of [checking, savings, brokerage]) {
    await db.insertPayee({ name: '', transfer_acct: acct });
  }
  const group = await db.insertCategoryGroup({ name: 'Group' });
  const food = await db.insertCategory({ name: 'Food', cat_group: group });
  const withdrawal = await db.insertTransaction({
    account: checking,
    date: '2026-10-29',
    amount: -110000,
    category: food,
    notes: 'to savings',
  });
  return { checking, savings, brokerage, food, withdrawal };
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  fs._setDocumentDir(documentDir);
  await fs.mkdir(budgetPath);
  await fs.writeFile(
    fs.join(budgetPath, 'metadata.json'),
    JSON.stringify({ id: budgetId, budgetName: 'Guarded Transfer Create' }),
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

describe('transfers.create', () => {
  it('previews the counterpart and creates and links it on apply', async () => {
    const { savings, withdrawal } = await fixture();
    const proposal = await prepareTransferCreate({
      id: withdrawal,
      account: savings,
    });
    expect(proposal.after).toMatchObject({
      classification: 'internal',
      categoryCleared: true,
      counterpart: {
        account: savings,
        amount: 110000,
        date: '2026-10-29',
        notes: 'to savings',
      },
    });

    const outcome = await apply(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    const source = await row(withdrawal);
    const counterpart = await row(source!.transferred_id!);
    expect(counterpart).toMatchObject({
      acct: savings,
      amount: 110000,
      date: 20261029,
      transferred_id: withdrawal,
    });
    // Both legs are on budget, so neither carries a category.
    expect(source!.category).toBeNull();
  });

  it('keeps the category on a transfer to an off-budget account', async () => {
    const { brokerage, food, withdrawal } = await fixture();
    const proposal = await prepareTransferCreate({
      id: withdrawal,
      account: brokerage,
    });
    expect(proposal.after.categoryCleared).toBe(false);
    await apply(proposal);
    expect((await row(withdrawal))!.category).toBe(food);
  });

  it('rejects a stale preview and an existing transfer', async () => {
    const { savings, brokerage, withdrawal } = await fixture();
    const proposal = await prepareTransferCreate({
      id: withdrawal,
      account: savings,
    });
    await apply(
      await prepareTransferCreate({ id: withdrawal, account: brokerage }),
    );
    expect(await apply(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    await expect(
      prepareTransferCreate({ id: withdrawal, account: savings }),
    ).rejects.toThrow('already a transfer');
  });

  it('validates the target', async () => {
    const { checking, withdrawal } = await fixture();
    await expect(
      prepareTransferCreate({ id: withdrawal, account: checking }),
    ).rejects.toThrow('own account');
    await expect(
      prepareTransferCreate({ id: withdrawal, account: 'missing' }),
    ).rejects.toThrow('Account does not exist');
    await expect(
      prepareTransferCreate({
        id: withdrawal,
        account: checking,
        extra: 1,
      } as never),
    ).rejects.toThrow('Invalid transfer create request');
  });
});
