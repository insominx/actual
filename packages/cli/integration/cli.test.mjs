import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture, repoRoot, runNode } from './harness.mjs';

test('packaged discovery and validation work without personal configuration', async () => {
  const discovered = await runNode([
    join(repoRoot, 'packages/cli/dist/cli.js'),
    'capabilities',
  ]);
  assert.equal(discovered.code, 0, discovered.stderr);
  const result = JSON.parse(discovered.stdout);
  assert.equal(result.context.mode, 'no-budget');
  assert.ok(result.data.operations.some(o => o.name === 'transactions.import'));
  const invalid = await runNode([
    join(repoRoot, 'packages/cli/dist/cli.js'),
    '--output-version',
    '2',
    'accounts',
    'create',
    '--operation-id',
    'fixture-account-cli-test-1',
    '--name',
    'a',
    '--balance',
    '9007199254740992',
  ]);
  assert.equal(invalid.code, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_INPUT');
});

test(
  'encrypted remote sessions register keys across process restarts',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true });
    try {
      const read = await f.cli(['accounts', 'list']);
      assert.equal(read.code, 0, read.stderr);
      const wrong = await f.cli(['accounts', 'list'], {
        client: 'wrong-key',
        env: { ACTUAL_ENCRYPTION_PASSWORD: 'incorrect' },
      });
      assert.equal(wrong.code, 5);
      assert.equal(JSON.parse(wrong.stdout).error.code, 'ENGINE_FAILURE');
      assert.ok(!wrong.stdout.includes('incorrect'));
      const diagnosis = await f.cli(['doctor'], {
        client: 'doctor-wrong-key',
        env: { ACTUAL_ENCRYPTION_PASSWORD: 'incorrect' },
      });
      assert.equal(diagnosis.code, 5);
      assert.equal(
        JSON.parse(diagnosis.stdout).error.details.issue,
        'encryption-failed',
      );
      const written = await f.cli([
        'accounts',
        'create',
        '--operation-id',
        'fixture-account-cli-test-2',
        '--name',
        'Encrypted restart write',
      ]);
      assert.equal(written.code, 0, written.stderr);
      const second = await f.cli(['accounts', 'list'], { client: 'b' });
      assert.equal(second.code, 0, second.stderr);
      assert.ok(
        JSON.parse(second.stdout).data.some(
          a => a.name === 'Encrypted restart write',
        ),
      );
    } finally {
      await f.dispose();
    }
  },
);

