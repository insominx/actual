import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createFixture, isolatedEnv, repoRoot } from './harness.mjs';

async function fundHoldFixture(f) {
  const provision = async args => {
    const result = await f.cli(args, { version: '1' });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const group = (await provision(['category-groups', 'list'])).find(
    row => row.is_income,
  );
  assert.ok(group, 'Hold fixture needs the existing income group');
  const category = await provision([
    'categories',
    'create',
    '--name',
    'Hold proof funds',
    '--group-id',
    group.id,
    '--is-income',
  ]);
  await provision([
    'transactions',
    'add',
    '--account',
    f.fixture.checking,
    '--data',
    JSON.stringify([
      {
        date: '2026-08-01',
        amount: 1000000,
        category: category.id,
        notes: 'Disposable hold funds',
      },
    ]),
  ]);
  const rows = await provision([
    'transactions',
    'list',
    '--account',
    f.fixture.checking,
    '--start',
    '2026-08-01',
    '--end',
    '2026-08-31',
  ]);
  assert.ok(
    rows.some(
      row =>
        row.notes === 'Disposable hold funds' &&
        row.amount === 1000000 &&
        row.category === category.id,
    ),
    JSON.stringify(rows),
  );
  const categories = await provision(['categories', 'list']);
  assert.ok(
    categories.some(row => row.id === category.id && row.is_income),
    JSON.stringify(categories),
  );
}

void test(
  'guarded restore preserves the rich source and retries one destination without needing the retained archive',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async args => {
        const result = await f.cli(args);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      await cli(['accounts', 'list']);
      const artifact = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'restore-proof'),
      ]);
      const sourceMetadata = await readFile(
        join(f.root, 'a', f.fixture.budgetId, 'metadata.json'),
      );
      const sourceCache = await readFile(
        join(f.root, 'a', '.actual-cli', f.fixture.syncId, 'state.json'),
      );
      const archive = await readFile(join(artifact.path, 'budget.zip'));
      const remoteBefore = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(remoteBefore.code, 0, remoteBefore.stderr);
      const before = await cli(['--offline', 'budgets', 'list']);
      const payload = JSON.stringify({
        path: artifact.path,
        name: 'Guarded rich restoration',
      });
      const prepared = await cli([
        '--offline',
        'changes',
        'preview',
        'backups.restore',
        '--operation-id',
        'restore-preview',
        '--data',
        payload,
      ]);
      assert.equal(prepared.proposal.budget, null);
      assert.equal(prepared.proposal.before.sha256, artifact.manifest.sha256);
      assert.equal(prepared.artifact.path, artifact.path);
      assert.deepEqual(await cli(['--offline', 'budgets', 'list']), before);
      assert.deepEqual(
        await readFile(join(f.root, 'a', f.fixture.budgetId, 'metadata.json')),
        sourceMetadata,
      );
      assert.deepEqual(
        await readFile(
          join(f.root, 'a', '.actual-cli', f.fixture.syncId, 'state.json'),
        ),
        sourceCache,
      );
      const applied = await cli([
        '--offline',
        'changes',
        'apply',
        'restore-preview',
        '--token',
        prepared.token,
      ]);
      assert.equal(applied.state, 'committed-local');
      const destination = applied.outcome.affectedIds[0];
      assert.notEqual(destination, f.fixture.budgetId);
      const copy = await cli([
        '--offline',
        '--budget-id',
        destination,
        'backups',
        'create',
        '--directory',
        join(f.root, 'restored-copy'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', copy.path])).snapshot,
        f.fixture.snapshot,
      );
      const directArgs = [
        '--offline',
        'backups',
        'restore',
        artifact.path,
        '--name',
        'Direct guarded restoration',
        '--operation-id',
        'restore-direct',
      ];
      const direct = await cli(directArgs);
      assert.equal(direct.sourceBudgetId, f.fixture.budgetId);
      assert.equal(direct.receipt.state, 'committed-local');
      assert.deepEqual(direct.snapshot, f.fixture.snapshot);
      const directAgain = await cli(directArgs);
      assert.equal(directAgain.id, direct.id);
      assert.deepEqual(directAgain.receipt.outcome, direct.receipt.outcome);
      for (const args of [
        [
          '--offline',
          'backups',
          'restore',
          artifact.path,
          '--name',
          'Missing operation ID',
        ],
        ['--offline', '--no-lock', ...directArgs.slice(1)],
        [
          'backups',
          'restore',
          artifact.path,
          '--name',
          'Online restoration',
          '--operation-id',
          'restore-online',
        ],
        [
          '--offline',
          'backups',
          'restore',
          artifact.path,
          '--name',
          'Collision request',
          '--operation-id',
          'restore-direct',
        ],
      ]) {
        const rejected = await f.cli(args);
        assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
      }
      const stale = await cli([
        '--offline',
        'changes',
        'preview',
        'backups.restore',
        '--operation-id',
        'restore-stale',
        '--data',
        JSON.stringify({ path: artifact.path, name: 'Stale restored copy' }),
      ]);
      await writeFile(
        join(artifact.path, 'budget.zip'),
        archive.subarray(0, 16),
      );
      const inventory = await cli(['--offline', 'budgets', 'list']);
      const rejected = await f.cli([
        '--offline',
        'changes',
        'apply',
        'restore-stale',
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(['changes', 'status', 'restore-stale'])).state,
        'failed-before-commit',
      );
      assert.deepEqual(await cli(['--offline', 'budgets', 'list']), inventory);
      await unlink(join(artifact.path, 'budget.zip'));
      const retained = await cli(directArgs);
      assert.equal(retained.id, direct.id);
      assert.deepEqual(retained.receipt.outcome, direct.receipt.outcome);
      assert.deepEqual(
        (
          await cli([
            '--offline',
            'changes',
            'apply',
            'restore-preview',
            '--token',
            prepared.token,
          ])
        ).outcome,
        applied.outcome,
      );
      assert.deepEqual(
        await readFile(join(f.root, 'a', f.fixture.budgetId, 'metadata.json')),
        sourceMetadata,
      );
      assert.deepEqual(
        await readFile(
          join(f.root, 'a', '.actual-cli', f.fixture.syncId, 'state.json'),
        ),
        sourceCache,
      );
      const remote = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(remote.code, 0, remote.stderr);
      assert.deepEqual(
        JSON.parse(remote.stdout).data,
        JSON.parse(remoteBefore.stdout).data,
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'guarded clone preserves the rich source and receipts prevent another destination on retries',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const original = await cli(['budgets', 'inspect']);
      const remoteBefore = await cli(['budgets', 'list'], { client: 'seed' });
      const before = await cli(['--offline', 'budgets', 'list']);
      const prepared = await cli([
        '--offline',
        'changes',
        'preview',
        'budgets.clone',
        original.id,
        '--operation-id',
        'clone-preview',
        '--data',
        '{"name":"Guarded rich copy"}',
      ]);
      assert.equal(prepared.proposal.budget.id, original.id);
      assert.match(prepared.proposal.before.sourceHash, /^[a-f0-9]{64}$/);
      assert.deepEqual(await cli(['--offline', 'budgets', 'list']), before);
      const sourceBackup = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'clone-source-proof'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', sourceBackup.path])).snapshot,
        f.fixture.snapshot,
      );
      const appliedResult = await f.cli([
        '--offline',
        'changes',
        'apply',
        'clone-preview',
        '--token',
        prepared.token,
      ]);
      assert.equal(
        appliedResult.code,
        0,
        appliedResult.stdout + appliedResult.stderr,
      );
      const envelope = JSON.parse(appliedResult.stdout);
      const applied = envelope.data;
      assert.equal(applied.state, 'committed-local');
      assert.equal(applied.proposal.delivery, 'local-only');
      const id = applied.outcome.affectedIds[0];
      assert.notEqual(id, original.id);
      assert.equal(envelope.context.budgetId, id);
      assert.equal(envelope.context.syncId, null);
      const copied = await cli([
        '--offline',
        '--budget-id',
        id,
        'backups',
        'create',
        '--directory',
        join(f.root, 'clone-destination-proof'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', copied.path])).snapshot,
        f.fixture.snapshot,
      );
      const repeated = await cli([
        '--offline',
        'changes',
        'apply',
        'clone-preview',
        '--token',
        prepared.token,
      ]);
      assert.deepEqual(repeated.outcome, applied.outcome);
      const directArgs = [
        '--offline',
        'budgets',
        'clone',
        '--name',
        'Direct rich copy',
        '--operation-id',
        'clone-direct',
      ];
      const direct = await cli(directArgs);
      assert.equal(direct.sourceBudgetId, original.id);
      assert.equal(direct.id, direct.receipt.outcome.affectedIds[0]);
      assert.equal(direct.syncId, null);
      assert.equal(direct.published, false);
      const retry = await cli(directArgs);
      assert.equal(retry.id, direct.id);
      assert.deepEqual(retry.receipt.outcome, direct.receipt.outcome);
      for (const args of [
        ['--offline', 'budgets', 'clone', '--name', 'Missing clone ID'],
        ['--offline', '--no-lock', ...directArgs.slice(1)],
        [
          '--offline',
          'budgets',
          'clone',
          '--name',
          'Other copy',
          '--operation-id',
          'clone-direct',
        ],
        ['changes', 'apply', 'clone-preview', '--token', prepared.token],
      ]) {
        const rejected = await f.cli(args);
        assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
      }
      const stale = await cli([
        '--offline',
        'changes',
        'preview',
        'budgets.clone',
        original.id,
        '--operation-id',
        'clone-stale',
        '--data',
        '{"name":"Stale copy must not exist"}',
      ]);
      await cli([
        '--offline',
        'accounts',
        'update',
        f.fixture.checking,
        '--name',
        'Edited source after preview',
        '--operation-id',
        'clone-source-account-edit',
      ]);
      const inventory = await cli(['--offline', 'budgets', 'list']);
      const rejected = await f.cli([
        '--offline',
        'changes',
        'apply',
        'clone-stale',
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(['changes', 'status', 'clone-stale'])).state,
        'failed-before-commit',
      );
      assert.deepEqual(await cli(['--offline', 'budgets', 'list']), inventory);
      const acknowledgedRetry = await cli(directArgs);
      assert.equal(acknowledgedRetry.id, direct.id);
      assert.deepEqual(
        acknowledgedRetry.receipt.outcome,
        direct.receipt.outcome,
      );
      assert.deepEqual(
        await cli(['budgets', 'list'], { client: 'seed' }),
        remoteBefore,
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'guarded creation preserves inventory and receipts return one destination across restarts',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const beforeRemote = await cli(['budgets', 'list'], { client: 'seed' });
      const client = { client: 'creation' };
      await mkdir(join(f.root, 'creation'));
      const before = await cli(['--offline', 'budgets', 'list'], client);
      const prepared = await cli(
        [
          '--offline',
          'changes',
          'preview',
          'budgets.create',
          '--operation-id',
          'create-preview',
          '--data',
          '{"name":"Guarded new local","currency":"CAD"}',
        ],
        client,
      );
      assert.equal(prepared.state, 'prepared');
      assert.equal(prepared.proposal.budget, null);
      assert.equal(prepared.proposal.delivery, 'local-only');
      assert.deepEqual(
        await cli(['--offline', 'budgets', 'list'], client),
        before,
      );
      const applied = await cli(
        [
          '--offline',
          'changes',
          'apply',
          'create-preview',
          '--token',
          prepared.token,
        ],
        client,
      );
      assert.equal(applied.state, 'committed-local');
      const id = applied.outcome.affectedIds[0];
      assert.ok(id);
      const inventory = await cli(['--offline', 'budgets', 'list'], client);
      assert.equal(inventory.length, before.length + 1);
      const repeated = await cli(
        [
          '--offline',
          'changes',
          'apply',
          'create-preview',
          '--token',
          prepared.token,
        ],
        client,
      );
      assert.deepEqual(repeated.outcome, applied.outcome);
      assert.deepEqual(
        await cli(['--offline', 'budgets', 'list'], client),
        inventory,
      );
      assert.equal(
        (
          await cli(
            ['--offline', '--budget-id', id, 'budgets', 'inspect'],
            client,
          )
        ).currency,
        'CAD',
      );
      assert.equal(
        (await cli(['changes', 'status', 'create-preview'], client)).state,
        'committed-local',
      );
      const directArgs = [
        '--offline',
        'budgets',
        'create',
        '--name',
        'Direct guarded local',
        '--currency',
        'USD',
        '--operation-id',
        'create-direct',
      ];
      const direct = await cli(directArgs, client);
      assert.equal(direct.receipt.state, 'committed-local');
      assert.equal(direct.id, direct.receipt.outcome.affectedIds[0]);
      assert.equal(direct.published, false);
      const retry = await cli(directArgs, client);
      assert.equal(retry.id, direct.id);
      assert.deepEqual(retry.receipt.outcome, direct.receipt.outcome);
      for (const args of [
        ['--offline', 'budgets', 'create', '--name', 'Missing operation ID'],
        ['--offline', '--no-lock', ...directArgs.slice(1)],
        [
          '--offline',
          'budgets',
          'create',
          '--name',
          'Other input',
          '--operation-id',
          'create-direct',
        ],
        ['changes', 'apply', 'create-preview', '--token', prepared.token],
        [
          '--offline',
          'changes',
          'preview',
          'budgets.create',
          id,
          '--operation-id',
          'wrong-target',
          '--data',
          '{"name":"Wrong target"}',
        ],
      ]) {
        const rejected = await f.cli(args, client);
        assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
      }
      const stale = await cli(
        [
          '--offline',
          'changes',
          'preview',
          'budgets.create',
          '--operation-id',
          'create-stale',
          '--data',
          '{"name":"Occupied destination"}',
        ],
        client,
      );
      await cli(
        [
          '--offline',
          'budgets',
          'create',
          '--name',
          'Occupied destination',
          '--operation-id',
          'occupy-name',
        ],
        client,
      );
      const rejected = await f.cli(
        [
          '--offline',
          'changes',
          'apply',
          'create-stale',
          '--token',
          stale.token,
        ],
        client,
      );
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(['changes', 'status', 'create-stale'], client)).state,
        'failed-before-commit',
      );
      assert.deepEqual(
        await cli(['budgets', 'list'], { client: 'seed' }),
        beforeRemote,
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'guarded budget metadata preserves preview data and receipts protect rename and local archive retries',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const identity = await cli(['budgets', 'inspect']);
      const prepared = await cli([
        'changes',
        'preview',
        'budgets.rename',
        identity.id,
        '--operation-id',
        'metadata-prepared',
        '--data',
        '{"name":"Guarded metadata rename"}',
      ]);
      assert.equal(prepared.state, 'prepared');
      assert.equal((await cli(['budgets', 'inspect'])).name, identity.name);
      const backup = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'metadata-preview-proof'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', backup.path])).snapshot,
        f.fixture.snapshot,
      );
      const applied = await cli([
        'changes',
        'apply',
        prepared.operationId,
        '--token',
        prepared.token,
      ]);
      assert.equal(applied.state, 'synced');
      assert.equal(
        (await cli(['budgets', 'inspect'], { client: 'independent' })).name,
        'Guarded metadata rename',
      );
      assert.deepEqual(
        (
          await cli([
            'changes',
            'apply',
            prepared.operationId,
            '--token',
            prepared.token,
          ])
        ).outcome,
        applied.outcome,
      );
      const directArgs = [
        'budgets',
        'rename',
        '--name',
        'Direct guarded rename',
        '--operation-id',
        'metadata-direct',
      ];
      const direct = await cli(directArgs);
      assert.equal(direct.name, 'Direct guarded rename');
      assert.equal(direct.receipt.state, 'synced');
      assert.deepEqual(
        (await cli(directArgs)).receipt.outcome,
        direct.receipt.outcome,
      );
      const collision = await f.cli([
        'budgets',
        'rename',
        '--name',
        'Different request',
        '--operation-id',
        'metadata-direct',
      ]);
      assert.equal(collision.code, 2, collision.stdout + collision.stderr);
      const missing = await f.cli([
        'budgets',
        'rename',
        '--name',
        'Missing retry ID',
      ]);
      assert.equal(missing.code, 2, missing.stdout + missing.stderr);
      const noLock = await f.cli(['--no-lock', ...directArgs]);
      assert.equal(noLock.code, 2, noLock.stdout + noLock.stderr);
      const stale = await cli([
        'changes',
        'preview',
        'budgets.rename',
        identity.id,
        '--operation-id',
        'metadata-stale',
        '--data',
        '{"name":"Stale proposal"}',
      ]);
      await cli(
        [
          'budgets',
          'rename',
          '--name',
          'Concurrent rename',
          '--operation-id',
          'metadata-concurrent',
        ],
        { client: 'independent' },
      );
      const rejected = await f.cli([
        'changes',
        'apply',
        stale.operationId,
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(['changes', 'status', stale.operationId])).state,
        'failed-before-commit',
      );
      const pending = (await cli(['--offline', 'sync', 'status']))
        .pendingMessages;
      const archive = await cli([
        '--offline',
        'budgets',
        'archive',
        '--operation-id',
        'metadata-archive',
      ]);
      assert.equal(archive.archived, true);
      assert.equal(archive.remoteDeleted, false);
      assert.equal(archive.receipt.state, 'committed-local');
      assert.equal(archive.receipt.proposal.delivery, 'local-only');
      assert.equal(
        (await cli(['--offline', 'sync', 'status'])).pendingMessages,
        pending,
      );
      assert.equal(
        (await cli(['budgets', 'inspect'], { client: 'independent' })).archived,
        false,
      );
      const repeated = await cli([
        '--offline',
        'budgets',
        'archive',
        '--operation-id',
        'metadata-archive',
      ]);
      assert.deepEqual(repeated.receipt.outcome, archive.receipt.outcome);
      const restored = await cli([
        '--offline',
        'budgets',
        'archive',
        '--restore',
        '--operation-id',
        'metadata-unarchive',
      ]);
      assert.equal(restored.archived, false);
      const onlineArchive = await f.cli([
        'budgets',
        'archive',
        '--operation-id',
        'metadata-online',
      ]);
      assert.equal(
        onlineArchive.code,
        2,
        onlineArchive.stdout + onlineArchive.stderr,
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'guarded transfers preserve preview data, synchronize both sides, and protect counterpart splits',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const list = account => [
        'transactions',
        'list',
        '--account',
        account,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ];
      const before = await cli(list(f.fixture.checking));
      const original = before.find(row => row.transfer_id);
      const counterpart = (await cli(list(f.fixture.savings))).find(
        row => row.id === original.transfer_id,
      );
      const prepare = (id, operationId, fields) =>
        cli([
          'changes',
          'preview',
          'transactions.update',
          id,
          '--operation-id',
          operationId,
          '--data',
          JSON.stringify(fields),
        ]);
      const apply = prepared =>
        cli([
          'changes',
          'apply',
          prepared.operationId,
          '--token',
          prepared.token,
        ]);
      const prepared = await prepare(original.id, 'transfer-pair', {
        amount: -12345,
        notes: 'guarded pair',
        date: '2026-08-06',
        cleared: true,
      });
      assert.deepEqual(
        prepared.proposal.before
          .map(row => row.id)
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        [original.id, counterpart.id].sort((left, right) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      );
      assert.deepEqual(await cli(list(f.fixture.checking)), before);
      const backup = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'transfer-preview-proof'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', backup.path])).snapshot,
        f.fixture.snapshot,
      );
      const committed = await apply(prepared);
      assert.equal(committed.state, 'synced');
      assert.deepEqual((await apply(prepared)).outcome, committed.outcome);
      const remoteFrom = (
        await cli(list(f.fixture.checking), { client: 'independent' })
      ).find(row => row.id === original.id);
      const remoteTo = (
        await cli(list(f.fixture.savings), { client: 'independent' })
      ).find(row => row.id === counterpart.id);
      assert.equal(remoteFrom.amount, -12345);
      assert.equal(remoteTo.amount, 12345);
      assert.equal(remoteTo.notes, 'guarded pair');
      assert.equal(remoteFrom.date, '2026-08-06');
      assert.equal(remoteTo.date, counterpart.date);
      assert.equal(remoteTo.cleared, counterpart.cleared);
      const stale = await prepare(original.id, 'transfer-stale', {
        amount: -15000,
      });
      await cli(
        [
          'transactions',
          'update',
          counterpart.id,
          '--data',
          '{"cleared":true}',
        ],
        { client: 'independent' },
      );
      const rejected = await f.cli([
        'changes',
        'apply',
        stale.operationId,
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(list(f.fixture.checking))).find(
          row => row.id === original.id,
        ).amount,
        -12345,
      );
      const payee = (await cli(['payees', 'list'])).find(
        row => row.transfer_acct === f.fixture.savings,
      );
      await cli([
        'transactions',
        'add',
        '--account',
        f.fixture.checking,
        '--run-transfers',
        '--data',
        JSON.stringify([
          {
            date: '2026-08-07',
            amount: -300,
            notes: 'counterpart split fixture',
            subtransactions: [
              { amount: -200, payee: payee.id, notes: 'linked child' },
              { amount: -100, notes: 'sibling' },
            ],
          },
        ]),
      ]);
      const parent = (await cli(list(f.fixture.checking))).find(
        row => row.notes === 'counterpart split fixture',
      );
      const child = parent.subtransactions.find(row => row.transfer_id);
      const sibling = parent.subtransactions.find(row => row.id !== child.id);
      const splitBefore = await cli(list(f.fixture.checking));
      const split = await prepare(child.transfer_id, 'transfer-split', {
        amount: 210,
        notes: 'guarded counterpart',
      });
      assert.deepEqual(
        split.proposal.before
          .map(row => row.id)
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        [parent.id, child.id, sibling.id, child.transfer_id].sort(
          (left, right) => (left < right ? -1 : left > right ? 1 : 0),
        ),
      );
      assert.equal(
        split.proposal.after.find(row => row.id === parent.id).error.difference,
        10,
      );
      assert.deepEqual(await cli(list(f.fixture.checking)), splitBefore);
      await apply(split);
      const splitRemote = (
        await cli(list(f.fixture.checking), { client: 'independent' })
      ).find(row => row.id === parent.id);
      assert.equal(splitRemote.amount, -300);
      assert.equal(splitRemote.error.difference, 10);
      assert.equal(
        splitRemote.subtransactions.find(row => row.id === child.id).amount,
        -210,
      );
      const siblingStale = await prepare(
        child.transfer_id,
        'transfer-sibling-stale',
        { amount: 220 },
      );
      await cli(
        [
          'transactions',
          'update',
          sibling.id,
          '--data',
          '{"notes":"concurrent sibling"}',
        ],
        { client: 'independent' },
      );
      const staleSplit = await f.cli([
        'changes',
        'apply',
        siblingStale.operationId,
        '--token',
        siblingStale.token,
      ]);
      assert.equal(staleSplit.code, 4, staleSplit.stdout + staleSplit.stderr);
      assert.equal(
        (await cli(list(f.fixture.savings))).find(
          row => row.id === child.transfer_id,
        ).amount,
        210,
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'guarded split edits preserve preview data, inherit parent fields, and reject sibling edits',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const list = [
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ];
      const before = await cli(list);
      const parent = before.find(row => row.imported_id === 'split');
      const preview = await cli([
        'changes',
        'preview',
        'transactions.update',
        parent.id,
        '--operation-id',
        'split-parent',
        '--data',
        '{"date":"2026-08-05","cleared":true}',
      ]);
      assert.equal(preview.proposal.before.length, 3);
      assert.deepEqual(await cli(list), before);
      const backup = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'split-preview-proof'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', backup.path])).snapshot,
        f.fixture.snapshot,
      );
      const applied = await cli([
        'changes',
        'apply',
        'split-parent',
        '--token',
        preview.token,
      ]);
      assert.equal(applied.state, 'synced');
      assert.deepEqual(
        [...applied.outcome.affectedIds].sort((left, right) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
        preview.proposal.before
          .map(row => row.id)
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      );
      const remote = (await cli(list, { client: 'independent' })).find(
        row => row.id === parent.id,
      );
      assert.equal(remote.date, '2026-08-05');
      assert.ok(
        remote.subtransactions.every(
          row => row.date === remote.date && row.cleared,
        ),
      );
      assert.deepEqual(
        remote.subtransactions.map(row => row.amount),
        parent.subtransactions.map(row => row.amount),
      );
      assert.deepEqual(
        (
          await cli([
            'changes',
            'apply',
            'split-parent',
            '--token',
            preview.token,
          ])
        ).outcome,
        applied.outcome,
      );
      const [child, sibling] = remote.subtransactions;
      const stale = await cli([
        'changes',
        'preview',
        'transactions.update',
        child.id,
        '--operation-id',
        'split-stale',
        '--data',
        '{"notes":"proposed child"}',
      ]);
      await cli(
        [
          'transactions',
          'update',
          sibling.id,
          '--data',
          '{"notes":"concurrent sibling"}',
        ],
        { client: 'independent' },
      );
      const rejected = await f.cli([
        'changes',
        'apply',
        'split-stale',
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      const updated = await cli([
        'changes',
        'preview',
        'transactions.update',
        child.id,
        '--operation-id',
        'split-child',
        '--data',
        JSON.stringify({ notes: 'guarded child', amount: child.amount - 100 }),
      ]);
      assert.equal(
        updated.proposal.after.find(row => row.id === parent.id).error
          .difference,
        100,
      );
      await cli(['changes', 'apply', 'split-child', '--token', updated.token]);
      const final = (await cli(list, { client: 'independent' })).find(
        row => row.id === parent.id,
      );
      assert.equal(final.amount, parent.amount);
      assert.equal(
        final.subtransactions.find(row => row.id === child.id).amount,
        child.amount - 100,
      );
      assert.equal(
        final.subtransactions.find(row => row.id === sibling.id).notes,
        'concurrent sibling',
      );
      const transfer = before.find(row => row.transfer_id);
      const linked = await cli([
        'changes',
        'preview',
        'transactions.update',
        transfer.id,
        '--operation-id',
        'split-transfer',
        '--data',
        '{"notes":"linked transfer preview"}',
      ]);
      assert.equal(linked.state, 'prepared');
      assert.equal(linked.proposal.before.length, 2);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'guarded transaction preview preserves domains and receipts prevent repeat writes',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const list = [
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ];
      const before = await cli(list);
      const row = before.find(row => row.imported_id === 'uncategorized');
      assert.ok(row);
      const prepared = await cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        'edit-first',
        '--data',
        JSON.stringify({ notes: 'Guarded edit', amount: -1234 }),
      ]);
      assert.equal(prepared.state, 'prepared');
      assert.equal(prepared.proposal.budget.id, f.fixture.budgetId);
      assert.deepEqual(await cli(list), before);
      const artifact = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        f.root + '/preview-proof',
      ]);
      const validated = await cli(['backups', 'validate', artifact.path]);
      assert.deepEqual(validated.snapshot, f.fixture.snapshot);
      const changed = await cli([
        '--offline',
        'changes',
        'apply',
        'edit-first',
        '--token',
        prepared.token,
      ]);
      assert.equal(changed.state, 'committed-local');
      assert.equal(changed.outcome.changed, true);
      const synced = await cli([
        'changes',
        'apply',
        'edit-first',
        '--token',
        prepared.token,
      ]);
      assert.equal(synced.state, 'synced');
      assert.deepEqual(synced.outcome, changed.outcome);
      const again = await cli([
        'changes',
        'apply',
        'edit-first',
        '--token',
        prepared.token,
      ]);
      assert.deepEqual(again.outcome, changed.outcome);
      assert.equal(
        (await cli(list, { client: 'independent' })).find(
          item => item.id === row.id,
        ).amount,
        -1234,
      );
      assert.equal(
        (await cli(['changes', 'status', 'edit-first'])).state,
        'synced',
      );
      const stale = await cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        'edit-stale',
        '--data',
        '{"notes":"stale"}',
      ]);
      await cli(
        ['transactions', 'update', row.id, '--data', '{"notes":"concurrent"}'],
        { client: 'independent' },
      );
      const rejected = await f.cli([
        'changes',
        'apply',
        'edit-stale',
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(['changes', 'status', 'edit-stale'])).state,
        'failed-before-commit',
      );
      const wrong = await cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        'edit-wrong',
        '--data',
        '{"notes":"wrong budget"}',
      ]);
      const cloned = await cli([
        '--offline',
        'budgets',
        'clone',
        '--name',
        'Change isolation copy',
        '--operation-id',
        'change-isolation-clone',
      ]);
      const isolated = await f.cli([
        '--offline',
        '--budget-id',
        cloned.id,
        'changes',
        'apply',
        'edit-wrong',
        '--token',
        wrong.token,
      ]);
      assert.equal(isolated.code, 3, isolated.stdout + isolated.stderr);
      assert.equal(
        (await cli(['changes', 'status', 'edit-wrong'])).state,
        'prepared',
      );
      const inventory = await cli(['changes', 'list', '--limit', '1']);
      assert.equal(inventory.items.length, 1);
      assert.equal(inventory.total, 4);
      assert.equal(inventory.truncated, true);
      const unlocked = await f.cli([
        '--no-lock',
        'changes',
        'apply',
        'edit-first',
        '--token',
        prepared.token,
      ]);
      assert.equal(unlocked.code, 2);
    } finally {
      await f.dispose();
    }
  },
);

