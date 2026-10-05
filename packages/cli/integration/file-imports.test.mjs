import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for guarded file imports (0021): read-only previews with
// per-row outcomes and match evidence, rule results that match the commit,
// no duplicates on reimport, the deleted-row policy, invalid rows, and
// changed files or mappings rejected instead of replayed.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

function strict(f) {
  return async args => {
    const result = await f.cli(args);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).data;
  };
}

function ofx(rows) {
  const trn = rows
    .map(
      ([date, amount, id, name]) =>
        `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${date.replaceAll('-', '')}120000[0:GMT]<TRNAMT>${amount}<FITID>${id}<NAME>${name}</STMTTRN>`,
    )
    .join('');
  return `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261010120000[0:GMT]<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1><CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>test</CCACCTFROM><BANKTRANLIST><DTSTART>20261001120000[0:GMT]<DTEND>20261031120000[0:GMT]${trn}</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>\n`;
}

const listArgs = account => [
  'transactions',
  'list',
  '--account',
  account,
  '--start',
  '2026-10-01',
  '--end',
  '2026-10-31',
];

void test('file import previews without writes, keeps match evidence distinct and never duplicates on reimport', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const account = (await legacy(f, ['accounts', 'create', '--name', 'Card']))
      .id;
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      account,
      '--data',
      JSON.stringify([
        { date: '2026-10-02', amount: -1250, payee_name: 'Grocer' },
      ]),
    ]);
    const [existing] = await legacy(f, listArgs(account));
    await legacy(f, [
      'rules',
      'create',
      '--data',
      JSON.stringify({
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [
          { field: 'imported_payee', op: 'contains', value: 'Coffee' },
        ],
        actions: [{ op: 'set', field: 'notes', value: 'from rule' }],
      }),
    ]);
    const file = join(f.root, 'statement.ofx');
    await writeFile(
      file,
      ofx([
        ['2026-10-02', '-12.50', 'fit-1', 'Grocer'],
        ['2026-10-04', '-3.00', 'fit-2', 'Coffee Bar'],
        ['2026-10-05', '20.00', 'fit-3', 'Employer'],
      ]),
    );
    const before = await readRaw(f);
    const preview = await cli([
      'imports',
      'preview',
      file,
      '--account',
      account,
    ]);
    assert.deepEqual(await readRaw(f), before, 'preview wrote state');
    assert.equal(preview.operation, 'imports.file');
    assert.match(preview.before.file.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      preview.after.rows.map(row => [row.outcome, row.match?.kind ?? null]),
      [
        ['update', 'payee_date_amount'],
        ['add', null],
        ['add', null],
      ],
    );
    assert.equal(preview.after.rows[0].match.transactionId, existing.id);
    assert.deepEqual(preview.after.summary.newPayees, [
      'Coffee Bar',
      'Employer',
    ]);
    assert.equal(
      preview.after.added.find(row => row.amount === -300).notes,
      'from rule',
    );
    assert.deepEqual(preview.after.options, {
      defaultCleared: true,
      reimportDeleted: true,
      payeeNameNormalization: 'title-case',
      invalidRows: 'reject',
    });

    const applied = await cli([
      'imports',
      'apply',
      file,
      '--account',
      account,
      '--expect-sha256',
      preview.before.file.sha256,
      '--operation-id',
      'file-import-1',
    ]);
    const outcome = applied.receipt.outcome;
    assert.equal(outcome.status, 'committed-local');
    assert.equal(outcome.fileImport.sha256, preview.before.file.sha256);
    assert.equal(outcome.fileImport.addedIds.length, 2);
    assert.deepEqual(outcome.fileImport.updatedIds, [existing.id]);
    const after = await legacy(f, listArgs(account));
    assert.equal(after.length, 3);
    const coffee = after.find(row => row.amount === -300);
    assert.equal(coffee.notes, 'from rule', 'committed rule result');
    assert.equal(
      after.find(row => row.id === existing.id).imported_id,
      'fit-1',
    );

    // Reimporting the same file matches every row by imported ID.
    const again = await cli(['imports', 'preview', file, '--account', account]);
    assert.deepEqual(
      again.after.rows.map(row => [row.outcome, row.match?.kind]),
      [
        ['duplicate', 'imported_id'],
        ['duplicate', 'imported_id'],
        ['duplicate', 'imported_id'],
      ],
    );
    const reimported = await cli([
      'imports',
      'apply',
      file,
      '--account',
      account,
      '--operation-id',
      'file-import-2',
    ]);
    assert.deepEqual(reimported.receipt.outcome.fileImport.addedIds, []);
    assert.equal((await legacy(f, listArgs(account))).length, 3);

    // History keeps the hash, settings, options and result per import.
    const history = await cli(['imports', 'history']);
    assert.deepEqual(
      history.items.map(item => [
        item.operationId,
        item.file.sha256,
        item.result?.added,
      ]),
      [
        ['file-import-1', preview.before.file.sha256, 2],
        ['file-import-2', preview.before.file.sha256, 0],
      ],
    );

    // Deleted rows: the account preference reimports them; opting out
    // reports the match against the deleted row and skips it.
    const employer = after.find(row => row.amount === 2000);
    await legacy(f, ['transactions', 'delete', employer.id]);
    const policy = async extra =>
      (await cli(['imports', 'preview', file, '--account', account, ...extra]))
        .after.rows[2];
    assert.equal((await policy([])).outcome, 'add');
    const skipped = await policy(['--no-reimport-deleted']);
    assert.equal(skipped.outcome, 'deleted');
    assert.deepEqual(skipped.match, {
      kind: 'imported_id',
      transactionId: employer.id,
    });

    // A changed file is rejected before writing.
    const beforeChange = await readRaw(f);
    await writeFile(file, ofx([['2026-10-06', '-1.00', 'fit-9', 'Other']]));
    const changed = await f.cli([
      'imports',
      'apply',
      file,
      '--account',
      account,
      '--expect-sha256',
      preview.before.file.sha256,
      '--operation-id',
      'file-import-changed',
    ]);
    assert.notEqual(changed.code, 0);
    assert.equal(JSON.parse(changed.stdout).error.code, 'INVALID_INPUT');
    assert.deepEqual(await readRaw(f), beforeChange);
  } finally {
    await f.dispose();
  }
});

