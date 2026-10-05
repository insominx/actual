import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for import file inspection: normalization through the
// dialog's parser and mapping rules, row-level errors, no ledger writes,
// file hashes, and saved mappings applied on the next inspection.

void test('imports inspect and parse normalize files without writes and apply saved mappings', async () => {
  const f = await createFixture({ encrypted: true });
  const dir = await mkdtemp(join(tmpdir(), 'actual-import-'));
  try {
    const run = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await run(['accounts', 'list']);
    const account = f.fixture.checking;
    const file = join(dir, 'card.csv');
    await writeFile(
      file,
      'Posted;Who;Charge;Credit\n24.12.2026;Grocer;12,50;\n27.12.2026;Refund;;3,00\n28.12.2026;Broken;x;\n',
    );
    const before = await readRaw(f);
    const settings = {
      delimiter: ';',
      fields: {
        date: 'Posted',
        payee: 'Who',
        outflow: 'Charge',
        inflow: 'Credit',
      },
      dateFormat: 'dd mm yyyy',
    };
    const inspected = await run([
      'imports',
      'inspect',
      file,
      '--settings',
      JSON.stringify(settings),
    ]);
    assert.equal(inspected.file.format, 'csv');
    assert.match(inspected.file.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(inspected.columns, ['Posted', 'Who', 'Charge', 'Credit']);
    assert.equal(inspected.rowCount, 3);
    assert.equal(inspected.validCount, 2);
    assert.deepEqual(
      inspected.rows.map(row => row.transaction?.amount ?? null),
      [-1250, 300, null],
    );
    assert.match(inspected.rows[2].errors.join(' '), /amount/);
    assert.deepEqual(inspected.dateRange, {
      start: '2026-12-24',
      end: '2026-12-27',
    });

    // Missing required mappings are row-level errors, not guesses.
    const unmapped = await run([
      'imports',
      'parse',
      file,
      '--settings',
      JSON.stringify({ ...settings, fields: { payee: 'Who' } }),
    ]);
    assert.equal(unmapped.validCount, 0);
    assert.match(unmapped.rows[0].errors.join(' '), /date/);

    // Unsupported and malformed requests fail; nothing was written.
    const pdf = join(dir, 'statement.pdf');
    await writeFile(pdf, '%PDF');
    for (const args of [
      ['imports', 'inspect', pdf],
      ['imports', 'inspect', join(dir, 'missing.csv')],
      ['imports', 'inspect', file, '--settings', '{"dateFormat":"yyyy dd mm"}'],
      ['imports', 'inspect', file, '--settings', '[1]'],
    ]) {
      const result = await f.cli(args);
      assert.notEqual(result.code, 0, args.join(' '));
    }
    assert.deepEqual(await readRaw(f), before, 'inspection wrote state');

    // A changed file has a different hash.
    await writeFile(
      file,
      'Posted;Who;Charge;Credit\n24.12.2026;Grocer;12,51;\n',
    );
    const changed = await run([
      'imports',
      'inspect',
      file,
      '--settings',
      JSON.stringify(settings),
    ]);
    assert.notEqual(changed.file.sha256, inspected.file.sha256);

    // Saved mappings apply to the next inspection for that account.
    await run([
      'imports',
      'mappings',
      'set',
      '--account',
      account,
      '--settings',
      JSON.stringify(settings),
      '--operation-id',
      'save-import-mapping',
    ]);
    const viaSaved = await run([
      'imports',
      'inspect',
      file,
      '--account',
      account,
    ]);
    assert.equal(viaSaved.sources.fields, 'saved');
    assert.equal(viaSaved.sources.delimiter, 'saved');
    assert.equal(viaSaved.rows[0].transaction.amount, -1251);
    const ignored = await run([
      'imports',
      'inspect',
      file,
      '--account',
      account,
      '--no-saved',
    ]);
    assert.equal(ignored.sources.fields, 'detected');
    const got = await run(['imports', 'mappings', 'get', '--account', account]);
    assert.equal(got.settings.dateFormat, 'dd mm yyyy');
    await run([
      'imports',
      'mappings',
      'reset',
      '--account',
      account,
      '--operation-id',
      'reset-import-mapping',
    ]);
    assert.deepEqual(
      (await run(['imports', 'mappings', 'get', '--account', account]))
        .settings,
      {},
    );
    const after = await readRaw(f);
    assert.deepEqual(after.transactions, before.transactions);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await f.dispose();
  }
});