for (const { phase, operation } of [
  ...['before-engine', 'after-engine', 'before-sync'].map(phase => ({
    phase,
    operation: 'transactions.update',
  })),
  ...['before-engine', 'after-engine', 'before-sync'].map(phase => ({
    phase,
    operation: 'accounts.create',
  })),
  ...['before-engine', 'after-engine', 'before-sync'].map(phase => ({
    phase,
    operation: 'accounts.update',
  })),
  ...['before-engine', 'after-engine', 'before-sync'].map(phase => ({
    phase,
    operation: 'accounts.reopen',
  })),
  ...['before-engine', 'after-engine'].map(phase => ({
    phase,
    operation: 'budgets.archive',
  })),
  ...['before-engine', 'after-engine'].map(phase => ({
    phase,
    operation: 'budgets.create',
  })),
  ...['before-engine', 'after-engine'].map(phase => ({
    phase,
    operation: 'budgets.clone',
  })),
  ...['before-engine', 'after-engine'].map(phase => ({
    phase,
    operation: 'backups.restore',
  })),
  ...['budgets.hold-next-month', 'budgets.reset-hold'].flatMap(operation =>
    ['before-engine', 'after-engine'].map(phase => ({ phase, operation })),
  ),
]) {
  void test(
    `killed apply at ${phase} (${operation}) preserves its durable outcome and never replays`,
    { timeout: 100000 },
    async () => {
      const f = await createFixture({
        encrypted: true,
        richBackup: ['budgets.clone', 'backups.restore'].includes(operation),
      });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        const list = [
          '--offline',
          'transactions',
          'list',
          '--account',
          f.fixture.checking,
          '--start',
          '2026-08-01',
          '--end',
          '2026-08-31',
        ];
        await cli(['accounts', 'list']);
        const holds = operation === 'budgets.hold-next-month';
        const resets = operation === 'budgets.reset-hold';
        if (holds || resets) {
          await fundHoldFixture(f);
          if (resets) {
            await cli([
              'budgets',
              'hold-next-month',
              '--month',
              '2026-08',
              '--amount',
              '5000',
              '--operation-id',
              'crash-hold-setup',
            ]);
          }
        }
        const initialBuffer =
          holds || resets
            ? (await cli(['--offline', 'budgets', 'month', '2026-08']))
                .forNextMonth
            : null;
        const initial = (await cli(list)).find(
          row => row.imported_id === 'uncategorized',
        );
        const creates = operation === 'budgets.create';
        const accountCreates = operation === 'accounts.create';
        const accountUpdates = operation === 'accounts.update';
        const accountReopens = operation === 'accounts.reopen';
        if (accountReopens) {
          const closing = await cli([
            'changes',
            'preview',
            'accounts.update',
            f.fixture.checking,
            '--operation-id',
            'reopen-crash-fixture-close',
            '--data',
            '{"closed":true}',
          ]);
          await cli([
            'changes',
            'apply',
            'reopen-crash-fixture-close',
            '--token',
            closing.token,
          ]);
        }

        const accountsBefore =
          accountCreates || accountUpdates || accountReopens
            ? await cli([
                '--offline',
                'accounts',
                'list',
                ...(accountReopens ? ['--include-closed'] : []),
              ])
            : null;
        const clones = operation === 'budgets.clone';
        const restores = operation === 'backups.restore';
        const restoreArtifact = restores
          ? await cli([
              '--offline',
              'backups',
              'create',
              '--directory',
              join(f.root, 'crash-restore-input'),
            ])
          : null;
        const restoreBytes = restores
          ? await readFile(join(restoreArtifact.path, 'budget.zip'))
          : null;
        const destinationName = clones
          ? 'Crash-cloned destination'
          : restores
            ? 'Crash-restored destination'
            : 'Crash-created destination';
        const sourcePaths = (
          clones ? ['metadata.json'] : ['db.sqlite', 'metadata.json']
        ).map(name => join(f.root, 'a', f.fixture.budgetId, name));
        const sourceBefore =
          creates || clones || restores
            ? await Promise.all(sourcePaths.map(path => readFile(path)))
            : [];
        const remoteBefore =
          creates || clones || restores
            ? await cli(['budgets', 'list'], { client: 'seed' })
            : null;
        const id = 'kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          operation,
          ...(creates || restores || holds || resets || accountCreates
            ? []
            : [
                accountUpdates || accountReopens
                  ? f.fixture.checking
                  : operation === 'budgets.archive' || clones
                    ? f.fixture.budgetId
                    : initial.id,
              ]),
          '--operation-id',
          id,
          '--data',
          accountReopens
            ? '{}'
            : accountUpdates
              ? '{"name":"Interrupted account update","offbudget":true}'
              : accountCreates
                ? '{"name":"Interrupted cash","offbudget":false,"initialBalance":23456}'
                : holds
                  ? '{"month":"2026-08","amount":5000}'
                  : resets
                    ? '{"month":"2026-08"}'
                    : restores
                      ? JSON.stringify({
                          path: restoreArtifact.path,
                          name: destinationName,
                        })
                      : creates
                        ? '{"name":"Crash-created destination","currency":"USD"}'
                        : clones
                          ? JSON.stringify({ name: destinationName })
                          : operation === 'budgets.archive'
                            ? '{"archived":true}'
                            : '{"notes":"Committed once","amount":-1777}',
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(
            Date.now() < deadline,
            'Exact crash checkpoint was not observed: ' + stderr,
          );
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const path = join(f.root, 'a/.actual-cli/changes', id + '.json');
        const published = JSON.parse(await readFile(path, 'utf8'));
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        // The normal lock library recovers abandoned gates after its stale window.
        const options = { timeout: 60000 };
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          options,
        );
        assert.equal(recovered.state, published.state);
        assert.equal(recovered.token, published.token);
        assert.deepEqual(
          (await readdir(join(f.root, 'a/.actual-cli/changes'))).filter(name =>
            name.endsWith('.pending'),
          ),
          [],
        );
        let reopenedAccounts;
        if (accountReopens) {
          reopenedAccounts = await cli([
            '--offline',
            'accounts',
            'list',
            '--include-closed',
          ]);
          const before = accountsBefore.find(
            account => account.id === f.fixture.checking,
          );
          assert.deepEqual(
            reopenedAccounts.find(account => account.id === f.fixture.checking),
            { ...before, closed: phase === 'before-engine' },
          );
          assert.deepEqual(
            reopenedAccounts.filter(
              account => account.id !== f.fixture.checking,
            ),
            accountsBefore.filter(account => account.id !== f.fixture.checking),
          );
          assert.equal(
            (await cli(['--offline', 'accounts', 'list'])).some(
              account => account.id === f.fixture.checking,
            ),
            phase !== 'before-engine',
          );
        }
        let updatedAccounts;
        if (accountUpdates) {
          updatedAccounts = await cli(['--offline', 'accounts', 'list']);
          const before = accountsBefore.find(
            account => account.id === f.fixture.checking,
          );
          const actual = updatedAccounts.find(
            account => account.id === f.fixture.checking,
          );
          assert.equal(updatedAccounts.length, accountsBefore.length);
          assert.equal(actual.balance, before.balance);
          assert.equal(
            actual.name,
            phase === 'before-engine'
              ? before.name
              : 'Interrupted account update',
          );
          assert.equal(
            actual.offbudget,
            phase === 'before-engine' ? before.offbudget : true,
          );
          assert.deepEqual(
            updatedAccounts.filter(
              account => account.id !== f.fixture.checking,
            ),
            accountsBefore.filter(account => account.id !== f.fixture.checking),
          );
        }
        let creationInventory;
        let createdAccounts;
        let openingRows;
        if (accountCreates) {
          createdAccounts = await cli(['--offline', 'accounts', 'list']);
          assert.equal(
            createdAccounts.length,
            accountsBefore.length + (phase === 'before-engine' ? 0 : 1),
          );
          const account = createdAccounts.find(
            row => row.name === 'Interrupted cash',
          );
          if (phase === 'before-engine') {
            assert.equal(account, undefined);
          } else {
            assert.equal(account.balance, 23456);
            const date = recovered.proposal.after.openingTransaction.date;
            openingRows = await cli([
              '--offline',
              'transactions',
              'list',
              '--account',
              account.id,
              '--start',
              date,
              '--end',
              date,
            ]);
            assert.equal(openingRows.length, 1);
            assert.equal(openingRows[0].amount, 23456);
            assert.equal(openingRows[0].cleared, true);
            if (phase === 'before-sync') {
              const proof = recovered.outcome.accountCreation;
              assert.equal(proof.accountId, account.id);
              assert.equal(proof.openingTransactionId, openingRows[0].id);
              assert.equal(proof.startingBalancePayeeId, openingRows[0].payee);
              assert.ok(proof.transferPayeeId);
            } else {
              assert.equal(recovered.outcome, undefined);
            }
          }
        }
        if (creates || clones || restores) {
          assert.deepEqual(
            await Promise.all(sourcePaths.map(path => readFile(path))),
            sourceBefore,
          );
          creationInventory = await cli(['--offline', 'budgets', 'list']);
          const destinations = creationInventory.filter(
            budget => budget.name === destinationName,
          );
          assert.equal(destinations.length, phase === 'after-engine' ? 1 : 0);
          if (creates || restores) {
            assert.equal(recovered.proposal.budget, null);
          } else {
            assert.equal(recovered.proposal.budget.id, f.fixture.budgetId);
          }
          assert.equal(recovered.proposal.delivery, 'local-only');
          if (restores) {
            assert.deepEqual(
              await readFile(join(restoreArtifact.path, 'budget.zip')),
              restoreBytes,
            );
            assert.equal(recovered.artifact.path, restoreArtifact.path);
            assert.equal(
              recovered.proposal.before.sha256,
              restoreArtifact.manifest.sha256,
            );
          }
          if (destinations[0]) {
            const destination = await cli([
              '--offline',
              '--budget-id',
              destinations[0].id,
              'budgets',
              'inspect',
            ]);
            assert.equal(destination.syncId, null);
            assert.equal(destination.cloudFileId, null);
            assert.equal(
              destination.currency,
              clones
                ? recovered.proposal.before.currency
                : restores
                  ? restoreArtifact.manifest.source.currency
                  : 'USD',
            );
            if (clones || restores) {
              const backup = await cli([
                '--offline',
                '--budget-id',
                destination.id,
                'backups',
                'create',
                '--directory',
                join(f.root, 'crash-clone-copy-proof'),
              ]);
              assert.deepEqual(
                (await cli(['backups', 'validate', backup.path])).snapshot,
                f.fixture.snapshot,
              );
            }
          }
          assert.deepEqual(
            await cli(['budgets', 'list'], { client: 'seed' }),
            remoteBefore,
          );
        }
        const row = (await cli(list)).find(row => row.id === initial.id);
        const buffer =
          holds || resets
            ? (await cli(['--offline', 'budgets', 'month', '2026-08']))
                .forNextMonth
            : null;
        if (holds || resets) {
          assert.equal(
            buffer,
            phase === 'before-engine' ? initialBuffer : holds ? 5000 : 0,
          );
        }
        assert.equal(
          row.amount,
          phase === 'before-engine' || operation !== 'transactions.update'
            ? initial.amount
            : -1777,
        );
        if (operation === 'budgets.archive') {
          assert.equal(
            (await cli(['--offline', 'budgets', 'inspect'])).archived,
            phase === 'after-engine',
          );
          assert.equal(recovered.proposal.delivery, 'local-only');
          assert.equal(
            (await cli(['budgets', 'inspect'], { client: 'independent' }))
              .archived,
            false,
          );
        }
        if (clones || restores) {
          const backup = await cli([
            '--offline',
            'backups',
            'create',
            '--directory',
            join(f.root, 'crash-clone-source-proof'),
          ]);
          assert.deepEqual(
            (await cli(['backups', 'validate', backup.path])).snapshot,
            f.fixture.snapshot,
          );
        }
        const status = await cli(['--offline', 'sync', 'status']);
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        if (phase !== 'before-sync') {
          assert.equal(JSON.parse(attempt.stdout).context.commit, 'uncertain');
        }
        if (creates || clones || restores) {
          assert.deepEqual(
            await cli(['--offline', 'budgets', 'list']),
            creationInventory,
          );
        }
        const again = (await cli(list)).find(row => row.id === initial.id);
        if (accountReopens) {
          assert.deepEqual(
            await cli(['--offline', 'accounts', 'list', '--include-closed']),
            reopenedAccounts,
          );
        }

        if (accountUpdates) {
          assert.deepEqual(
            await cli(['--offline', 'accounts', 'list']),
            updatedAccounts,
          );
        }

        if (accountCreates) {
          assert.deepEqual(
            await cli(['--offline', 'accounts', 'list']),
            createdAccounts,
          );
          if (openingRows) {
            const account = createdAccounts.find(
              row => row.name === 'Interrupted cash',
            );
            const date = recovered.proposal.after.openingTransaction.date;
            assert.deepEqual(
              await cli([
                '--offline',
                'transactions',
                'list',
                '--account',
                account.id,
                '--start',
                date,
                '--end',
                date,
              ]),
              openingRows,
            );
          }
        }
        if (holds || resets) {
          assert.equal(
            (await cli(['--offline', 'budgets', 'month', '2026-08']))
              .forNextMonth,
            buffer,
          );
        }
        assert.deepEqual(again, row);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          status.pendingMessages,
        );
        if (phase === 'before-sync') {
          assert.ok(status.pendingMessages > 0);

          if (accountReopens) {
            const remoteAccount = (
              await cli(['accounts', 'list', '--include-closed'], {
                client: 'independent',
              })
            ).find(account => account.id === f.fixture.checking);
            assert.deepEqual(
              remoteAccount,
              accountsBefore.find(account => account.id === f.fixture.checking),
            );
          }
          if (accountUpdates) {
            const remoteAccount = (
              await cli(['accounts', 'list'], { client: 'independent' })
            ).find(account => account.id === f.fixture.checking);
            assert.deepEqual(
              remoteAccount,
              accountsBefore.find(account => account.id === f.fixture.checking),
            );
          }
          if (accountCreates) {
            assert.equal(
              (await cli(['accounts', 'list'], { client: 'independent' })).some(
                row => row.name === 'Interrupted cash',
              ),
              false,
            );
          }
          const remote = await cli(list.slice(1), { client: 'independent' });
          assert.equal(
            remote.find(item => item.id === initial.id).amount,
            initial.amount,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          if (accountReopens) {
            const remoteAccount = (
              await cli(
                ['--require-fresh', 'accounts', 'list', '--include-closed'],
                { client: 'independent' },
              )
            ).find(account => account.id === f.fixture.checking);
            assert.deepEqual(
              remoteAccount,
              reopenedAccounts.find(
                account => account.id === f.fixture.checking,
              ),
            );
          }

          if (accountUpdates) {
            const remoteAccount = (
              await cli(['--require-fresh', 'accounts', 'list'], {
                client: 'independent',
              })
            ).find(account => account.id === f.fixture.checking);
            assert.deepEqual(
              remoteAccount,
              updatedAccounts.find(
                account => account.id === f.fixture.checking,
              ),
            );
          }
          if (accountCreates) {
            const remoteAccounts = await cli(
              ['--require-fresh', 'accounts', 'list'],
              { client: 'independent' },
            );
            const actual = remoteAccounts.find(
              row => row.id === synced.outcome.accountCreation.accountId,
            );
            assert.equal(actual.balance, 23456);
            assert.equal(actual.name, 'Interrupted cash');
            assert.deepEqual(
              await cli(['--offline', 'accounts', 'list']),
              createdAccounts,
            );
          }
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

void test(
  'a rejected post-commit push retains a receipt and later sync never replays the update',
  { timeout: 90000 },
  async () => {
    const { fromBinary, SyncRequestSchema } = await import(
      pathToFileURL(join(repoRoot, 'packages/crdt/dist/index.js')).href
    );
    const f = await createFixture({ encrypted: true });
    let rejectWrites = false;
    let rejected = 0;
    const proxy = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (
          rejectWrites &&
          req.url === '/sync/sync' &&
          fromBinary(SyncRequestSchema, body).messages.length > 0
        ) {
          rejected++;
          res.destroy();
          return;
        }
        const headers = { ...req.headers };
        delete headers.host;
        const upstream = await fetch(f.serverUrl + req.url, {
          method: req.method,
          headers,
          ...(req.method === 'GET' ? {} : { body }),
        });
        res.writeHead(upstream.status, {
          'Content-Type':
            upstream.headers.get('content-type') ?? 'application/json',
        });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        res.destroy();
      }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const env = {
      ACTUAL_SERVER_URL: `http://127.0.0.1:${proxy.address().port}`,
    };
    try {
      const cli = async (args, options = { env }) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const list = [
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ];
      const row = (await cli(list)).find(
        row => row.imported_id === 'uncategorized',
      );
      const proposal = await cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        'push-failure',
        '--data',
        '{"amount":-1444,"notes":"Receipt commit"}',
      ]);
      rejectWrites = true;
      const applied = await f.cli(
        ['changes', 'apply', 'push-failure', '--token', proposal.token],
        { env },
      );
      assert.equal(applied.code, 6, applied.stdout + applied.stderr);
      assert.equal(
        JSON.parse(applied.stdout).context.commit,
        'committed-local',
      );
      assert.ok(rejected > 0);
      const receipt = await cli(['changes', 'status', 'push-failure']);
      assert.equal(receipt.state, 'committed-local');
      assert.equal(receipt.outcome.changed, true);
      assert.equal(
        (await cli(['--offline', ...list])).find(item => item.id === row.id)
          .amount,
        -1444,
      );
      rejectWrites = false;
      const synced = await cli([
        'changes',
        'apply',
        'push-failure',
        '--token',
        proposal.token,
      ]);
      assert.equal(synced.state, 'synced');
      assert.deepEqual(synced.outcome, receipt.outcome);
      assert.deepEqual(
        (
          await cli([
            'changes',
            'apply',
            'push-failure',
            '--token',
            proposal.token,
          ])
        ).outcome,
        receipt.outcome,
      );
      const remote = await cli(['--require-fresh', ...list], {
        client: 'independent',
      });
      assert.equal(remote.find(item => item.id === row.id).amount, -1444);
      assert.equal(remote.filter(item => item.id === row.id).length, 1);
    } finally {
      await new Promise(resolve => proxy.close(resolve));
      await f.dispose();
    }
  },
);

