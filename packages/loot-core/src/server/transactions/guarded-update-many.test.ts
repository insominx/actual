import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { guardedApply } from '#server/guarded-proposal';
import * as prefs from '#server/prefs';

import {
  performTransactionUpdateMany,
  prepareTransactionUpdateMany,
} from './guarded-update-many';

import { batchUpdateTransactions } from '.';

const documentDir = fs.join(__dirname, '../../mocks/files/budgets');
const budgetId = 'guarded-update-many';
const budgetPath = fs.join(documentDir, budgetId);

type Row = {
  notes: string | null;
  category: string | null;
  description: string | null;
  cleared: number;
  amount: number;
};

function row(id: string) {
  return db.first<Row>(
    'SELECT notes, category, description, cleared, amount FROM transactions WHERE id = ?',
    [id],
  );
}

const apply = guardedApply({
  operation: 'transactions.update-many',
  noun: 'Transaction batch update',
  prepare: prepareTransactionUpdateMany,
  perform: performTransactionUpdateMany,
});

async function fixture() {
  const checking = await db.insertAccount({ name: 'Checking', offbudget: 0 });
  const brokerage = await db.insertAccount({ name: 'Brokerage', offbudget: 1 });
  const group = await db.insertCategoryGroup({ name: 'Group' });
  const food = await db.insertCategory({ name: 'Food', cat_group: group });
  const shop = await db.insertPayee({ name: 'Shop' });
  const a = await db.insertTransaction({
    account: checking,
    date: '2026-09-01',
    amount: -500,
    notes: 'old',
  });
  const b = await db.insertTransaction({
    account: checking,
    date: '2026-09-02',
    amount: -700,
    cleared: false,
  });
  const off = await db.insertTransaction({
    account: brokerage,
    date: '2026-09-03',
    amount: 900,
  });
  return { checking, brokerage, food, shop, a, b, off };
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  fs._setDocumentDir(documentDir);
  await fs.mkdir(budgetPath);
  await fs.writeFile(
    fs.join(budgetPath, 'metadata.json'),
    JSON.stringify({ id: budgetId, budgetName: 'Guarded Update Many' }),
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

describe('transactions.update-many', () => {
  it('applies different fields to each row and leaves amounts alone', async () => {
    const { food, shop, a, b } = await fixture();
    const proposal = await prepareTransactionUpdateMany({
      rows: [
        { id: a, notes: 'new note', category: food },
        { id: b, payee: shop, cleared: true },
      ],
    });
    expect(proposal.after.changedIds.sort()).toEqual([a, b].sort());
    expect(proposal.sideEffects[0]).toContain(
      'notes: 1, category: 1, payee: 1, cleared: 1',
    );

    expect(await apply(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    expect(await row(a)).toMatchObject({
      notes: 'new note',
      category: food,
      amount: -500,
    });
    expect(await row(b)).toMatchObject({
      description: shop,
      cleared: 1,
      amount: -700,
    });
  });

  it('reports rows that already match as unchanged', async () => {
    const { a } = await fixture();
    const proposal = await prepareTransactionUpdateMany({
      rows: [{ id: a, notes: 'old' }],
    });
    expect(proposal.after).toMatchObject({ changedIds: [], unchangedIds: [a] });
    expect(await apply(proposal)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
  });

  it('clears notes with null', async () => {
    const { a } = await fixture();
    await apply(
      await prepareTransactionUpdateMany({ rows: [{ id: a, notes: null }] }),
    );
    expect((await row(a))?.notes).toBeNull();
  });

  it('rejects a stale preview after the row changes', async () => {
    const { a } = await fixture();
    const proposal = await prepareTransactionUpdateMany({
      rows: [{ id: a, notes: 'x' }],
    });
    await batchUpdateTransactions({
      updated: [{ id: a, notes: 'changed elsewhere' }],
    });
    expect(await apply(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });

  it('refuses reconciled rows unless allowed', async () => {
    const { a } = await fixture();
    await db.updateTransaction({ id: a, reconciled: true });
    await expect(
      prepareTransactionUpdateMany({ rows: [{ id: a, notes: 'x' }] }),
    ).rejects.toThrow('reconciled');
    const proposal = await prepareTransactionUpdateMany({
      rows: [{ id: a, notes: 'x' }],
      allowReconciled: true,
    });
    expect(proposal.after.reconciledIds).toEqual([a]);
  });

  it('validates rows before touching the budget', async () => {
    const { food, a, off } = await fixture();
    const cases: Array<[unknown, string]> = [
      [{ rows: [] }, 'non-empty'],
      [{ rows: [{ id: a }] }, 'must set one or more'],
      [{ rows: [{ id: a, amount: 1 }] }, 'must set one or more'],
      [
        {
          rows: [
            { id: a, notes: 'x' },
            { id: a, notes: 'y' },
          ],
        },
        'appears twice',
      ],
      [{ rows: [{ id: a, cleared: 'yes' }] }, 'cleared'],
      [{ rows: [{ id: 'missing', notes: 'x' }] }, 'does not exist'],
      [{ rows: [{ id: off, category: food }] }, 'off-budget'],
      [{ rows: [{ id: a, payee: 'missing' }] }, 'Payee does not exist'],
    ];
    for (const [request, message] of cases) {
      await expect(
        prepareTransactionUpdateMany(request as never),
      ).rejects.toThrow(message);
    }
  });
});
