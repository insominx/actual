import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';

import {
  assertPlannableTransactionRows,
  assertPlannedCategories,
} from './guarded-rows';

let onBudget: string;
let offBudget: string;
let category: string;
let deletedCategory: string;
let payee: string;
let transferPayee: string;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  onBudget = await db.insertAccount({ name: 'Checking', offbudget: 0 });
  offBudget = await db.insertAccount({ name: 'Equity', offbudget: 1 });
  const group = await db.insertCategoryGroup({ name: 'Group' });
  category = await db.insertCategory({ name: 'Food', cat_group: group });
  deletedCategory = await db.insertCategory({ name: 'Old', cat_group: group });
  await db.deleteCategory({ id: deletedCategory }, undefined);
  payee = await db.insertPayee({ name: 'Shop' });
  transferPayee = await db.insertPayee({
    name: 'Transfer: Equity',
    transfer_acct: offBudget,
  });
});

const base = { date: '2026-09-01', amount: -100 };
const strict = { allowTransferPayees: false };

describe('assertPlannableTransactionRows', () => {
  it('accepts well-formed rows', async () => {
    await expect(
      assertPlannableTransactionRows(
        onBudget,
        [{ ...base, category, payee }],
        strict,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      'unknown category',
      () => ({ category: 'nope' }),
      'category does not exist',
    ],
    [
      'deleted category',
      () => ({ category: deletedCategory }),
      'category does not exist',
    ],
    ['unknown payee', () => ({ payee: 'nope' }), 'payee does not exist'],
    ['date before 1995', () => ({ date: '1994-12-31' }), 'date must be'],
    ['impossible date', () => ({ date: '2026-02-30' }), 'date must be'],
    [
      'amount beyond the engine limit',
      () => ({ amount: 2 ** 52 }),
      'engine limit',
    ],
    [
      'split child beyond the engine limit',
      () => ({
        amount: 2 ** 52,
        subtransactions: [{ amount: 2 ** 52 }],
      }),
      'engine limit',
    ],
    ['forged transfer link', () => ({ transfer_id: 'abc' }), 'transfer_id'],
    [
      'unbalanced split',
      () => ({
        subtransactions: [{ amount: -60 }, { amount: -60 }],
      }),
      'add up',
    ],
    [
      'unknown split category',
      () => ({
        subtransactions: [{ amount: -60, category: 'nope' }, { amount: -40 }],
      }),
      'category does not exist',
    ],
  ])('rejects %s before any plan exists', async (_name, extra, message) => {
    await expect(
      assertPlannableTransactionRows(
        onBudget,
        [{ ...base, ...extra() }],
        strict,
      ),
    ).rejects.toThrow(message);
  });

  it('rejects a category on an off-budget account', async () => {
    await expect(
      assertPlannableTransactionRows(
        offBudget,
        [{ ...base, category }],
        strict,
      ),
    ).rejects.toThrow('off-budget');
  });

  it('allows transfer payees only where transfers are linked', async () => {
    await expect(
      assertPlannableTransactionRows(
        onBudget,
        [{ ...base, payee: transferPayee }],
        strict,
      ),
    ).rejects.toThrow('transfer payee');
    await expect(
      assertPlannableTransactionRows(
        onBudget,
        [{ ...base, payee: transferPayee }],
        { allowTransferPayees: true },
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts a balanced split', async () => {
    await expect(
      assertPlannableTransactionRows(
        onBudget,
        [
          {
            ...base,
            subtransactions: [{ amount: -60, category }, { amount: -40 }],
          },
        ],
        strict,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('assertPlannedCategories', () => {
  it('accepts uncategorized and live categories', async () => {
    await expect(
      assertPlannedCategories([{ category }, { category: null }, {}]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['unknown', () => 'nope'],
    ['deleted', () => deletedCategory],
  ])('refuses a rule-set %s category', async (_label, pick) => {
    await expect(
      assertPlannedCategories([{ category }, { category: pick() }]),
    ).rejects.toThrow('rule would set a category that does not exist');
  });
});