for (const offline of [false, true]) {
  void test(
    `guarded account reopening preserves provider fields and retries retain later closure (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const id = f.fixture.checking;
        const changeClosed = async (operationId, closed) => {
          const prepared = await cli([
            'changes',
            'preview',
            'accounts.update',
            id,
            '--operation-id',
            operationId,
            '--data',
            JSON.stringify({ closed }),
          ]);
          return cli([
            'changes',
            'apply',
            operationId,
            '--token',
            prepared.token,
          ]);
        };
        await changeClosed('reopen-fixture-close', true);
        const { default: Database } = await import('better-sqlite3');
        assert.ok(f.root.includes('actual-agent-cli-'));
        const accountPath = join(f.root, 'a', f.fixture.budgetId, 'db.sqlite');
        const fixtureDatabase = new Database(accountPath, {
          fileMustExist: true,
        });
        try {
          fixtureDatabase
            .prepare(
              'UPDATE accounts SET account_id = ?, bank = ?, account_sync_source = ?, mask = ?, balance_current = ? WHERE id = ?',
            )
            .run(
              'synthetic-provider-account',
              'synthetic-bank',
              'simplefin',
              '4321',
              3333,
              id,
            );
        } finally {
          fixtureDatabase.close();
        }
        const storedAccounts = () => {
          const database = new Database(accountPath, {
            readonly: true,
            fileMustExist: true,
          });
          try {
            return database.prepare('SELECT * FROM accounts ORDER BY id').all();
          } finally {
            database.close();
          }
        };
        const originalAccounts = storedAccounts();
        const original = originalAccounts.find(account => account.id === id);
        assert.equal(original.closed, 1);
        const mode = offline ? ['--offline'] : [];
        const archive = async () => {
          const artifact = await cli([
            '--offline',
            'backups',
            'create',
            '--directory',
            join(f.root, 'reopen-proof'),
          ]);
          return (await cli(['backups', 'validate', artifact.path])).snapshot;
        };
        const baseline = await archive();
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'accounts.reopen',
          id,
          '--operation-id',
          'reopen-preview',
          '--data',
          '{}',
        ]);
        assert.deepEqual(await archive(), baseline);
        assert.deepEqual(storedAccounts(), originalAccounts);
        assert.equal(prepared.proposal.before.account.closed, true);
        assert.equal(prepared.proposal.after.account.closed, false);
        const args = [
          ...mode,
          'accounts',
          'reopen',
          id,
          '--operation-id',
          'reopen-first',
        ];
        const first = await cli(args);
        assert.equal(first.success, true);
        assert.equal(first.id, id);
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        assert.equal(first.receipt.outcome.changed, true);
        assert.deepEqual(
          storedAccounts(),
          originalAccounts.map(account =>
            account.id === id ? { ...account, closed: 0 } : account,
          ),
        );
        assert.ok(
          (await cli([...mode, 'accounts', 'list'])).some(
            account => account.id === id,
          ),
        );
        const stale = await f.cli([
          ...mode,
          'changes',
          'apply',
          'reopen-preview',
          '--token',
          prepared.token,
        ]);
        assert.equal(stale.code, 4, stale.stdout + stale.stderr);
        const noop = await cli([
          ...mode,
          'accounts',
          'reopen',
          id,
          '--operation-id',
          'reopen-no-op',
        ]);
        assert.equal(noop.receipt.outcome.changed, false);
        const after = await archive();
        for (const table of Object.keys(baseline.tables).filter(
          name => name !== 'accounts',
        )) {
          assert.deepEqual(after.tables[table], baseline.tables[table], table);
        }
        assert.deepEqual(after.accountBalances, baseline.accountBalances);
        if (offline) await cli(['sync']);
        assert.ok(
          (
            await cli(['--require-fresh', 'accounts', 'list'], {
              client: 'independent',
            })
          ).some(account => account.id === id),
        );
        await changeClosed('reopen-later-close', true);
        const later = storedAccounts();
        const repeated = await cli(args);
        assert.deepEqual(repeated.receipt.outcome, first.receipt.outcome);
        assert.deepEqual(storedAccounts(), later);
        assert.equal(
          (await cli([...mode, 'accounts', 'list'])).some(
            account => account.id === id,
          ),
          false,
        );
        const collision = await f.cli([
          ...mode,
          'accounts',
          'reopen',
          f.fixture.savings,
          '--operation-id',
          'reopen-first',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        const invalid = await f.cli([
          ...mode,
          'changes',
          'preview',
          'accounts.reopen',
          id,
          '--operation-id',
          'reopen-extra-fields',
          '--data',
          '{"closed":false}',
        ]);
        assert.equal(invalid.code, 2, invalid.stdout + invalid.stderr);
        const legacy = await f.cli([...mode, 'accounts', 'reopen', id], {
          version: '1',
        });
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), { success: true, id });
        assert.deepEqual(
          storedAccounts(),
          later.map(account =>
            account.id === id ? { ...account, closed: 0 } : account,
          ),
        );
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const offline of [false, true]) {
  void test(
    `guarded account updates preserve ledger and retries retain later account edits (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const { default: Database } = await import('better-sqlite3');
        assert.ok(f.root.includes('actual-agent-cli-'));
        const storedPayees = () => {
          const database = new Database(
            join(f.root, 'a', f.fixture.budgetId, 'db.sqlite'),
            { readonly: true, fileMustExist: true },
          );
          try {
            return database.prepare('SELECT * FROM payees ORDER BY id').all();
          } finally {
            database.close();
          }
        };
        const originalStoredPayees = storedPayees();
        const originalDisplayedPayees = (
          await cli([...mode, 'payees', 'list'])
        ).sort((a, b) => a.id.localeCompare(b.id));

        const archive = async () => {
          const artifact = await cli([
            '--offline',
            'backups',
            'create',
            '--directory',
            join(f.root, 'account-update-proof'),
          ]);
          return (await cli(['backups', 'validate', artifact.path])).snapshot;
        };
        const baseline = await archive();
        const id = f.fixture.checking;
        const original = (await cli([...mode, 'accounts', 'list'])).find(
          account => account.id === id,
        );
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'accounts.update',
          id,
          '--operation-id',
          'account-update-preview',
          '--data',
          '{"name":"Renamed checking","offbudget":true}',
        ]);
        assert.deepEqual(await archive(), baseline);
        assert.equal(prepared.proposal.before.account.name, original.name);
        assert.equal(prepared.proposal.after.account.name, 'Renamed checking');
        assert.equal(prepared.proposal.after.account.offbudget, true);
        for (const payee of prepared.proposal.after.transferPayees) {
          assert.equal(payee.name, 'Renamed checking');
        }
        const args = (
          operationId,
          name = 'Renamed checking',
          offbudget = 'true',
        ) => [
          ...mode,
          'accounts',
          'update',
          id,
          '--name',
          name,
          '--offbudget',
          offbudget,
          '--operation-id',
          operationId,
        ];
        const first = await cli(args('account-update-first'));
        assert.equal(first.id, id);
        assert.equal(first.success, true);
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        assert.equal(first.receipt.outcome.changed, true);
        const actual = (await cli([...mode, 'accounts', 'list'])).find(
          account => account.id === id,
        );
        assert.deepEqual(actual, {
          ...original,
          name: 'Renamed checking',
          offbudget: true,
        });
        const collision = await f.cli(
          args('account-update-first', 'Conflicting name'),
        );
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        const stale = await f.cli([
          ...mode,
          'changes',
          'apply',
          'account-update-preview',
          '--token',
          prepared.token,
        ]);
        assert.equal(stale.code, 4, stale.stdout + stale.stderr);
        await cli(args('account-update-later', 'Later checking', 'false'));
        const repeated = await cli(args('account-update-first'));
        assert.deepEqual(repeated.receipt.outcome, first.receipt.outcome);
        const later = (await cli([...mode, 'accounts', 'list'])).find(
          account => account.id === id,
        );
        assert.deepEqual(later, {
          ...original,
          name: 'Later checking',
          offbudget: false,
        });
        const noChange = await cli(
          args('account-update-no-op', 'Later checking', 'false'),
        );
        assert.equal(noChange.receipt.outcome.changed, false);
        const after = await archive();
        for (const table of Object.keys(baseline.tables).filter(
          name => !['accounts', 'payees'].includes(name),
        )) {
          assert.deepEqual(after.tables[table], baseline.tables[table], table);
        }
        assert.deepEqual(storedPayees(), originalStoredPayees);
        assert.deepEqual(
          (await cli([...mode, 'payees', 'list'])).sort((a, b) =>
            a.id.localeCompare(b.id),
          ),
          originalDisplayedPayees.map(payee =>
            payee.transfer_acct === id
              ? { ...payee, name: 'Later checking' }
              : payee,
          ),
        );
        assert.equal(after.tables.payees.rows, baseline.tables.payees.rows);
        assert.notEqual(
          after.tables.payees.sha256,
          baseline.tables.payees.sha256,
        );
        assert.deepEqual(after.accountBalances, baseline.accountBalances);
        if (offline) await cli(['sync']);
        const independent = await cli(['--require-fresh', 'accounts', 'list'], {
          client: 'independent',
        });
        assert.deepEqual(
          independent.find(account => account.id === id),
          later,
        );
        const legacy = await f.cli(
          [...mode, 'accounts', 'update', id, '--name', 'Legacy checking'],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), { success: true, id });
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const offline of [false, true]) {
  void test(
    `guarded account creation acknowledges actual identities and retries one account (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const archive = async () => {
          const artifact = await cli([
            '--offline',
            'backups',
            'create',
            '--directory',
            join(f.root, 'account-proof'),
          ]);
          return (await cli(['backups', 'validate', artifact.path])).snapshot;
        };
        const baseline = await archive();
        const amount = offline ? -32100 : 12345;
        const request = {
          name: 'Receipt cash',
          offbudget: offline,
          initialBalance: amount,
        };
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'accounts.create',
          '--operation-id',
          'account-preview',
          '--data',
          JSON.stringify(request),
        ]);
        assert.deepEqual(await archive(), baseline);
        const args = (id, balance = amount) => [
          ...mode,
          'accounts',
          'create',
          '--name',
          request.name,
          '--balance',
          String(balance),
          ...(offline ? ['--offbudget'] : []),
          '--operation-id',
          id,
        ];
        const first = await cli(args('account-first'));
        const proof = first.receipt.outcome.accountCreation;
        assert.equal(first.id, proof.accountId);
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        assert.ok(proof.transferPayeeId);
        assert.ok(proof.openingTransactionId);
        assert.ok(proof.startingBalancePayeeId);
        const date = first.receipt.proposal.after.openingTransaction.date;
        const rows = await cli([
          ...mode,
          'transactions',
          'list',
          '--account',
          first.id,
          '--start',
          date,
          '--end',
          date,
        ]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, proof.openingTransactionId);
        assert.equal(rows[0].amount, amount);
        assert.equal(rows[0].cleared, true);
        assert.equal(rows[0].payee, proof.startingBalancePayeeId);
        if (offline) assert.equal(rows[0].category, null);
        const payees = await cli([...mode, 'payees', 'list']);
        assert.equal(
          payees.find(row => row.id === proof.transferPayeeId).transfer_acct,
          first.id,
        );
        const collision = await f.cli(args('account-first', 99999));
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        const stale = await f.cli([
          ...mode,
          'changes',
          'apply',
          'account-preview',
          '--token',
          prepared.token,
        ]);
        assert.equal(stale.code, 4, stale.stdout + stale.stderr);
        const second = await cli(args('account-second', 0));
        assert.notEqual(second.id, first.id);
        assert.equal(
          second.receipt.outcome.accountCreation.openingTransactionId,
          null,
        );
        assert.equal(
          second.receipt.outcome.accountCreation.startingBalancePayeeId,
          null,
        );
        const rename = await f.cli(
          [
            ...mode,
            'accounts',
            'update',
            first.id,
            '--name',
            'Later account name',
          ],
          { version: '1' },
        );
        assert.equal(rename.code, 0, rename.stdout + rename.stderr);
        const repeated = await cli(args('account-first'));
        assert.equal(repeated.id, first.id);
        assert.deepEqual(repeated.receipt.outcome, first.receipt.outcome);
        const accounts = await cli([...mode, 'accounts', 'list']);
        assert.equal(
          accounts.find(row => row.id === first.id).name,
          'Later account name',
        );
        assert.equal(
          accounts.filter(row => [first.id, second.id].includes(row.id)).length,
          2,
        );
        const after = await archive();
        for (const table of Object.keys(baseline.tables).filter(
          name => !['accounts', 'payees', 'transactions'].includes(name),
        )) {
          assert.deepEqual(after.tables[table], baseline.tables[table], table);
        }
        assert.deepEqual(
          after.accountBalances.filter(
            row => ![first.id, second.id].includes(row.id),
          ),
          baseline.accountBalances,
        );
        if (offline) await cli(['sync']);
        const remote = await cli(['--require-fresh', 'accounts', 'list'], {
          client: 'independent',
        });
        assert.equal(remote.find(row => row.id === first.id).balance, amount);
        assert.equal(
          remote.find(row => row.id === first.id).name,
          'Later account name',
        );
        const legacy = await f.cli(
          [...mode, 'accounts', 'create', '--name', 'Legacy cash'],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.ok(JSON.parse(legacy.stdout).id);
        assert.equal(JSON.parse(legacy.stdout).receipt, undefined);
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const offline of [false, true]) {
  void test(
    `guarded holds clamp funds and receipts preserve later hold and reset writes (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await fundHoldFixture(f);
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const monthArgs = ['budgets', 'month', '2026-08'];
        const before = await cli([...mode, ...monthArgs]);
        assert.ok(
          before.toBudget > 0,
          JSON.stringify({
            toBudget: before.toBudget,
            incomeAvailable: before.incomeAvailable,
            totalIncome: before.totalIncome,
            totalBudgeted: before.totalBudgeted,
            forNextMonth: before.forNextMonth,
            fromLastMonth: before.fromLastMonth,
            lastMonthOverspent: before.lastMonthOverspent,
          }),
        );
        const archive = async () => {
          const artifact = await cli([
            '--offline',
            'backups',
            'create',
            '--directory',
            join(f.root, 'hold-proof'),
          ]);
          return (await cli(['backups', 'validate', artifact.path])).snapshot;
        };
        const baseline = await archive();
        const preview = await cli([
          ...mode,
          'changes',
          'preview',
          'budgets.hold-next-month',
          '--operation-id',
          'hold-preview',
          '--data',
          JSON.stringify({ month: '2026-08', amount: Number.MAX_SAFE_INTEGER }),
        ]);
        assert.equal(
          preview.proposal.after.buffered,
          before.forNextMonth + before.toBudget,
        );
        assert.deepEqual(await archive(), baseline);
        const holdArgs = (id, amount) => [
          ...mode,
          'budgets',
          'hold-next-month',
          '--month',
          '2026-08',
          '--amount',
          String(amount),
          '--operation-id',
          id,
        ];
        const resetArgs = id => [
          ...mode,
          'budgets',
          'reset-hold',
          '--month',
          '2026-08',
          '--operation-id',
          id,
        ];
        const first = await cli(
          holdArgs('hold-first', Number.MAX_SAFE_INTEGER),
        );
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        assert.equal(
          first.receipt.proposal.after.buffered,
          preview.proposal.after.buffered,
        );
        assert.equal(
          (await cli([...mode, ...monthArgs])).forNextMonth,
          first.receipt.proposal.after.buffered,
        );
        const reset = await cli(resetArgs('reset-first'));
        assert.equal(reset.receipt.proposal.after.buffered, 0);
        assert.deepEqual(
          (await cli(holdArgs('hold-first', Number.MAX_SAFE_INTEGER))).receipt
            .outcome,
          first.receipt.outcome,
        );
        assert.equal((await cli([...mode, ...monthArgs])).forNextMonth, 0);
        const later = await cli(holdArgs('hold-later', 1234));
        assert.equal(later.receipt.proposal.after.buffered, 1234);
        assert.deepEqual(
          (await cli(resetArgs('reset-first'))).receipt.outcome,
          reset.receipt.outcome,
        );
        assert.equal((await cli([...mode, ...monthArgs])).forNextMonth, 1234);
        const collision = await f.cli(holdArgs('hold-first', 9999));
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        const stale = await f.cli([
          ...mode,
          'changes',
          'apply',
          'hold-preview',
          '--token',
          preview.token,
        ]);
        assert.equal(stale.code, 4, stale.stdout + stale.stderr);
        const after = await archive();
        assert.deepEqual(after, baseline);
        if (offline) {
          await cli(['sync']);
        }
        const remote = await cli(['--require-fresh', ...monthArgs], {
          client: 'independent',
        });
        assert.equal(remote.forNextMonth, 1234);
        const legacyReset = await f.cli(resetArgs('unused').slice(0, -2), {
          version: '1',
        });
        assert.equal(
          legacyReset.code,
          0,
          legacyReset.stdout + legacyReset.stderr,
        );
        assert.deepEqual(JSON.parse(legacyReset.stdout), { success: true });
        const legacyHold = await f.cli(holdArgs('unused', 2222).slice(0, -2), {
          version: '1',
        });
        assert.equal(legacyHold.code, 0, legacyHold.stdout + legacyHold.stderr);
        assert.deepEqual(JSON.parse(legacyHold.stdout), { success: true });
        assert.equal((await cli([...mode, ...monthArgs])).forNextMonth, 2222);
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const offline of [false, true]) {
  void test(
    `guarded carryover preserves preview domains and acknowledged retries (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const archive = async () => {
          const artifact = await cli([
            '--offline',
            'backups',
            'create',
            '--directory',
            join(f.root, 'carryover-proof'),
          ]);
          return (await cli(['backups', 'validate', artifact.path])).snapshot;
        };
        const baseline = await archive();
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'budgets.set-carryover',
          f.fixture.dining,
          '--operation-id',
          'carryover-preview',
          '--data',
          '{"month":"2026-08","flag":false}',
        ]);
        assert.equal(prepared.state, 'prepared');
        assert.ok(
          prepared.proposal.before.months.some(
            row => row.month === '2026-08' && row.carryover,
          ),
        );
        assert.deepEqual(await archive(), baseline);
        const args = (id, flag) => [
          ...mode,
          'budgets',
          'set-carryover',
          '--month',
          '2026-08',
          '--category',
          f.fixture.dining,
          '--flag',
          String(flag),
          '--operation-id',
          id,
        ];
        const first = await cli(args('carryover-first', false));
        assert.equal(first.success, true);
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        const stale = await f.cli([
          ...mode,
          'changes',
          'apply',
          'carryover-preview',
          '--token',
          prepared.token,
        ]);
        assert.equal(stale.code, 4, stale.stdout + stale.stderr);
        await cli(args('carryover-second', true));
        assert.deepEqual(
          (await cli(args('carryover-first', false))).receipt.outcome,
          first.receipt.outcome,
        );
        const collision = await f.cli(args('carryover-first', true));
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        const inspected = await cli([
          ...mode,
          'changes',
          'preview',
          'budgets.set-carryover',
          f.fixture.dining,
          '--operation-id',
          'carryover-inspection',
          '--data',
          '{"month":"2026-08","flag":true}',
        ]);
        assert.deepEqual(
          inspected.proposal.before.months.map(row => row.month),
          first.receipt.proposal.before.months.map(row => row.month),
        );
        for (const row of inspected.proposal.before.months) {
          assert.equal(row.carryover, true, row.month);
          assert.equal(row.row.carryover, 1, row.month);
          const original = first.receipt.proposal.before.months.find(
            item => item.month === row.month,
          ).row;
          if (original) {
            assert.deepEqual(row.row, { ...original, carryover: 1 });
          }
        }
        const selectedMonth = await cli([
          ...mode,
          'budgets',
          'month',
          '2026-08',
        ]);
        assert.equal(
          selectedMonth.categoryGroups
            .flatMap(group => group.categories)
            .find(item => item.id === f.fixture.dining).budgeted,
          25000,
        );
        const after = await archive();
        for (const table of Object.keys(baseline.tables).filter(
          name => !['zero_budgets', 'reflect_budgets'].includes(name),
        )) {
          assert.deepEqual(after.tables[table], baseline.tables[table], table);
        }
        assert.deepEqual(after.accountBalances, baseline.accountBalances);
        if (offline) {
          await cli(['sync']);
        }
        const remote = await cli(
          ['--require-fresh', 'budgets', 'month', '2026-08'],
          { client: 'independent' },
        );
        assert.equal(
          remote.categoryGroups
            .flatMap(group => group.categories)
            .find(item => item.id === f.fixture.dining).carryover,
          true,
        );
        const legacy = await f.cli(
          args('unused-legacy-id', false).slice(0, -2),
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), { success: true });
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const offline of [false, true]) {
  void test(
    `direct allocation receipts prevent replay after another allocation (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const monthArgs = ['budgets', 'month', '2026-08'];
        const before = await cli([...mode, ...monthArgs]);
        const categories = month =>
          month.categoryGroups.flatMap(group => group.categories);
        const args = (id, amount) => [
          ...mode,
          'budgets',
          'set-amount',
          '--month',
          '2026-08',
          '--category',
          f.fixture.dining,
          '--amount',
          String(amount),
          '--operation-id',
          id,
        ];
        const first = await cli(args('direct-allocation-first', 31234));
        assert.equal(first.success, true);
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        assert.equal(
          first.receipt.proposal.request.categoryId,
          f.fixture.dining,
        );
        assert.equal(first.receipt.proposal.after.amount, 31234);
        const checkpoint = first.receipt.outcome.checkpoint;
        await cli(args('direct-allocation-second', 32123));
        const repeated = await cli(args('direct-allocation-first', 31234));
        assert.deepEqual(repeated.receipt.outcome, first.receipt.outcome);
        assert.equal(repeated.receipt.outcome.checkpoint, checkpoint);
        const collision = await f.cli(args('direct-allocation-first', 45678));
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        assert.equal(JSON.parse(collision.stdout).error.code, 'INVALID_INPUT');
        const after = await cli([...mode, ...monthArgs]);
        const selected = categories(after).find(
          row => row.id === f.fixture.dining,
        );
        assert.equal(selected.budgeted, 32123);
        assert.equal(selected.carryover, true);
        assert.deepEqual(
          categories(after).filter(row => row.id !== f.fixture.dining),
          categories(before).filter(row => row.id !== f.fixture.dining),
        );
        if (offline) {
          await cli(['sync']);
        }
        const remote = await cli(['--require-fresh', ...monthArgs], {
          client: 'independent',
        });
        assert.equal(
          categories(remote).find(row => row.id === f.fixture.dining).budgeted,
          32123,
        );
        const retained = await cli([
          ...mode,
          'changes',
          'status',
          'direct-allocation-first',
        ]);
        assert.deepEqual(retained.outcome, first.receipt.outcome);
        const legacy = await f.cli(
          args('unused-legacy-id', 33333).slice(0, -2),
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), { success: true });
        assert.equal(
          categories(await cli([...mode, ...monthArgs])).find(
            row => row.id === f.fixture.dining,
          ).budgeted,
          33333,
        );
      } finally {
        await f.dispose();
      }
    },
  );
}

