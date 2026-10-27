import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { guardedApply } from '#server/guarded-proposal';
import * as prefs from '#server/prefs';
import * as sheet from '#server/sheet';

import { isTrackingBudget } from './actions';
import { createAllBudgets, getBudgetType } from './base';
import { performBudgetType, prepareBudgetType } from './guarded-type';

const documentDir = fs.join(__dirname, '../../mocks/files/budgets');
const budgetId = 'guarded-budget-type';
const budgetPath = fs.join(documentDir, budgetId);

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  fs._setDocumentDir(documentDir);
  await fs.mkdir(budgetPath);
  await fs.writeFile(
    fs.join(budgetPath, 'metadata.json'),
    JSON.stringify({ id: budgetId, budgetName: 'Guarded Budget Type' }),
  );
  prefs.unloadPrefs();
  await prefs.loadPrefs(budgetId);
  await sheet.loadSpreadsheet(db);
  await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({ id: 'cat1', name: 'Rent', cat_group: 'group1' });
  await db.insertAccount({ id: 'acct1', name: 'Checking', offbudget: 0 });
  await db.insertTransaction({
    date: '2026-09-15',
    amount: -5000,
    account: 'acct1',
    category: 'cat1',
  });
  await createAllBudgets();
});

afterEach(async () => {
  prefs.unloadPrefs();
  fs._setDocumentDir(null);
  if (await fs.exists(budgetPath)) {
    await fs.removeDirRecursively(budgetPath);
  }
});

const apply = guardedApply({
  operation: 'budgets.set-type',
  noun: 'Budget type change',
  prepare: prepareBudgetType,
  perform: performBudgetType,
});

describe('budgets.set-type', () => {
  it('rejects anything but a type of envelope or tracking', async () => {
    for (const request of [
      { type: 'rollover' },
      { type: 'tracking', extra: 1 },
      {},
      null,
    ]) {
      await expect(prepareBudgetType(request as never)).rejects.toThrow(
        'Invalid budget type request',
      );
    }
  });

  it('previews and applies a switch from envelope to tracking', async () => {
    await db.insert('zero_budgets', {
      id: '202609-cat1',
      month: 202609,
      category: 'cat1',
      amount: 5000,
    });
    const proposal = await prepareBudgetType({ type: 'tracking' });
    expect(proposal.before.type).toBe('envelope');
    expect(proposal.after).toEqual({ type: 'tracking', willWrite: true });
    expect(proposal.references).toEqual({
      table: 'reflect_budgets',
      budgetedMonths: { envelope: 1, tracking: 0 },
    });

    const outcome = await apply(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    expect(isTrackingBudget()).toBe(true);
    expect(getBudgetType()).toBe('tracking');
    // Tracking shows its own (empty) amounts, not the envelope ones.
    await sheet.waitOnSpreadsheet();
    // No tracking amount is stored for the month, so the cell holds no value.
    expect(sheet.getCellValue('budget202609', 'budget-cat1') ?? 0).toBe(0);

    // The receipt's preview is now stale: the stored type changed.
    expect(await apply(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });

  it('is a no-op when the budget already has the requested type', async () => {
    const proposal = await prepareBudgetType({ type: 'envelope' });
    expect(proposal.after.willWrite).toBe(false);
    expect(proposal.sideEffects).toEqual([]);
    expect(await apply(proposal)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
    expect(getBudgetType()).toBe('envelope');
  });

  it('switches back to envelope and shows the envelope amounts again', async () => {
    await db.insert('zero_budgets', {
      id: '202609-cat1',
      month: 202609,
      category: 'cat1',
      amount: 5000,
    });
    await apply(await prepareBudgetType({ type: 'tracking' }));
    const outcome = await apply(await prepareBudgetType({ type: 'envelope' }));
    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    expect(isTrackingBudget()).toBe(false);
    expect(getBudgetType()).toBe('envelope');
    await sheet.waitOnSpreadsheet();
    expect(sheet.getCellValue('budget202609', 'budget-cat1')).toBe(5000);
  });
});
