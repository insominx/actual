import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The inspector's preference catalog initializes the app. Load the server
// entry first so that happens after main has finished wiring handlers.
import '#server/main';
import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { guardedApply } from '#server/guarded-proposal';
import * as prefs from '#server/prefs';

import { performFileImport, prepareFileImport } from './guarded-file-import';

const { emptyDatabase } = global as typeof globalThis & {
  emptyDatabase: () => () => Promise<void>;
};

const documentDir = fs.join(__dirname, '../../../mocks/files/budgets');
const budgetId = 'guarded-file-import';
const budgetPath = fs.join(documentDir, budgetId);

describe('prepareFileImport reimportDeleted default', () => {
  let dir = '';
  let path = '';

  beforeEach(async () => {
    await emptyDatabase()();
    // Guarded proposals record the open budget's identity
    fs._setDocumentDir(documentDir);
    await fs.mkdir(budgetPath);
    await fs.writeFile(
      fs.join(budgetPath, 'metadata.json'),
      JSON.stringify({ id: budgetId, budgetName: 'Guarded File Import' }),
    );
    prefs.unloadPrefs();
    await prefs.loadPrefs(budgetId);
    await db.insertAccount({ id: 'acct', name: 'Checking' });
    dir = await mkdtemp(join(tmpdir(), 'actual-guarded-import-'));
    path = join(dir, 'statement.csv');
    await writeFile(path, 'Date,Payee,Amount\n2024-01-15,Shop,-10.00\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    prefs.unloadPrefs();
    fs._setDocumentDir(null);
    if (await fs.exists(budgetPath)) {
      await fs.removeDirRecursively(budgetPath);
    }
  });

  function prepare(
    extra: { maxFuzzyDayGap?: number; updateMatched?: boolean } = {},
  ) {
    return prepareFileImport({
      ...extra,
      path,
      accountId: 'acct',
      settings: {
        dateFormat: 'yyyy mm dd',
        fields: { date: 'Date', amount: 'Amount', payee: 'Payee' },
      },
    });
  }

  it("follows the import dialog's per-account preference", async () => {
    db.runQuery(`INSERT INTO preferences (id, value) VALUES (?, 'false')`, [
      'import-reimport-deleted-acct',
    ]);

    const proposal = await prepare();

    expect(proposal.after.options.reimportDeleted).toBe(false);
  });

  it('ignores the bank sync preference', async () => {
    db.runQuery(`INSERT INTO preferences (id, value) VALUES (?, 'false')`, [
      'sync-reimport-deleted-acct',
    ]);

    const proposal = await prepare();

    expect(proposal.after.options.reimportDeleted).toBe(true);
  });

  it('reports the day gap of a fuzzy match to another day', async () => {
    // The same weekly transfer five days later, already imported and reconciled.
    await db.insertTransaction({
      id: 'next-week',
      account: 'acct',
      amount: -1000,
      date: '2024-01-20',
      imported_id: 'bank-1',
      reconciled: true,
    });

    const proposal = await prepare();

    expect(proposal.after.rows).toEqual([
      {
        index: 0,
        outcome: 'reconciled',
        match: { kind: 'date_amount', transactionId: 'next-week', dayGap: 5 },
      },
    ]);
  });

  it('omits the day gap when the fuzzy match is on the same day', async () => {
    await db.insertTransaction({
      id: 'same-day',
      account: 'acct',
      amount: -1000,
      date: '2024-01-15',
    });

    const proposal = await prepare();

    expect(proposal.after.rows[0].match).toEqual({
      kind: 'date_amount',
      transactionId: 'same-day',
    });
  });

  it('adds a row whose fuzzy match is farther than maxFuzzyDayGap', async () => {
    // Last week's identical transfer must not swallow this week's row.
    await db.insertTransaction({
      id: 'last-week',
      account: 'acct',
      amount: -1000,
      date: '2024-01-10',
    });

    const proposal = await prepare({ maxFuzzyDayGap: 3 });

    expect(proposal.after.rows[0]).toEqual({
      index: 0,
      outcome: 'add',
      match: {
        kind: 'date_amount',
        transactionId: 'last-week',
        dayGap: 5,
        forcedAdd: true,
      },
    });
    expect(proposal.after.summary).toMatchObject({ add: 1, duplicate: 0 });
    expect(proposal.after.added).toHaveLength(1);
    expect(proposal.after.options.maxFuzzyDayGap).toBe(3);
  });

  it('inserts the forced row on apply and leaves last week alone', async () => {
    await db.insertTransaction({
      id: 'last-week',
      account: 'acct',
      amount: -1000,
      date: '2024-01-10',
      notes: 'last week',
    });
    const apply = guardedApply({
      operation: 'imports.file',
      noun: 'File import',
      prepare: prepareFileImport,
      perform: performFileImport,
    });

    const outcome = await apply(await prepare({ maxFuzzyDayGap: 3 }));

    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    const rows = await db.all<{
      id: string;
      date: number;
      notes: string | null;
    }>(
      'SELECT id, date, notes FROM transactions WHERE tombstone = 0 ORDER BY date',
    );
    expect(rows.map(row => row.date)).toEqual([20240110, 20240115]);
    expect(rows[0]).toMatchObject({ id: 'last-week', notes: 'last week' });
  });

  it('keeps a fuzzy match within maxFuzzyDayGap', async () => {
    await db.insertTransaction({
      id: 'two-days',
      account: 'acct',
      amount: -1000,
      date: '2024-01-13',
    });

    const proposal = await prepare({ maxFuzzyDayGap: 3 });

    expect(proposal.after.rows[0]).toMatchObject({
      // Merged into the existing row (which gains the payee), not added.
      outcome: 'update',
      match: { transactionId: 'two-days', dayGap: 2 },
    });
    expect(proposal.after.rows[0].match).not.toHaveProperty('forcedAdd');
    expect(proposal.after.added).toHaveLength(0);
  });

  it('rejects a maxFuzzyDayGap outside 0-7', async () => {
    await expect(prepare({ maxFuzzyDayGap: 8 })).rejects.toThrow(
      'maxFuzzyDayGap',
    );
    await expect(prepare({ maxFuzzyDayGap: 1.5 })).rejects.toThrow(
      'maxFuzzyDayGap',
    );
  });

  it('leaves a matched transaction untouched when updateMatched is false', async () => {
    await db.insertTransaction({
      id: 'existing',
      account: 'acct',
      amount: -1000,
      date: '2024-01-15',
      imported_id: 'from-qfx',
      notes: 'curated',
    });
    const apply = guardedApply({
      operation: 'imports.file',
      noun: 'File import',
      prepare: prepareFileImport,
      perform: performFileImport,
    });

    const proposal = await prepare({ updateMatched: false });
    expect(proposal.after.updated).toEqual([]);
    expect(proposal.after.rows[0]).toMatchObject({ outcome: 'duplicate' });
    expect(proposal.after.options.updateMatched).toBe(false);

    await apply(proposal);
    const row = await db.first<{
      financial_id: string;
      imported_description: string | null;
    }>(
      "SELECT financial_id, imported_description FROM transactions WHERE id = 'existing'",
    );
    expect(row).toEqual({
      financial_id: 'from-qfx',
      imported_description: null,
    });
  });
});