void test(
  'guarded allocation preview preserves all domains and applies only its selected amount',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const cli = async (args, options) => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      await cli(['accounts', 'list']);
      const artifact = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'allocation-proof'),
      ]);
      const baseline = (await cli(['backups', 'validate', artifact.path]))
        .snapshot;
      const proposal = await cli([
        'changes',
        'preview',
        'budgets.set-amount',
        f.fixture.dining,
        '--operation-id',
        'allocate-one',
        '--data',
        '{"month":"2026-08","amount":31234}',
      ]);
      assert.equal(proposal.state, 'prepared');
      assert.equal(proposal.proposal.before.amount, 25000);
      assert.equal(proposal.proposal.after.amount, 31234);
      const previewArchive = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'allocation-proof'),
      ]);
      assert.deepEqual(
        (await cli(['backups', 'validate', previewArchive.path])).snapshot,
        baseline,
      );
      const applied = await cli([
        'changes',
        'apply',
        'allocate-one',
        '--token',
        proposal.token,
      ]);
      assert.equal(applied.state, 'synced');
      const checkpoint = applied.outcome.checkpoint;
      const repeated = await cli([
        'changes',
        'apply',
        'allocate-one',
        '--token',
        proposal.token,
      ]);
      assert.equal(repeated.outcome.checkpoint, checkpoint);
      const month = await cli(['budgets', 'month', '2026-08'], {
        client: 'independent',
      });
      const category = month.categoryGroups
        .flatMap(group => group.categories)
        .find(category => category.id === f.fixture.dining);
      assert.equal(category.budgeted, 31234);
      assert.equal(category.carryover, true);
      const afterArchive = await cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        join(f.root, 'allocation-proof'),
      ]);
      const after = (await cli(['backups', 'validate', afterArchive.path]))
        .snapshot;
      for (const table of Object.keys(baseline.tables).filter(
        name => !['zero_budgets', 'reflect_budgets'].includes(name),
      )) {
        assert.deepEqual(after.tables[table], baseline.tables[table], table);
      }
      assert.deepEqual(after.accountBalances, baseline.accountBalances);
      const stale = await cli([
        'changes',
        'preview',
        'budgets.set-amount',
        f.fixture.dining,
        '--operation-id',
        'allocate-stale',
        '--data',
        '{"month":"2026-08","amount":44444}',
      ]);
      await cli(
        [
          'budgets',
          'set-amount',
          '--month',
          '2026-08',
          '--category',
          f.fixture.dining,
          '--amount',
          '32123',
          '--operation-id',
          'independent-allocation-edit',
        ],
        { client: 'independent' },
      );
      const rejected = await f.cli([
        'changes',
        'apply',
        'allocate-stale',
        '--token',
        stale.token,
      ]);
      assert.equal(rejected.code, 4, rejected.stdout + rejected.stderr);
      assert.equal(
        (await cli(['changes', 'status', 'allocate-stale'])).state,
        'failed-before-commit',
      );
      const wrong = await cli([
        'changes',
        'preview',
        'budgets.set-amount',
        f.fixture.dining,
        '--operation-id',
        'allocate-wrong',
        '--data',
        '{"month":"2026-08","amount":55555}',
      ]);
      const cloned = await cli([
        '--offline',
        'budgets',
        'clone',
        '--name',
        'Allocation other identity',
        '--operation-id',
        'allocation-isolation-clone',
      ]);
      const isolated = await f.cli([
        '--offline',
        '--budget-id',
        cloned.id,
        'changes',
        'apply',
        'allocate-wrong',
        '--token',
        wrong.token,
      ]);
      assert.equal(isolated.code, 3, isolated.stdout + isolated.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'orphan staging is disclosed and blocks new proposals and apply intent without ledger writes',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    try {
      const cli = async args => {
        const result = await f.cli(args);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      const list = [
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ];
      const before = await cli(list);
      const row = before.find(row => row.imported_id === 'uncategorized');
      const receipt = await cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        'staging-guard',
        '--data',
        '{"notes":"must not apply"}',
      ]);
      const operationId = 'orphan-staged';
      await cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        operationId,
        '--data',
        '{"notes":"orphan proposal"}',
      ]);
      const directory = join(f.root, 'a/.actual-cli/changes');
      const path = join(
        directory,
        operationId + '.' + randomUUID() + '.pending',
      );
      await rename(join(directory, operationId + '.json'), path);
      const bytes = await readFile(path);
      const inventory = await cli(['changes', 'list']);
      assert.equal(inventory.staging.total, 1);
      assert.equal(inventory.staging.blocksMutations, true);
      const applied = await f.cli([
        'changes',
        'apply',
        receipt.operationId,
        '--token',
        receipt.token,
      ]);
      assert.equal(applied.code, 2, applied.stdout + applied.stderr);
      assert.equal(JSON.parse(applied.stdout).context.commit, 'none');
      const preview = await f.cli([
        'changes',
        'preview',
        'transactions.update',
        row.id,
        '--operation-id',
        'staging-blocked',
        '--data',
        '{"notes":"blocked"}',
      ]);
      assert.equal(preview.code, 2, preview.stdout + preview.stderr);
      assert.equal(
        (await cli(['changes', 'status', receipt.operationId])).state,
        'prepared',
      );
      assert.deepEqual(await cli(list), before);
      assert.deepEqual(await readFile(path), bytes);
    } finally {
      await f.dispose();
    }
  },
);