void test('file import handles invalid rows explicitly and rejects changed sources and mappings as stale', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const account = f.fixture.checking;
    const file = join(f.root, 'card.csv');
    const settings = {
      delimiter: ';',
      fields: { date: 'Posted', payee: 'Who', amount: 'Amount' },
      dateFormat: 'dd mm yyyy',
    };
    await writeFile(
      file,
      'Posted;Who;Amount\n03.10.2026;Bakery;-4,50\n04.10.2026;Broken;x\n05.10.2026;Cinema;-12,00\n',
    );
    const before = await readRaw(f);
    const rejected = await f.cli([
      'imports',
      'preview',
      file,
      '--account',
      account,
      '--settings',
      JSON.stringify(settings),
    ]);
    assert.notEqual(rejected.code, 0, 'invalid rows reject by default');
    assert.equal(JSON.parse(rejected.stdout).error.code, 'INVALID_INPUT');
    const skipping = await cli([
      'imports',
      'preview',
      file,
      '--account',
      account,
      '--settings',
      JSON.stringify(settings),
      '--skip-invalid',
    ]);
    assert.deepEqual(
      skipping.after.rows.map(row => row.outcome),
      ['add', 'invalid', 'add'],
    );
    assert.match(skipping.after.rows[1].errors.join(' '), /amount/);
    assert.equal(skipping.after.summary.invalid, 1);
    assert.deepEqual(await readRaw(f), before);

    // Saved mapping, then a token preview; changing the mapping makes it stale.
    await cli([
      'imports',
      'mappings',
      'set',
      '--account',
      account,
      '--settings',
      JSON.stringify(settings),
      '--operation-id',
      'csv-mapping',
    ]);
    const data = { path: file, accountId: account, invalidRows: 'skip' };
    const prepared = await cli([
      'changes',
      'preview',
      'imports.file',
      '--operation-id',
      'stale-mapping',
      '--data',
      JSON.stringify(data),
    ]);
    assert.equal(prepared.proposal.before.sources.fields, 'saved');
    await cli([
      'imports',
      'mappings',
      'set',
      '--account',
      account,
      '--settings',
      JSON.stringify({ skipEndLines: 1 }),
      '--operation-id',
      'csv-mapping-2',
    ]);
    const beforeStale = await readRaw(f);
    const stale = await f.cli([
      'changes',
      'apply',
      'stale-mapping',
      '--token',
      prepared.token,
    ]);
    assert.notEqual(stale.code, 0);
    assert.equal(JSON.parse(stale.stdout).error.code, 'STALE_PREVIEW');
    assert.deepEqual(await readRaw(f), beforeStale, 'stale apply wrote state');

    // A file changed after a token preview is stale too.
    const second = await cli([
      'changes',
      'preview',
      'imports.file',
      '--operation-id',
      'stale-file',
      '--data',
      JSON.stringify(data),
    ]);
    await writeFile(file, 'Posted;Who;Amount\n03.10.2026;Bakery;-4,51\n');
    const staleFile = await f.cli([
      'changes',
      'apply',
      'stale-file',
      '--token',
      second.token,
    ]);
    assert.notEqual(staleFile.code, 0);
    assert.equal(JSON.parse(staleFile.stdout).error.code, 'STALE_PREVIEW');
    assert.deepEqual(await readRaw(f), beforeStale);
  } finally {
    await f.dispose();
  }
});