test(
  'real server, import deduplication, two clients, and restart',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    try {
      let result = await f.cli(['accounts', 'list', '--include-closed']);
      assert.equal(result.code, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.context.currency, 'USD');
      assert.equal(output.context.syncId, f.fixture.syncId);
      assert.ok(
        output.data.some(a => a.id === f.fixture.card && a.balance === -200000),
      );
      assert.ok(output.data.some(a => a.id === f.fixture.closed));
      const badPassword = await f.cli(['accounts', 'list'], {
        client: 'bad-password',
        env: { ACTUAL_PASSWORD: 'incorrect-disposable-password' },
      });
      assert.equal(badPassword.code, 5);
      assert.ok(!badPassword.stdout.includes('incorrect-disposable-password'));
      const secondBudget = await f.cli([
        '--sync-id',
        f.fixture.otherSyncId,
        'accounts',
        'list',
      ]);
      assert.equal(secondBudget.code, 0, secondBudget.stderr);
      const secondOutput = JSON.parse(secondBudget.stdout);
      assert.equal(secondOutput.context.syncId, f.fixture.otherSyncId);
      assert.equal(secondOutput.data.length, 1);
      assert.equal(secondOutput.data[0].name, 'Other budget only');
      result = await f.cli(['accounts', 'list']);
      assert.equal(JSON.parse(result.stdout).context.syncId, f.fixture.syncId);
      assert.ok(
        !JSON.parse(result.stdout).data.some(
          a => a.name === 'Other budget only',
        ),
      );
      const holder = await f.holdReadLock();
      try {
        const contention = await f.cli([
          '--lock-timeout',
          '1',
          'accounts',
          'create',
          '--operation-id',
          'fixture-account-cli-test-3',
          '--name',
          'Must not be created',
        ]);
        assert.equal(contention.code, 5);
      } finally {
        const exited = new Promise(resolveExit =>
          holder.once('exit', resolveExit),
        );
        holder.kill();
        await exited;
      }
      const recovered = await f.cli([
        'accounts',
        'create',
        '--operation-id',
        'fixture-account-cli-test-4',
        '--name',
        'Recovered after killed reader',
      ]);
      assert.equal(recovered.code, 0, recovered.stderr);
      const input = JSON.stringify([
        {
          date: '2026-08-08',
          amount: -2300,
          imported_id: 'repeatable-import',
          payee_name: 'Test merchant',
          category: f.fixture.dining,
        },
      ]);
      result = await f.cli(
        [
          'transactions',
          'import',
          '--account',
          f.fixture.checking,
          '--file',
          '-',
        ],
        { input },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).context.commit, 'synced');
      result = await f.cli(
        [
          'transactions',
          'import',
          '--account',
          f.fixture.checking,
          '--file',
          '-',
        ],
        { input, client: 'b' },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).data.added.length, 0);
      result = await f.cli([
        '--refresh',
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ]);
      const imported = JSON.parse(result.stdout).data.filter(
        t => t.imported_id === 'repeatable-import',
      );
      assert.equal(imported.length, 1);
      const transaction = imported[0];
      const profileFile = await f.writeInput('profile-input.json', {
        syncId: f.fixture.syncId,
        serverUrl: f.serverUrl,
      });
      const profilesFile = join(f.root, 'profiles.json');
      result = await f.cli([
        '--profiles-file',
        profilesFile,
        'profiles',
        'set',
        'disposable',
        '--file',
        profileFile,
      ]);
      assert.equal(result.code, 0, result.stderr);
      const shown = await f.cli([
        '--profiles-file',
        profilesFile,
        'profiles',
        'show',
        'disposable',
      ]);
      assert.equal(JSON.parse(shown.stdout).data.syncId, f.fixture.syncId);
      const otherProfile = await f.writeInput('other-profile.json', {
        syncId: f.fixture.otherSyncId,
        serverUrl: f.serverUrl,
      });
      result = await f.cli([
        '--profiles-file',
        profilesFile,
        'profiles',
        'set',
        'other',
        '--file',
        otherProfile,
      ]);
      assert.equal(result.code, 0, result.stderr);
      result = await f.cli(
        [
          '--profiles-file',
          profilesFile,
          '--profile',
          'other',
          'accounts',
          'list',
        ],
        {
          env: { ACTUAL_SYNC_ID: undefined },
        },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        JSON.parse(result.stdout).context.syncId,
        f.fixture.otherSyncId,
      );
      assert.equal(JSON.parse(result.stdout).data.length, 1);
      result = await f.cli(
        [
          'transactions',
          'update',
          transaction.id,
          '--data',
          JSON.stringify({ notes: 'Changed by second client' }),
        ],
        { client: 'b' },
      );
      assert.equal(result.code, 0, result.stderr);
      await f.stop();
      const offlineRead = await f.cli(['--offline', 'accounts', 'list']);
      assert.equal(offlineRead.code, 0, offlineRead.stderr);
      assert.equal(
        JSON.parse(offlineRead.stdout).context.mode,
        'offline-local',
      );
      const localRead = await f.cli([
        '--offline',
        '--budget-id',
        output.context.budgetId,
        'accounts',
        'list',
      ]);
      assert.equal(localRead.code, 0, localRead.stderr);
      assert.equal(
        JSON.parse(localRead.stdout).context.budgetId,
        output.context.budgetId,
      );
      const offlineEdit = await f.cli([
        '--offline',
        'transactions',
        'update',
        transaction.id,
        '--data',
        JSON.stringify({ notes: 'Edited offline' }),
      ]);
      assert.equal(offlineEdit.code, 0, offlineEdit.stderr);
      assert.equal(
        JSON.parse(offlineEdit.stdout).context.commit,
        'committed-local',
      );
      const offlineVerify = await f.cli([
        '--offline',
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ]);
      assert.equal(offlineVerify.code, 0, offlineVerify.stderr);
      assert.equal(
        JSON.parse(offlineVerify.stdout).data.find(t => t.id === transaction.id)
          .notes,
        'Edited offline',
      );
      const failed = await f.cli(['--refresh', 'accounts', 'list']);
      assert.equal(failed.code, 5);
      assert.equal(JSON.parse(failed.stdout).error.code, 'ENGINE_FAILURE');
      await f.start();
      result = await f.cli([
        '--refresh',
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-08-01',
        '--end',
        '2026-08-31',
      ]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        JSON.parse(result.stdout).data.find(t => t.id === transaction.id).notes,
        'Edited offline',
      );
      const remoteView = await f.cli(
        [
          '--refresh',
          'transactions',
          'list',
          '--account',
          f.fixture.checking,
          '--start',
          '2026-08-01',
          '--end',
          '2026-08-31',
        ],
        { client: 'b' },
      );
      assert.equal(
        JSON.parse(remoteView.stdout).data.find(t => t.id === transaction.id)
          .notes,
        'Edited offline',
      );
      const legacy = await f.cli(['accounts', 'balance', f.fixture.card], {
        version: '1',
      });
      assert.deepEqual(JSON.parse(legacy.stdout), {
        id: f.fixture.card,
        balance: -200000,
      });
    } finally {
      await f.dispose();
    }
  },
);
