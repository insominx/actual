import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The inspector's preference catalog initializes the app. Load the server
// entry first so that happens after main has finished wiring handlers.
import '#server/main';
import * as db from '#server/db';

import { inspectImportFile } from './inspect-file';

const { emptyDatabase } = global as typeof globalThis & {
  emptyDatabase: () => () => Promise<void>;
};

describe('inspectImportFile amount scale', () => {
  let dir = '';

  beforeEach(async () => {
    await emptyDatabase()();
    dir = await mkdtemp(join(tmpdir(), 'actual-import-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function inspectAmount(currency: string | null) {
    if (currency) {
      db.runQuery(
        `INSERT INTO preferences (id, value) VALUES ('defaultCurrencyCode', ?)`,
        [currency],
      );
    }
    const path = join(dir, 'amounts.csv');
    await writeFile(path, 'Date,Payee,Amount\n2024-01-15,Shop,-1000\n');
    const result = await inspectImportFile({
      path,
      settings: {
        dateFormat: 'yyyy mm dd',
        fields: {
          date: 'Date',
          amount: 'Amount',
          payee: 'Payee',
        },
      },
    });
    expect(result.rows[0]?.errors ?? []).toEqual([]);
    return result.rows[0]?.transaction?.amount;
  }

  it('keeps cents for a two-decimal budget currency', async () => {
    expect(await inspectAmount('USD')).toBe(-100000);
  });

  it('stores a yen amount as whole units', async () => {
    expect(await inspectAmount('JPY')).toBe(-1000);
  });
});