void test('batch file import previews overlap, commits per file, reviews transfers and stops at the first failure', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    await strict(f)(['accounts', 'list']);
    const bank = (await legacy(f, ['accounts', 'create', '--name', 'Bank'])).id;
    const savings = (
      await legacy(f, ['accounts', 'create', '--name', 'Savings'])
    ).id;
    await writeFile(
      join(f.root, 'bank-1.ofx'),
      ofx([
        ['2026-10-03', '-100.00', 'fit-a', 'Transfer To Savings'],
        ['2026-10-04', '-5.00', 'fit-b', 'Shop'],
      ]),
    );
    await writeFile(
      join(f.root, 'savings.ofx'),
      ofx([['2026-10-03', '100.00', 'fit-c', 'Transfer From Bank']]),
    );
    await writeFile(
      join(f.root, 'bank-2.ofx'),
      ofx([
        ['2026-10-04', '-5.00', 'fit-b', 'Shop'],
        ['2026-10-06', '-7.00', 'fit-d', 'Cafe'],
      ]),
    );
    const manifest = join(f.root, 'batch.json');
    await writeFile(
      manifest,
      JSON.stringify([
        { file: 'bank-1.ofx', account: bank },
        { file: 'savings.ofx', account: savings },
        { file: 'bank-2.ofx', account: bank },
      ]),
    );
    const before = await readRaw(f);
    const dry = await strict(f)(['imports', 'batch', manifest, '--dry-run']);
    assert.deepEqual(await readRaw(f), before, 'dry run wrote state');
    assert.deepEqual(
      dry.files.map(file => file.status),
      ['previewed', 'previewed', 'previewed'],
    );
    assert.deepEqual(dry.overlaps, [
      {
        file: 2,
        index: 0,
        earlierFile: 0,
        earlierIndex: 1,
        key: 'imported_id',
      },
    ]);

    const run = ['imports', 'batch', manifest, '--operation-id', 'batch-1'];
    const applied = await strict(f)(run);
    assert.deepEqual(
      applied.files.map(file => [file.status, file.operationId]),
      [
        ['committed', 'batch-1-1'],
        ['committed', 'batch-1-2'],
        ['committed', 'batch-1-3'],
      ],
    );
    // The third file was planned after the first committed.
    assert.equal(applied.files[2].summary.duplicate, 1);
    assert.equal(applied.files[2].summary.add, 1);
    const pair = applied.transferReview.candidates;
    assert.equal(pair.length, 1);
    assert.deepEqual(
      [pair[0].from.id, pair[0].to.id].sort(),
      [applied.files[0].addedIds[0], applied.files[1].addedIds[0]].sort(),
    );
    const afterApply = await readRaw(f);
    // Retrying the batch returns the stored receipts without writing.
    const retried = await strict(f)(run);
    assert.deepEqual(
      retried.files.map(file => file.addedIds),
      applied.files.map(file => file.addedIds),
    );
    assert.deepEqual(await readRaw(f), afterApply);

    // A failing file stops the batch: earlier files stay committed and later
    // ones are reported as not attempted.
    await writeFile(
      join(f.root, 'bank-3.ofx'),
      ofx([['2026-10-08', '-9.00', 'fit-e', 'Kiosk']]),
    );
    const partial = join(f.root, 'partial.json');
    await writeFile(
      partial,
      JSON.stringify([
        { file: 'bank-3.ofx', account: bank },
        { file: 'missing.ofx', account: bank },
        { file: 'savings.ofx', account: savings },
      ]),
    );
    const failed = await f.cli([
      'imports',
      'batch',
      partial,
      '--operation-id',
      'batch-2',
    ]);
    assert.equal(failed.code, 6, failed.stdout + failed.stderr);
    const error = JSON.parse(failed.stdout).error;
    assert.equal(error.code, 'PARTIAL_COMPLETION');
    assert.deepEqual(
      error.details.files.map(file => file.status),
      ['committed', 'failed', 'not-attempted'],
    );
    const bankRows = await legacy(f, listArgs(bank));
    assert.deepEqual(
      bankRows.map(row => row.amount).sort((a, b) => a - b),
      [-10000, -900, -700, -500],
    );
  } finally {
    await f.dispose();
  }
});

// Guarded protocol cases: acknowledged retries, ID collisions, offline
// commits with later sync, and kills at every phase (including after the
// local commit and before sync) never replay the import.
const csv =
  'Date,Payee,Amount\n2026-10-04,Bakery,-4.50\n2026-10-05,Cinema,-12.00\n';
const csvSettings = {
  fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
  dateFormat: 'yyyy mm dd',
};

function verifyCsv(before, after, { outcome }) {
  const rows = createdRows(before, after, 'transactions');
  assert.deepEqual(rows.map(row => row.amount).sort(), [-1200, -450]);
  if (outcome) {
    assert.deepEqual(
      [...outcome.fileImport.addedIds].sort(),
      rows.map(row => row.id).sort(),
    );
  }
}

const fileImport = {
  operation: 'imports.file',
  label: 'file import',
  async setup(f) {
    const file = join(f.root, 'protocol.csv');
    await writeFile(file, csv);
    const other = join(f.root, 'other.csv');
    await writeFile(other, 'Date,Payee,Amount\n2026-10-06,Other,-1.00\n');
    return { file, other };
  },
  data: (f, ctx) => ({
    path: ctx.file,
    accountId: f.fixture.checking,
    settings: csvSettings,
  }),
  otherData: (f, ctx) => ({
    path: ctx.other,
    accountId: f.fixture.checking,
    settings: csvSettings,
  }),
  verify: verifyCsv,
};

guardedRegularCases(fileImport);
guardedInterruptionCases(fileImport);