async function readDeletionFixture(f) {
  const { default: Database } = await import('better-sqlite3');
  assert.ok(f.root.includes('actual-agent-cli-'));
  const database = new Database(
    join(f.root, 'a', f.fixture.budgetId, 'db.sqlite'),
    { readonly: true, fileMustExist: true },
  );
  try {
    const names = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map(row => row.name)
      .filter(
        name =>
          !name.startsWith('sqlite_') &&
          !name.startsWith('messages_') &&
          !['kvcache', 'kvcache_key'].includes(name),
      );
    return Object.fromEntries(
      names.map(name => [
        name,
        database
          .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
          .all()
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
    );
  } finally {
    database.close();
  }
}

function assertDeletedFixture(before, after, id, changed) {
  const sourceRows = before.transactions.filter(
    row => row.acct === id && row.tombstone === 0,
  );
  const sourceIds = new Set(sourceRows.map(row => row.id));
  const counterpartIds = new Set(
    sourceRows.map(row => row.transferred_id).filter(Boolean),
  );
  const sourcePayees = new Set(
    before.payees
      .filter(row => row.transfer_acct === id && row.tombstone === 0)
      .map(row => row.id),
  );
  const expected = structuredClone(before);
  if (changed) {
    expected.accounts = expected.accounts.map(row =>
      row.id === id
        ? {
            ...row,
            tombstone: 1,
            account_id: null,
            bank: null,
            balance_current: null,
            balance_available: null,
            balance_limit: null,
            account_sync_source: null,
            bank_sync_status: null,
          }
        : row,
    );
    expected.payees = expected.payees.map(row =>
      sourcePayees.has(row.id) ? { ...row, tombstone: 1 } : row,
    );
    expected.transactions = expected.transactions.map(row => ({
      ...row,
      ...(counterpartIds.has(row.id)
        ? { description: null, transferred_id: null }
        : {}),
      ...(sourceIds.has(row.id) ? { tombstone: 1 } : {}),
    }));
  }
  for (const name of Object.keys(expected)) {
    expected[name].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    assert.deepEqual(after[name], expected[name], name);
  }
}

for (const offline of [false, true]) {
  void test(
    `guarded account deletion preserves other domains and retries its exact outcome (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const id = f.fixture.checking;
        const { default: Database } = await import('better-sqlite3');
        assert.ok(f.root.includes('actual-agent-cli-'));
        const fixtureDatabase = new Database(
          join(f.root, 'a', f.fixture.budgetId, 'db.sqlite'),
          { fileMustExist: true },
        );
        try {
          fixtureDatabase
            .prepare(
              "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-provider-account', account_sync_source = 'simpleFin', balance_current = 3333, balance_available = 2222, balance_limit = 1111, bank_sync_status = 'ok', mask = '4321' WHERE id = ?",
            )
            .run(id);
        } finally {
          fixtureDatabase.close();
        }
        const before = await readDeletionFixture(f);
        assert.ok(
          before.transactions.some(
            row => row.acct === id && row.isParent === 1,
          ),
        );
        assert.ok(
          before.transactions.some(
            row => row.acct === id && row.transferred_id,
          ),
        );
        const mode = offline ? ['--offline'] : [];
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'accounts.delete',
          id,
          '--operation-id',
          'delete-preview',
          '--data',
          '{}',
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.equal(prepared.proposal.after.action, 'deleted');
        assert.equal(prepared.proposal.after.unlink.clearFields.length, 7);
        assert.equal(prepared.proposal.after.unlink.remoteRemoval, null);
        assert.deepEqual(
          prepared.proposal.after.deletedTransactionIds.slice().sort(),
          before.transactions
            .filter(row => row.acct === id && row.tombstone === 0)
            .map(row => row.id)
            .sort(),
        );
        const args = [
          ...mode,
          'accounts',
          'delete',
          id,
          '--operation-id',
          'delete-first',
        ];
        const first = await cli(args);
        assert.equal(
          first.receipt.state,
          offline ? 'committed-local' : 'synced',
        );
        assert.equal(first.receipt.outcome.accountClosure.action, 'deleted');
        assert.equal(first.providerRemovalStatus, 'not-required');
        assert.equal(
          first.receipt.outcome.accountClosure.unlink.localChanged,
          true,
        );
        const after = await readDeletionFixture(f);
        assertDeletedFixture(before, after, id, true);
        const stale = await f.cli([
          ...mode,
          'changes',
          'apply',
          'delete-preview',
          '--token',
          prepared.token,
        ]);
        assert.equal(stale.code, 4, stale.stdout + stale.stderr);
        if (offline) await cli(['sync']);
        assert.equal(
          (
            await cli(
              ['--require-fresh', 'accounts', 'list', '--include-closed'],
              { client: 'independent' },
            )
          ).some(row => row.id === id),
          false,
        );
        const repeated = await cli(args);
        assert.deepEqual(repeated.receipt.outcome, first.receipt.outcome);
        assert.deepEqual(await readDeletionFixture(f), after);
        const collision = await f.cli([
          ...mode,
          'accounts',
          'delete',
          f.fixture.savings,
          '--operation-id',
          'delete-first',
        ]);
        assert.equal(collision.code, 2);
        const payload = await f.cli([
          ...mode,
          'changes',
          'preview',
          'accounts.delete',
          f.fixture.savings,
          '--operation-id',
          'delete-invalid',
          '--data',
          '{"forced":false}',
        ]);
        assert.equal(payload.code, 2);
        const legacy = await f.cli(
          [...mode, 'accounts', 'delete', f.fixture.closed],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), {
          success: true,
          id: f.fixture.closed,
        });
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed account deletion at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const before = await readDeletionFixture(f);
        const id = 'delete-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'accounts.delete',
          f.fixture.checking,
          '--operation-id',
          id,
          '--data',
          '{}',
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        assertDeletedFixture(
          before,
          after,
          f.fixture.checking,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          assert.ok(
            (await cli(['accounts', 'list'], { client: 'independent' })).some(
              row => row.id === f.fixture.checking,
            ),
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          assert.equal(
            (
              await cli(['--require-fresh', 'accounts', 'list'], {
                client: 'independent',
              })
            ).some(row => row.id === f.fixture.checking),
            false,
          );
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertClosedFixture(before, after, proposal, changed) {
  if (!changed) {
    assert.deepEqual(after, before);
    return;
  }
  const source = after.transactions.find(row => row.id === proposal.seed.id);
  assert.ok(source, 'Closing source must exist');
  const counterpart = after.transactions.find(
    row => row.id === source.transferred_id,
  );
  assert.ok(counterpart, 'Closing counterpart must exist');
  assert.notEqual(source.id, counterpart.id);
  assert.equal(counterpart.transferred_id, source.id);
  const fields = {
    id: 'id',
    account: 'acct',
    payee: 'description',
    amount: 'amount',
    notes: 'notes',
    category: 'category',
    date: 'date',
    sort_order: 'sort_order',
    schedule: 'schedule',
    cleared: 'cleared',
    transfer_id: 'transferred_id',
  };
  for (const [actual, planned] of [
    [source, proposal.after.source],
    [counterpart, proposal.after.counterpart],
  ]) {
    for (const [key, value] of Object.entries(planned)) {
      assert.ok(fields[key], key);
      assert.deepEqual(
        actual[fields[key]],
        key === 'date'
          ? Number(value.replaceAll('-', ''))
          : key === 'cleared'
            ? Number(value)
            : value,
        key,
      );
    }
  }
  const added = [source.id, counterpart.id];
  const expected = structuredClone(before);
  expected.accounts = expected.accounts.map(row =>
    row.id === proposal.request.id
      ? {
          ...row,
          closed: 1,
          ...Object.fromEntries(
            proposal.after.unlink.clearFields.map(field => [field, null]),
          ),
        }
      : row,
  );
  for (const name of Object.keys(expected)) {
    const observed =
      name === 'transactions'
        ? after[name].filter(row => !added.includes(row.id))
        : after[name];
    expected[name].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    assert.deepEqual(observed, expected[name], name);
  }
}

for (const offline of [false, true]) {
  void test(
    `guarded account closure preserves its planned transfers and acknowledged retries (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const id = f.fixture.checking;
        const mode = offline ? ['--offline'] : [];
        const { default: Database } = await import('better-sqlite3');
        assert.ok(f.root.includes('actual-agent-cli-'));
        const providerDatabase = new Database(
          join(f.root, 'a', f.fixture.budgetId, 'db.sqlite'),
          { fileMustExist: true },
        );
        try {
          providerDatabase
            .prepare(
              "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-provider-account', account_sync_source = 'simpleFin', balance_current = 3333, balance_available = 2222, balance_limit = 1111, bank_sync_status = 'ok', mask = '4321' WHERE id = ?",
            )
            .run(id);
        } finally {
          providerDatabase.close();
        }
        const before = await readDeletionFixture(f);
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'accounts.close',
          id,
          '--operation-id',
          'close-preview',
          '--data',
          JSON.stringify({
            transferAccount: f.fixture.savings,
            transferCategory: f.fixture.groceries,
          }),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.equal(prepared.proposal.after.action, 'closed');
        assert.equal(
          prepared.proposal.after.source.amount,
          -before.transactions
            .filter(
              row => row.acct === id && !row.isParent && row.tombstone === 0,
            )
            .reduce((total, row) => total + row.amount, 0),
        );
        assert.equal(prepared.proposal.after.source.category, null);
        const args = [
          ...mode,
          'changes',
          'apply',
          'close-preview',
          '--token',
          prepared.token,
        ];
        const applied = await cli(args);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        assert.equal(applied.outcome.accountClosure.action, 'closed');
        const added = applied.outcome.accountClosure.addedTransactionIds;
        assert.equal(added.length, 2);
        assert.equal(added[0], prepared.proposal.seed.id);
        const after = await readDeletionFixture(f);
        assertClosedFixture(before, after, prepared.proposal, true);
        assert.equal(applied.outcome.accountClosure.unlink.localChanged, true);
        assert.equal(prepared.proposal.after.unlink.clearFields.length, 7);
        const sourceRows = await cli([
          ...mode,
          'transactions',
          'list',
          '--account',
          id,
          '--start',
          '2000-01-01',
          '--end',
          '2100-01-01',
        ]);
        const counterpartRows = await cli([
          ...mode,
          'transactions',
          'list',
          '--account',
          f.fixture.savings,
          '--start',
          '2000-01-01',
          '--end',
          '2100-01-01',
        ]);
        const source = sourceRows.find(row => row.id === added[0]);
        const counterpart = counterpartRows.find(row => row.id === added[1]);
        for (const [key, value] of Object.entries(
          prepared.proposal.after.source,
        )) {
          assert.deepEqual(source[key], value, key);
        }
        for (const [key, value] of Object.entries(
          prepared.proposal.after.counterpart,
        )) {
          assert.deepEqual(counterpart[key], value, key);
        }
        assert.equal(source.transfer_id, counterpart.id);
        assert.equal(counterpart.transfer_id, source.id);
        assert.equal(source.amount + counterpart.amount, 0);
        const repeated = await cli(args);
        assert.deepEqual(repeated.outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), after);
        const direct = [
          ...mode,
          'accounts',
          'close',
          id,
          '--transfer-account',
          f.fixture.savings,
          '--transfer-category',
          f.fixture.groceries,
          '--operation-id',
          'close-direct',
        ];
        const directResult = await cli(direct);
        assert.equal(directResult.success, true);
        assert.equal(directResult.providerRemovalStatus, 'not-required');
        assert.equal(
          directResult.receipt.outcome.accountClosure.action,
          'unchanged',
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          directResult.receipt.outcome,
        );
        const collision = await f.cli([
          ...mode,
          'accounts',
          'close',
          f.fixture.savings,
          '--operation-id',
          'close-direct',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        const invalid = await f.cli([
          ...mode,
          'changes',
          'preview',
          'accounts.close',
          id,
          '--operation-id',
          'close-invalid',
          '--data',
          '{"forced":true}',
        ]);
        assert.equal(invalid.code, 2, invalid.stdout + invalid.stderr);
        if (offline) {
          await cli(['sync']);
        }
        const independentlyClosed = await cli(
          ['--require-fresh', 'accounts', 'list', '--include-closed'],
          { client: 'independent' },
        );
        assert.equal(
          independentlyClosed.find(row => row.id === id).closed,
          true,
        );
        const independentlyReceived = await cli(
          [
            '--require-fresh',
            'transactions',
            'list',
            '--account',
            f.fixture.savings,
            '--start',
            '2000-01-01',
            '--end',
            '2100-01-01',
          ],
          { client: 'independent' },
        );
        assert.ok(
          independentlyReceived.some(
            row =>
              row.id === counterpart.id && row.amount === counterpart.amount,
          ),
        );
        await cli([
          ...mode,
          'accounts',
          'reopen',
          id,
          '--operation-id',
          'reopen-after-closure',
        ]);
        const later = await readDeletionFixture(f);
        assert.equal(later.accounts.find(row => row.id === id).closed, 0);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), later);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          directResult.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), later);
        const legacy = await f.cli(
          [...mode, 'accounts', 'close', f.fixture.closed],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), {
          success: true,
          id: f.fixture.closed,
        });
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed account closure at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const before = await readDeletionFixture(f);
        const id = 'close-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'accounts.close',
          f.fixture.checking,
          '--operation-id',
          id,
          '--data',
          JSON.stringify({
            transferAccount: f.fixture.savings,
            transferCategory: f.fixture.groceries,
          }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        assertClosedFixture(
          before,
          after,
          prepared.proposal,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          assert.ok(
            (await cli(['accounts', 'list'], { client: 'independent' })).some(
              row => row.id === f.fixture.checking,
            ),
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          assert.equal(
            (
              await cli(
                ['--require-fresh', 'accounts', 'list', '--include-closed'],
                {
                  client: 'independent',
                },
              )
            ).some(row => row.id === f.fixture.checking && row.closed),
            true,
          );
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertCategoryUpdatedFixture(before, after, proposal, changed) {
  const expected = structuredClone(before);
  if (changed) {
    expected.categories = expected.categories
      .map(row => (row.id === proposal.request.id ? proposal.after : row))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  assert.deepEqual(after, expected);
}

for (const offline of [false, true]) {
  void test(
    `guarded category updates preserve raw domains and acknowledged retries (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const id = f.fixture.groceries;
        const before = await readDeletionFixture(f);
        const original = before.categories.find(row => row.id === id);
        const destination = before.category_groups.find(
          row => row.id !== original.cat_group && !row.tombstone,
        );
        assert.ok(destination, 'Fixture requires another category group');
        const fields = {
          name: '  Guarded groceries  ',
          hidden: false,
          is_income: Boolean(destination.is_income),
          group_id: destination.id,
        };
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'categories.update',
          id,
          '--operation-id',
          'category-fields',
          '--data',
          JSON.stringify(fields),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.deepEqual(prepared.proposal.before.category, original);
        const expected = structuredClone(before);
        expected.categories = expected.categories
          .map(row =>
            row.id === id
              ? {
                  ...row,
                  name: 'Guarded groceries',
                  hidden: 0,
                  is_income: destination.is_income,
                  cat_group: destination.id,
                }
              : row,
          )
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const args = [
          ...mode,
          'changes',
          'apply',
          'category-fields',
          '--token',
          prepared.token,
        ];
        const applied = await cli(args);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        assert.equal(applied.outcome.changed, true);
        assert.deepEqual(applied.outcome.affectedIds, [id]);
        assertCategoryUpdatedFixture(
          before,
          await readDeletionFixture(f),
          prepared.proposal,
          true,
        );
        const direct = [
          ...mode,
          'categories',
          'update',
          id,
          '--hidden',
          'true',
          '--operation-id',
          'category-hidden',
        ];
        const changed = await cli(direct);
        assert.equal(changed.success, true);
        const later = structuredClone(expected);
        later.categories = later.categories
          .map(row => (row.id === id ? { ...row, hidden: 1 } : row))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        assert.deepEqual(await readDeletionFixture(f), later);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), later);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          changed.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), later);
        const collision = await f.cli([
          ...mode,
          'categories',
          'update',
          f.fixture.dining,
          '--hidden',
          'true',
          '--operation-id',
          'category-hidden',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        if (offline) {
          await cli(['sync']);
        }
        const independentlyRead = await cli(
          ['--require-fresh', 'categories', 'list', '--include-hidden'],
          { client: 'independent' },
        );
        assert.deepEqual(
          independentlyRead.find(row => row.id === id),
          {
            id,
            name: 'Guarded groceries',
            group_id: destination.id,
            is_income: Boolean(destination.is_income),
            hidden: true,
          },
        );
        const legacy = await f.cli(
          [...mode, 'categories', 'update', id, '--name', 'Legacy groceries'],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), { success: true, id });
        const afterLegacy = await readDeletionFixture(f);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          changed.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), afterLegacy);
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed category update at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const before = await readDeletionFixture(f);
        const id = 'category-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'categories.update',
          f.fixture.groceries,
          '--operation-id',
          id,
          '--data',
          JSON.stringify({ hidden: false }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        assertCategoryUpdatedFixture(
          before,
          after,
          prepared.proposal,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          const independentBefore = await cli(
            ['categories', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentBefore.find(row => row.id === f.fixture.groceries)
              .hidden,
            true,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          const independentAfter = await cli(
            ['--require-fresh', 'categories', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentAfter.find(row => row.id === f.fixture.groceries).hidden,
            false,
          );
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertCategoryCreatedFixture(before, after, proposal, id, changed) {
  const expected = structuredClone(before);
  if (changed) {
    const created = after.categories.find(row => row.id === id);
    assert.ok(created, 'Created category must exist');
    assert.deepEqual(JSON.parse(created.template_settings), {
      source: 'notes',
    });
    assert.deepEqual(created, {
      id,
      tombstone: 0,
      goal_def: null,
      cleanup_def: null,
      template_settings: created.template_settings,
      ...proposal.after.category,
    });
    expected.categories = expected.categories.map(row => ({
      ...row,
      ...proposal.after.updatedCategories.find(update => update.id === row.id),
    }));
    expected.categories.push(created);
    expected.category_mapping.push({ id, transferId: id });
  }
  for (const name of Object.keys(expected)) {
    expected[name].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    assert.deepEqual(after[name], expected[name], name);
  }
}

async function compactCategoryCreationFixture(f) {
  const { default: Database } = await import('better-sqlite3');
  assert.ok(f.root.includes('actual-agent-cli-'));
  const database = new Database(
    join(f.root, 'a', f.fixture.budgetId, 'db.sqlite'),
    { fileMustExist: true },
  );
  try {
    const group = database
      .prepare('SELECT cat_group FROM categories WHERE id = ?')
      .get(f.fixture.groceries).cat_group;
    const rows = database
      .prepare(
        'SELECT id FROM categories WHERE cat_group = ? AND tombstone = 0 ORDER BY sort_order, id',
      )
      .all(group);
    assert.ok(rows.length > 1, 'Fixture requires compact siblings');
    for (let index = 0; index < rows.length; index++) {
      database
        .prepare('UPDATE categories SET sort_order = ? WHERE id = ?')
        .run(index + 1, rows[index].id);
    }
    return group;
  } finally {
    database.close();
  }
}

for (const offline of [false, true]) {
  void test(
    `guarded category creation acknowledges mapping and sibling shoves without replay (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const group = await compactCategoryCreationFixture(f);
        const mode = offline ? ['--offline'] : [];
        const before = await readDeletionFixture(f);
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'categories.create',
          '--operation-id',
          'category-create-preview',
          '--data',
          JSON.stringify({
            name: '  Packaged category  ',
            group_id: group,
            hidden: true,
            is_income: false,
          }),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.ok(prepared.proposal.after.updatedCategories.length > 1);
        const args = [
          ...mode,
          'changes',
          'apply',
          'category-create-preview',
          '--token',
          prepared.token,
        ];
        const applied = await cli(args);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        const id = applied.outcome.categoryCreation.categoryId;
        assert.ok(id);
        assert.equal(applied.outcome.categoryCreation.mappingId, id);
        assert.deepEqual(
          applied.outcome.categoryCreation.updatedCategoryIds,
          prepared.proposal.after.updatedCategories.map(row => row.id),
        );
        const after = await readDeletionFixture(f);
        assertCategoryCreatedFixture(
          before,
          after,
          prepared.proposal,
          id,
          true,
        );
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), after);
        const direct = [
          ...mode,
          'categories',
          'create',
          '--name',
          'Direct packaged category',
          '--group-id',
          group,
          '--operation-id',
          'category-create-direct',
        ];
        const directResult = await cli(direct);
        assert.ok(directResult.id);
        assert.notEqual(directResult.id, id);
        const afterDirect = await readDeletionFixture(f);
        assertCategoryCreatedFixture(
          after,
          afterDirect,
          directResult.receipt.proposal,
          directResult.id,
          true,
        );
        await cli([
          ...mode,
          'categories',
          'update',
          id,
          '--name',
          'Later first category',
          '--operation-id',
          'category-create-later-first',
        ]);
        await cli([
          ...mode,
          'categories',
          'update',
          directResult.id,
          '--hidden',
          'true',
          '--operation-id',
          'category-create-later-second',
        ]);
        const later = await readDeletionFixture(f);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          directResult.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), later);
        const collision = await f.cli([
          ...mode,
          'categories',
          'create',
          '--name',
          'Different creation',
          '--group-id',
          group,
          '--operation-id',
          'category-create-direct',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        if (offline) {
          await cli(['sync']);
        }
        const independent = await cli(
          ['--require-fresh', 'categories', 'list', '--include-hidden'],
          { client: 'independent' },
        );
        assert.deepEqual(
          independent.find(row => row.id === id),
          {
            id,
            name: 'Later first category',
            hidden: true,
            is_income: false,
            group_id: group,
          },
        );
        assert.equal(
          independent.filter(row => [id, directResult.id].includes(row.id))
            .length,
          2,
        );
        const legacy = await f.cli(
          [
            ...mode,
            'categories',
            'create',
            '--name',
            'Legacy packaged category',
            '--group-id',
            group,
          ],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(Object.keys(JSON.parse(legacy.stdout)), ['id']);
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed category creation at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const group = await compactCategoryCreationFixture(f);
        const before = await readDeletionFixture(f);
        const id = 'category-create-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'categories.create',
          '--operation-id',
          id,
          '--data',
          JSON.stringify({
            name: 'Killed category',
            group_id: group,
            hidden: true,
          }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        const created = after.categories.filter(
          row => !before.categories.some(original => original.id === row.id),
        );
        assert.equal(created.length, phase === 'before-engine' ? 0 : 1);
        assertCategoryCreatedFixture(
          before,
          after,
          prepared.proposal,
          created[0]?.id,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          assert.equal(
            published.outcome.categoryCreation.categoryId,
            created[0].id,
          );
          assert.equal(
            published.outcome.categoryCreation.mappingId,
            created[0].id,
          );
          const independentBefore = await cli(
            ['categories', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentBefore.some(row => row.id === created[0].id),
            false,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          const independentAfter = await cli(
            ['--require-fresh', 'categories', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentAfter.filter(row => row.id === created[0].id).length,
            1,
          );
          assert.deepEqual(await readDeletionFixture(f), after);
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertCategoryDeletedFixture(before, after, proposal, changed) {
  const expected = structuredClone(before);
  if (changed) {
    expected.categories = expected.categories.map(row =>
      row.id === proposal.request.id ? proposal.after.category : row,
    );
    expected.category_mapping = expected.category_mapping.map(row => {
      const update = proposal.after.mappings.find(
        mapping => mapping.id === row.id,
      );
      return update ? { ...row, ...update } : row;
    });
    for (const allocation of proposal.after.budgetTransfers) {
      if (allocation.before) {
        expected[allocation.table] = expected[allocation.table].map(row =>
          row.id === allocation.before.id
            ? { ...row, amount: allocation.amount }
            : row,
        );
      } else {
        expected[allocation.table].push({
          id: allocation.month.replace('-', '') + '-' + allocation.category,
          month: Number(allocation.month.replace('-', '')),
          category: allocation.category,
          amount: allocation.amount,
          carryover: 0,
          goal: null,
          long_goal: null,
        });
      }
    }
  }
  for (const rows of Object.values(expected)) {
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  assert.deepEqual(after, expected);
}

for (const offline of [false, true]) {
  void test(
    `guarded category deletion preserves raw domains and never replays acknowledged transfers (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        const legacy = async args => {
          const result = await f.cli(args, { version: '1' });
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout);
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const initial = await readDeletionFixture(f);
        const source = initial.categories.find(
          row => row.id === f.fixture.groceries,
        );
        const target = initial.categories.find(
          row => row.id === f.fixture.dining,
        );
        assert.ok(target);
        const storedMonth = initial.zero_budgets.find(
          row => row.category === target.id,
        )?.month;
        assert.ok(
          storedMonth,
          'Fixture requires an existing destination allocation',
        );
        const month =
          String(storedMonth).slice(0, 4) + '-' + String(storedMonth).slice(4);
        const forwarder = await legacy([
          ...mode,
          'categories',
          'create',
          '--name',
          'Deleted forwarder',
          '--group-id',
          source.cat_group,
        ]);
        await legacy([
          ...mode,
          'categories',
          'delete',
          forwarder.id,
          '--transfer-to',
          source.id,
        ]);
        await legacy([
          ...mode,
          'budgets',
          'set-amount',
          '--month',
          month,
          '--category',
          source.id,
          '--amount',
          '700',
        ]);
        await legacy([
          ...mode,
          'budgets',
          'set-amount',
          '--month',
          month,
          '--category',
          target.id,
          '--amount',
          '300',
        ]);
        const before = await readDeletionFixture(f);
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'categories.delete',
          source.id,
          '--operation-id',
          'category-delete-transfer',
          '--data',
          JSON.stringify({ transferCategoryId: target.id }),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.ok(
          prepared.proposal.after.mappings.some(
            row => row.id === forwarder.id && row.transferId === target.id,
          ),
        );
        assert.equal(
          prepared.proposal.after.budgetTransfers.find(
            row => row.month === month,
          ).amount,
          1000,
        );
        const args = [
          ...mode,
          'changes',
          'apply',
          'category-delete-transfer',
          '--token',
          prepared.token,
        ];
        const applied = await cli(args);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        assert.equal(applied.outcome.changed, true);
        const after = await readDeletionFixture(f);
        assertCategoryDeletedFixture(before, after, prepared.proposal, true);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), after);
        await cli([
          ...mode,
          'categories',
          'update',
          target.id,
          '--name',
          'Later destination',
          '--operation-id',
          'category-delete-later-name',
        ]);
        await legacy([
          ...mode,
          'budgets',
          'set-amount',
          '--month',
          month,
          '--category',
          target.id,
          '--amount',
          '23',
        ]);
        const later = await readDeletionFixture(f);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), later);
        const directSource = await legacy([
          ...mode,
          'categories',
          'create',
          '--name',
          'Direct category deletion',
          '--group-id',
          source.cat_group,
        ]);
        const beforeDirect = await readDeletionFixture(f);
        const direct = [
          ...mode,
          'categories',
          'delete',
          directSource.id,
          '--operation-id',
          'category-delete-direct',
        ];
        const deleted = await cli(direct);
        assert.equal(deleted.success, true);
        assert.equal(deleted.id, directSource.id);
        assert.deepEqual(deleted.receipt.proposal.after.mappings, []);
        assert.deepEqual(deleted.receipt.proposal.after.budgetTransfers, []);
        const afterDirect = await readDeletionFixture(f);
        assertCategoryDeletedFixture(
          beforeDirect,
          afterDirect,
          deleted.receipt.proposal,
          true,
        );
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          deleted.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), afterDirect);
        const collision = await f.cli([
          ...mode,
          'categories',
          'delete',
          target.id,
          '--operation-id',
          'category-delete-direct',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        assert.deepEqual(await readDeletionFixture(f), afterDirect);
        if (offline) await cli(['sync']);
        const independent = await cli(
          ['--require-fresh', 'categories', 'list', '--include-hidden'],
          { client: 'independent' },
        );
        assert.equal(
          independent.some(row =>
            [source.id, forwarder.id, directSource.id].includes(row.id),
          ),
          false,
        );
        assert.equal(
          independent.find(row => row.id === target.id).name,
          'Later destination',
        );
        const legacySource = await legacy([
          ...mode,
          'categories',
          'create',
          '--name',
          'Legacy deletion',
          '--group-id',
          source.cat_group,
        ]);
        assert.deepEqual(
          await legacy([...mode, 'categories', 'delete', legacySource.id]),
          { success: true, id: legacySource.id },
        );
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed category deletion at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const initial = await readDeletionFixture(f);
        const storedMonth = initial.zero_budgets.find(
          row => row.category === f.fixture.dining,
        )?.month;
        assert.ok(storedMonth);
        const month =
          String(storedMonth).slice(0, 4) + '-' + String(storedMonth).slice(4);
        for (const [category, amount] of [
          [f.fixture.groceries, '700'],
          [f.fixture.dining, '300'],
        ]) {
          const funded = await f.cli(
            [
              '--offline',
              'budgets',
              'set-amount',
              '--month',
              month,
              '--category',
              category,
              '--amount',
              amount,
            ],
            { version: '1' },
          );
          assert.equal(funded.code, 0, funded.stdout + funded.stderr);
        }
        const before = await readDeletionFixture(f);
        const id = 'category-deletion-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'categories.delete',
          f.fixture.groceries,
          '--operation-id',
          id,
          '--data',
          JSON.stringify({ transferCategoryId: f.fixture.dining }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        assertCategoryDeletedFixture(
          before,
          after,
          prepared.proposal,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          const independentBefore = await cli(
            ['categories', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentBefore.some(row => row.id === f.fixture.groceries),
            true,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          const independentAfter = await cli(
            ['--require-fresh', 'categories', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentAfter.some(row => row.id === f.fixture.groceries),
            false,
          );
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertGroupCreatedFixture(before, after, proposal, id, changed) {
  const expected = structuredClone(before);
  if (changed) {
    expected.category_groups.push({
      id,
      tombstone: 0,
      ...proposal.after.group,
    });
  }
  for (const rows of Object.values(expected)) {
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  assert.deepEqual(after, expected);
}

for (const offline of [false, true]) {
  void test(
    `guarded group creation preserves raw domains and acknowledged identities (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const before = await readDeletionFixture(f);
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'category-groups.create',
          '--operation-id',
          'group-create-preview',
          '--data',
          JSON.stringify({
            name: '  Packaged income group  ',
            is_income: true,
            hidden: true,
            categories: [
              {
                id: 'ignored-child',
                name: 'Ignored child',
                group_id: 'ignored-group',
              },
            ],
          }),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        const args = [
          ...mode,
          'changes',
          'apply',
          'group-create-preview',
          '--token',
          prepared.token,
        ];
        const applied = await cli(args);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        const id = applied.outcome.groupCreation.groupId;
        assert.ok(id);
        assert.deepEqual(applied.outcome.affectedIds, [id]);
        const after = await readDeletionFixture(f);
        assertGroupCreatedFixture(before, after, prepared.proposal, id, true);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), after);
        const direct = [
          ...mode,
          'category-groups',
          'create',
          '--name',
          'Direct income group',
          '--is-income',
          '--operation-id',
          'group-create-direct',
        ];
        const created = await cli(direct);
        assert.ok(created.id && created.id !== id);
        const afterDirect = await readDeletionFixture(f);
        assertGroupCreatedFixture(
          after,
          afterDirect,
          created.receipt.proposal,
          created.id,
          true,
        );
        assert.equal(created.receipt.proposal.after.group.is_income, 1);
        assert.equal(created.receipt.proposal.after.group.hidden, 0);
        const edited = await f.cli(
          [
            ...mode,
            'category-groups',
            'update',
            id,
            '--name',
            'Later group name',
            '--hidden',
            'false',
          ],
          { version: '1' },
        );
        assert.equal(edited.code, 0, edited.stdout + edited.stderr);
        const later = await readDeletionFixture(f);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          created.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), later);
        const collision = await f.cli([
          ...mode,
          'category-groups',
          'create',
          '--name',
          'Other group',
          '--operation-id',
          'group-create-direct',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        assert.deepEqual(await readDeletionFixture(f), later);
        if (offline) await cli(['sync']);
        const independent = await cli(
          ['--require-fresh', 'category-groups', 'list', '--include-hidden'],
          { client: 'independent' },
        );
        assert.deepEqual(
          independent.find(row => row.id === id),
          {
            id,
            name: 'Later group name',
            is_income: true,
            hidden: false,
            categories: [],
          },
        );
        assert.equal(
          independent.filter(row => [id, created.id].includes(row.id)).length,
          2,
        );
        const legacy = await f.cli(
          [
            ...mode,
            'category-groups',
            'create',
            '--name',
            'Legacy income group',
            '--is-income',
          ],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        const legacyResult = JSON.parse(legacy.stdout);
        assert.deepEqual(Object.keys(legacyResult), ['id']);
        assert.equal(
          (
            await cli([...mode, 'category-groups', 'list', '--include-hidden'])
          ).find(row => row.id === legacyResult.id).is_income,
          true,
        );
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed group creation at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const before = await readDeletionFixture(f);
        const id = 'group-create-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'category-groups.create',
          '--operation-id',
          id,
          '--data',
          JSON.stringify({
            name: 'Killed group',
            is_income: true,
            hidden: true,
          }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        const created = after.category_groups.filter(
          row =>
            !before.category_groups.some(original => original.id === row.id),
        );
        assert.equal(created.length, phase === 'before-engine' ? 0 : 1);
        assertGroupCreatedFixture(
          before,
          after,
          prepared.proposal,
          created[0]?.id,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          assert.equal(published.outcome.groupCreation.groupId, created[0].id);
          const independentBefore = await cli(
            ['category-groups', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentBefore.some(row => row.id === created[0].id),
            false,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          const independentAfter = await cli(
            ['--require-fresh', 'category-groups', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentAfter.filter(row => row.id === created[0].id).length,
            1,
          );
          assert.deepEqual(await readDeletionFixture(f), after);
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertGroupUpdatedFixture(before, after, proposal, changed) {
  const expected = structuredClone(before);
  if (changed) {
    expected.category_groups = expected.category_groups
      .map(row => (row.id === proposal.request.id ? proposal.after : row))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  assert.deepEqual(after, expected);
}

for (const offline of [false, true]) {
  void test(
    `guarded group updates preserve raw domains and acknowledged retries (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const before = await readDeletionFixture(f);
        const id = before.categories.find(
          row => row.id === f.fixture.groceries,
        ).cat_group;
        const original = before.category_groups.find(row => row.id === id);
        const destination = before.category_groups.find(
          row => row.id !== id && !row.tombstone,
        );
        assert.ok(destination, 'Fixture requires another category group');
        const fields = {
          id,
          name: '  Guarded group  ',
          hidden: false,
          is_income: true,
          categories: [
            {
              id: f.fixture.groceries,
              name: 'Ignored child',
              group_id: destination.id,
              hidden: false,
              is_income: true,
            },
          ],
        };
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'category-groups.update',
          id,
          '--operation-id',
          'group-fields',
          '--data',
          JSON.stringify(fields),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.deepEqual(prepared.proposal.before.group, original);
        const expected = structuredClone(before);
        expected.category_groups = expected.category_groups
          .map(row =>
            row.id === id
              ? {
                  ...row,
                  name: '  Guarded group  ',
                  hidden: 0,
                  is_income: 1,
                }
              : row,
          )
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const args = [
          ...mode,
          'changes',
          'apply',
          'group-fields',
          '--token',
          prepared.token,
        ];
        const applied = await cli(args);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        assert.equal(applied.outcome.changed, true);
        assert.deepEqual(applied.outcome.affectedIds, [id]);
        assertGroupUpdatedFixture(
          before,
          await readDeletionFixture(f),
          prepared.proposal,
          true,
        );
        const direct = [
          ...mode,
          'category-groups',
          'update',
          id,
          '--hidden',
          'true',
          '--operation-id',
          'group-hidden',
        ];
        const changed = await cli(direct);
        assert.equal(changed.success, true);
        const later = structuredClone(expected);
        later.category_groups = later.category_groups
          .map(row => (row.id === id ? { ...row, hidden: 1 } : row))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        assert.deepEqual(await readDeletionFixture(f), later);
        assert.deepEqual((await cli(args)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), later);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          changed.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), later);
        const collision = await f.cli([
          ...mode,
          'category-groups',
          'update',
          destination.id,
          '--hidden',
          'true',
          '--operation-id',
          'group-hidden',
        ]);
        assert.equal(collision.code, 2, collision.stdout + collision.stderr);
        if (offline) {
          await cli(['sync']);
        }
        const independentlyRead = await cli(
          ['--require-fresh', 'category-groups', 'list', '--include-hidden'],
          { client: 'independent' },
        );
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(independentlyRead.find(row => row.id === id)).filter(
              ([key]) => key !== 'categories',
            ),
          ),
          { id, name: '  Guarded group  ', is_income: true, hidden: true },
        );
        const legacy = await f.cli(
          [...mode, 'category-groups', 'update', id, '--name', 'Legacy group'],
          { version: '1' },
        );
        assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
        assert.deepEqual(JSON.parse(legacy.stdout), { success: true, id });
        const afterLegacy = await readDeletionFixture(f);
        assert.deepEqual(
          (await cli(direct)).receipt.outcome,
          changed.receipt.outcome,
        );
        assert.deepEqual(await readDeletionFixture(f), afterLegacy);
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed group update at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const loaded = await readDeletionFixture(f);
        const targetId = loaded.categories.find(
          row => row.id === f.fixture.groceries,
        ).cat_group;
        const setup = await f.cli(
          ['category-groups', 'update', targetId, '--hidden', 'true'],
          { version: '1' },
        );
        assert.equal(setup.code, 0, setup.stdout + setup.stderr);
        const before = await readDeletionFixture(f);
        const id = 'group-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'category-groups.update',
          targetId,
          '--operation-id',
          id,
          '--data',
          JSON.stringify({ hidden: false }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        assertGroupUpdatedFixture(
          before,
          after,
          prepared.proposal,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          const independentBefore = await cli(
            ['category-groups', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentBefore.find(row => row.id === targetId).hidden,
            true,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          const independentAfter = await cli(
            ['--require-fresh', 'category-groups', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentAfter.find(row => row.id === targetId).hidden,
            false,
          );
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}

function assertGroupDeletedFixture(before, after, proposal, changed) {
  const expected = structuredClone(before);
  if (changed) {
    expected.category_groups = expected.category_groups.map(row =>
      row.id === proposal.request.id ? proposal.after.group : row,
    );
    expected.categories = expected.categories.map(
      row =>
        proposal.after.categories.find(category => category.id === row.id) ??
        row,
    );
    expected.category_mapping = expected.category_mapping.map(row => {
      const update = proposal.after.mappings.find(
        mapping => mapping.id === row.id,
      );
      return update ? { ...row, ...update } : row;
    });
    for (const allocation of proposal.after.budgetTransfers) {
      if (allocation.before) {
        expected[allocation.table] = expected[allocation.table].map(row =>
          row.id === allocation.before.id
            ? { ...row, amount: allocation.amount }
            : row,
        );
      } else {
        expected[allocation.table].push({
          id: allocation.month.replace('-', '') + '-' + allocation.category,
          month: Number(allocation.month.replace('-', '')),
          category: allocation.category,
          amount: allocation.amount,
          carryover: 0,
          goal: null,
          long_goal: null,
        });
      }
    }
  }
  for (const rows of Object.values(expected)) {
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  assert.deepEqual(after, expected);
}

async function provisionGroupDeletionFixture(f, mode = []) {
  const legacy = async args => {
    const result = await f.cli([...mode, ...args], { version: '1' });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const original = await readDeletionFixture(f);
  const sourceId = original.categories.find(
    row => row.id === f.fixture.groceries,
  ).cat_group;
  const storedMonth = original.zero_budgets.find(
    row => row.category === f.fixture.dining,
  ).month;
  const month =
    String(storedMonth).slice(0, 4) + '-' + String(storedMonth).slice(4);
  const destination = await legacy([
    'category-groups',
    'create',
    '--name',
    'Preserved group destination',
  ]);
  const target = await legacy([
    'categories',
    'create',
    '--name',
    'Group allocation target',
    '--group-id',
    destination.id,
  ]);
  const dead = await legacy([
    'categories',
    'create',
    '--name',
    'Fresh deleted group child',
    '--group-id',
    sourceId,
  ]);
  await legacy([
    'transactions',
    'add',
    '--account',
    f.fixture.checking,
    '--data',
    JSON.stringify([
      {
        date: month + '-02',
        amount: -17,
        category: dead.id,
        notes: 'Keep deleted group child reference',
      },
    ]),
  ]);
  const forwarder = await legacy([
    'categories',
    'create',
    '--name',
    'Group dead-child forwarder',
    '--group-id',
    destination.id,
  ]);
  await legacy([
    'categories',
    'delete',
    forwarder.id,
    '--transfer-to',
    dead.id,
  ]);
  await legacy(['categories', 'delete', dead.id]);
  for (const category of original.categories.filter(
    row => row.cat_group === sourceId && !row.tombstone,
  )) {
    await legacy([
      'budgets',
      'set-amount',
      '--month',
      month,
      '--category',
      category.id,
      '--amount',
      category.id === f.fixture.groceries
        ? '700'
        : category.id === f.fixture.dining
          ? '-100'
          : '0',
    ]);
  }
  await legacy([
    'budgets',
    'set-amount',
    '--month',
    month,
    '--category',
    dead.id,
    '--amount',
    '999',
  ]);
  await legacy([
    'budgets',
    'set-amount',
    '--month',
    month,
    '--category',
    target.id,
    '--amount',
    '200',
  ]);
  return {
    sourceId,
    destinationId: destination.id,
    targetId: target.id,
    forwarderId: forwarder.id,
    month,
    legacy,
  };
}

for (const offline of [false, true]) {
  void test(
    `guarded group deletion preserves raw domains and acknowledged transfers (${offline ? 'offline' : 'online'})`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const mode = offline ? ['--offline'] : [];
        const {
          sourceId,
          destinationId,
          targetId,
          forwarderId,
          month,
          legacy,
        } = await provisionGroupDeletionFixture(f, mode);
        const before = await readDeletionFixture(f);
        const prepared = await cli([
          ...mode,
          'changes',
          'preview',
          'category-groups.delete',
          sourceId,
          '--operation-id',
          'group-delete-transfer',
          '--data',
          JSON.stringify({ transferCategoryId: targetId }),
        ]);
        assert.deepEqual(await readDeletionFixture(f), before);
        assert.deepEqual(
          prepared.proposal.before.group,
          before.category_groups.find(row => row.id === sourceId),
        );
        assert.deepEqual(
          prepared.proposal.after.categories.map(row => row.id).sort(),
          before.categories
            .filter(row => row.cat_group === sourceId)
            .map(row => row.id)
            .sort(),
        );
        assert.ok(
          prepared.proposal.after.mappings.some(
            row => row.id === forwarderId && row.transferId === targetId,
          ),
        );
        assert.equal(
          prepared.proposal.after.budgetTransfers.find(
            row => row.month === month,
          ).amount,
          800,
        );
        const apply = [
          ...mode,
          'changes',
          'apply',
          'group-delete-transfer',
          '--token',
          prepared.token,
        ];
        const applied = await cli(apply);
        assert.equal(applied.state, offline ? 'committed-local' : 'synced');
        assert.equal(applied.outcome.changed, true);
        const after = await readDeletionFixture(f);
        assertGroupDeletedFixture(before, after, prepared.proposal, true);
        assert.deepEqual((await cli(apply)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), after);
        await legacy([
          'categories',
          'update',
          targetId,
          '--name',
          'Later group destination',
        ]);
        await legacy([
          'budgets',
          'set-amount',
          '--month',
          month,
          '--category',
          targetId,
          '--amount',
          '23',
        ]);
        const later = await readDeletionFixture(f);
        assert.deepEqual((await cli(apply)).outcome, applied.outcome);
        assert.deepEqual(await readDeletionFixture(f), later);
        for (const withTransfer of [true, false]) {
          const created = await legacy([
            'category-groups',
            'create',
            '--name',
            'Direct group deletion ' + withTransfer,
          ]);
          if (withTransfer) {
            await legacy([
              'categories',
              'create',
              '--name',
              'Direct child',
              '--group-id',
              created.id,
            ]);
          }
          const raw = await readDeletionFixture(f);
          const direct = [
            ...mode,
            'category-groups',
            'delete',
            created.id,
            ...(withTransfer ? ['--transfer-to', targetId] : []),
            '--operation-id',
            'group-delete-direct-' + withTransfer,
          ];
          const deleted = await cli(direct);
          assert.equal(deleted.success, true);
          assert.equal(deleted.id, created.id);
          assertGroupDeletedFixture(
            raw,
            await readDeletionFixture(f),
            deleted.receipt.proposal,
            true,
          );
          const afterDirect = await readDeletionFixture(f);
          assert.deepEqual(
            (await cli(direct)).receipt.outcome,
            deleted.receipt.outcome,
          );
          assert.deepEqual(await readDeletionFixture(f), afterDirect);
          const collision = await f.cli([
            ...mode,
            'category-groups',
            'delete',
            destinationId,
            '--operation-id',
            'group-delete-direct-' + withTransfer,
          ]);
          assert.equal(collision.code, 2, collision.stdout + collision.stderr);
          assert.deepEqual(await readDeletionFixture(f), afterDirect);
        }
        if (offline) await cli(['sync']);
        const groups = await cli(
          ['--require-fresh', 'category-groups', 'list', '--include-hidden'],
          { client: 'independent' },
        );
        assert.equal(
          groups.some(row => row.id === sourceId),
          false,
        );
        assert.equal(
          groups
            .find(row => row.id === destinationId)
            .categories.find(row => row.id === targetId).name,
          'Later group destination',
        );
        const legacyGroup = await legacy([
          'category-groups',
          'create',
          '--name',
          'Legacy group deletion',
        ]);
        assert.deepEqual(
          await legacy(['category-groups', 'delete', legacyGroup.id]),
          { success: true, id: legacyGroup.id },
        );
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
  void test(
    `killed group deletion at ${phase} retains its exact outcome without replay`,
    { timeout: 120000 },
    async () => {
      const f = await createFixture({ encrypted: true, richBackup: true });
      let child;
      let closed;
      try {
        const cli = async (args, options) => {
          const result = await f.cli(args, options);
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        await cli(['accounts', 'list']);
        const { sourceId, targetId } = await provisionGroupDeletionFixture(f);
        const before = await readDeletionFixture(f);
        const id = 'group-deletion-kill-' + phase;
        const prepared = await cli([
          '--offline',
          'changes',
          'preview',
          'category-groups.delete',
          sourceId,
          '--operation-id',
          id,
          '--data',
          JSON.stringify({ transferCategoryId: targetId }),
        ]);
        child = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              join(
                repoRoot,
                'packages/cli/integration/change-crash-boundary.mjs',
              ),
            ).href,
            join(repoRoot, 'packages/cli/dist/cli.js'),
            ...(phase === 'before-sync' ? [] : ['--offline']),
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ],
          {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
              ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
              ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: id,
            }),
          },
        );
        let stderr = '';
        child.stderr.on('data', data => {
          stderr += data;
        });
        closed = new Promise(resolve =>
          child.once('close', (code, signal) => resolve({ code, signal })),
        );
        const deadline = Date.now() + 15000;
        while (!stderr.includes(`"crashCheckpoint":"${phase}"`)) {
          assert.equal(child.exitCode, null, stderr);
          assert.ok(Date.now() < deadline, stderr);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const published = JSON.parse(
          await readFile(
            join(f.root, 'a/.actual-cli/changes', id + '.json'),
            'utf8',
          ),
        );
        assert.equal(
          published.state,
          phase === 'before-sync' ? 'committed-local' : 'uncertain',
        );
        assert.equal(child.kill('SIGKILL'), true);
        const terminal = await closed;
        assert.ok(terminal.signal !== null || terminal.code !== 0);
        const recovered = await cli(
          ['--lock-timeout', '45', 'changes', 'status', id],
          { timeout: 60000 },
        );
        assert.equal(recovered.state, published.state);
        const after = await readDeletionFixture(f);
        assertGroupDeletedFixture(
          before,
          after,
          prepared.proposal,
          phase !== 'before-engine',
        );
        const pending = (await cli(['--offline', 'sync', 'status']))
          .pendingMessages;
        const attempt = await f.cli([
          '--offline',
          'changes',
          'apply',
          id,
          '--token',
          prepared.token,
        ]);
        assert.equal(
          attempt.code,
          phase === 'before-sync' ? 0 : 6,
          attempt.stdout + attempt.stderr,
        );
        assert.deepEqual(await readDeletionFixture(f), after);
        assert.equal(
          (await cli(['--offline', 'sync', 'status'])).pendingMessages,
          pending,
        );
        if (phase === 'before-sync') {
          const independentBefore = await cli(
            ['category-groups', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentBefore.some(row => row.id === sourceId),
            true,
          );
          const synced = await cli([
            'changes',
            'apply',
            id,
            '--token',
            prepared.token,
          ]);
          assert.equal(synced.state, 'synced');
          assert.deepEqual(synced.outcome, published.outcome);
          const independentAfter = await cli(
            ['--require-fresh', 'category-groups', 'list', '--include-hidden'],
            { client: 'independent' },
          );
          assert.equal(
            independentAfter.some(row => row.id === sourceId),
            false,
          );
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        if (closed) await closed;
        await f.dispose();
      }
    },
  );
}
