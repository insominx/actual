import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The inspector's preference catalog initializes the app. Load the server
// entry first so that happens after main has finished wiring handlers.
import '#server/main';
import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { prepareFileImport } from './guarded-file-import';

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

  function prepare() {
    return prepareFileImport({
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
});
