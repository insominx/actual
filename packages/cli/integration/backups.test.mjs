import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

test(
  'retention previews and applies per-source policy while preserving invalid and external artifacts',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const loaded = await f.cli(['accounts', 'list']);
      assert.equal(loaded.code, 0, loaded.stderr);
      const directory = join(f.root, 'backups');
      const paths = [];
      for (let n = 0; n < 3; n++) {
        const created = await f.cli([
          '--offline',
          'backups',
          'create',
          '--directory',
          directory,
        ]);
        assert.equal(created.code, 0, created.stderr);
        paths.push(JSON.parse(created.stdout).data.path);
      }
      const restored = await f.cli([
        '--offline',
        'backups',
        'restore',
        paths[2],
        '--name',
        'Retention second source',
        '--operation-id',
        'retention-restore',
      ]);
      assert.equal(restored.code, 0, restored.stdout + restored.stderr);
      const second = await f.cli([
        '--offline',
        '--budget-id',
        JSON.parse(restored.stdout).data.id,
        'backups',
        'create',
        '--directory',
        directory,
      ]);
      assert.equal(second.code, 0, second.stderr);
      const secondPath = JSON.parse(second.stdout).data.path;
      const corrupt = join(directory, 'newest-corrupt.actualbackup');
      await cp(paths[2], corrupt, { recursive: true });
      const manifest = JSON.parse(
        await readFile(join(corrupt, 'manifest.json'), 'utf8'),
      );
      manifest.createdAt = '9999-01-01T00:00:00.000Z';
      const truncated = new Uint8Array([1, 2, 3]);
      manifest.bytes = truncated.length;
      manifest.sha256 = createHash('sha256').update(truncated).digest('hex');
      await writeFile(join(corrupt, 'budget.zip'), truncated);
      await writeFile(join(corrupt, 'manifest.json'), JSON.stringify(manifest));
      const outside = join(f.root, 'outside.actualbackup');
      await cp(paths[2], outside, { recursive: true });
      await symlink(
        outside,
        join(directory, 'external.actualbackup'),
        'junction',
      );
      const newestArchive = await readFile(join(paths[2], 'budget.zip'));
      const inventory = await readdir(directory);
      const preview = await f.cli([
        'backups',
        'prune',
        '--directory',
        directory,
        '--keep',
        '1',
      ]);
      assert.equal(preview.code, 0, preview.stdout + preview.stderr);
      const policy = JSON.parse(preview.stdout).data;
      assert.equal(policy.applied, false);
      assert.deepEqual(new Set(policy.candidates), new Set(paths.slice(0, 2)));
      assert.deepEqual(new Set(policy.kept), new Set([paths[2], secondPath]));
      assert.equal(policy.invalid.length, 2);
      assert.deepEqual(await readdir(directory), inventory);
      const limited = await f.cli([
        'backups',
        'prune',
        '--directory',
        directory,
        '--keep',
        '1',
        '--limit',
        '1',
        '--apply',
      ]);
      assert.equal(limited.code, 2, limited.stdout);
      assert.deepEqual(await readdir(directory), inventory);
      const cancelled = await f.cli(
        [
          'backups',
          'prune',
          '--directory',
          directory,
          '--keep',
          '1',
          '--apply',
        ],
        { input: 'cancel\n' },
      );
      assert.equal(cancelled.code, 2, cancelled.stdout);
      assert.deepEqual(await readdir(directory), inventory);
      const applied = await f.cli([
        'backups',
        'prune',
        '--directory',
        directory,
        '--keep',
        '1',
        '--apply',
      ]);
      assert.equal(applied.code, 0, applied.stdout + applied.stderr);
      assert.deepEqual(
        new Set(JSON.parse(applied.stdout).data.deleted),
        new Set(paths.slice(0, 2)),
      );
      assert.deepEqual(
        await readFile(join(paths[2], 'budget.zip')),
        newestArchive,
      );
      assert.deepEqual(
        await readFile(join(outside, 'budget.zip')),
        newestArchive,
      );
      assert.deepEqual(
        await readFile(join(corrupt, 'budget.zip')),
        Buffer.from(truncated),
      );
      assert.ok(
        (await readdir(directory)).includes(secondPath.split(/[\\/]/).at(-1)),
      );
      const after = await f.cli(['accounts', 'list'], {
        client: 'independent',
      });
      assert.equal(after.code, 0, after.stderr);
      assert.deepEqual(
        JSON.parse(after.stdout).data,
        JSON.parse(loaded.stdout).data,
      );
    } finally {
      await f.dispose();
    }
  },
);

test(
  'restore creates independent local identities and preserves the encrypted source',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const loaded = await f.cli(['accounts', 'list', '--include-closed']);
      assert.equal(loaded.code, 0, loaded.stderr);
      const directory = join(f.root, 'backups');
      const created = await f.cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        directory,
      ]);
      assert.equal(created.code, 0, created.stderr);
      const path = JSON.parse(created.stdout).data.path;
      const originalArchive = await readFile(join(path, 'budget.zip'));
      const sourceMetadata = await readFile(
        join(f.root, 'a', f.fixture.budgetId, 'metadata.json'),
      );
      const sourceCachePath = join(
        f.root,
        'a',
        '.actual-cli',
        f.fixture.syncId,
        'state.json',
      );
      const sourceCache = await readFile(sourceCachePath);
      const beforeRemote = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(beforeRemote.code, 0, beforeRemote.stderr);
      const restoredIds = [];
      for (const name of ['Restored copy', 'Second restored copy']) {
        const restored = await f.cli([
          '--offline',
          'backups',
          'restore',
          path,
          '--name',
          name,
          '--operation-id',
          `restore-copy-${restoredIds.length}`,
        ]);
        assert.equal(restored.code, 0, restored.stdout + restored.stderr);
        const result = JSON.parse(restored.stdout);
        assert.equal(result.operation, 'backups.restore');
        assert.equal(result.context.commit, 'committed-local');
        assert.equal(result.data.published, false);
        assert.equal(result.data.sourceBudgetId, f.fixture.budgetId);
        assert.equal(result.data.syncId, null);
        assert.equal(result.data.cloudFileId, null);
        assert.equal(result.data.encryptKeyId, null);
        assert.notEqual(result.data.id, f.fixture.budgetId);
        assert.ok(!restoredIds.includes(result.data.id));
        restoredIds.push(result.data.id);
        assert.deepEqual(result.data.snapshot, f.fixture.snapshot);
        const accounts = await f.cli([
          '--offline',
          '--budget-id',
          result.data.id,
          'accounts',
          'list',
          '--include-closed',
        ]);
        assert.equal(accounts.code, 0, accounts.stderr);
        assert.deepEqual(
          JSON.parse(accounts.stdout).data,
          JSON.parse(loaded.stdout).data,
        );
      }
      const duplicate = await f.cli([
        '--offline',
        'backups',
        'restore',
        path,
        '--name',
        'Restored copy',
        '--operation-id',
        'duplicate-restore',
      ]);
      assert.equal(duplicate.code, 2, duplicate.stdout);
      assert.equal(JSON.parse(duplicate.stdout).context.commit, 'none');
      const cancelled = await f.cli(
        [
          '--offline',
          'backups',
          'restore',
          path,
          '--name',
          'Cancelled restore',
          '--operation-id',
          'cancelled-restore',
        ],
        { input: 'cancel\n' },
      );
      assert.equal(cancelled.code, 2, cancelled.stdout);
      assert.equal(JSON.parse(cancelled.stdout).context.commit, 'none');
      const online = await f.cli([
        'backups',
        'restore',
        path,
        '--name',
        'Online restore',
        '--operation-id',
        'online-restore',
      ]);
      assert.equal(online.code, 2, online.stdout);
      const fresh = await f.cli(
        [
          '--offline',
          'backups',
          'restore',
          path,
          '--name',
          'Fresh cache restore',
          '--operation-id',
          'fresh-cache-restore',
        ],
        { client: 'fresh-restore' },
      );
      assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
      assert.notEqual(JSON.parse(fresh.stdout).data.id, f.fixture.budgetId);
      const matching = await f.cli([
        '--offline',
        'budgets',
        'compare',
        f.fixture.budgetId,
        restoredIds[0],
      ]);
      assert.equal(matching.code, 0, matching.stdout + matching.stderr);
      const comparison = JSON.parse(matching.stdout);
      assert.equal(comparison.operation, 'budgets.compare');
      assert.equal(comparison.context.commit, 'none');
      assert.equal(comparison.data.sameDomainState, true);
      assert.equal(comparison.data.total, 0);
      assert.equal(comparison.data.left.id, f.fixture.budgetId);
      assert.equal(comparison.data.right.id, restoredIds[0]);
      const edited = await f.cli([
        '--offline',
        '--budget-id',
        restoredIds[0],
        'accounts',
        'create',
        '--operation-id',
        'fixture-account-backups-test-1',
        '--name',
        'Restored only',
        '--balance',
        '777',
      ]);
      assert.equal(edited.code, 0, edited.stderr);
      assert.deepEqual(await readFile(sourceCachePath), sourceCache);
      const changed = await f.cli([
        '--offline',
        'budgets',
        'compare',
        f.fixture.budgetId,
        restoredIds[0],
        '--limit',
        '1',
      ]);
      assert.equal(changed.code, 0, changed.stdout + changed.stderr);
      const differences = JSON.parse(changed.stdout).data;
      assert.equal(differences.sameDomainState, false);
      assert.ok(differences.total > 1);
      assert.equal(differences.differences.length, 1);
      assert.equal(differences.truncated, true);
      const unknown = await f.cli([
        '--offline',
        'budgets',
        'compare',
        f.fixture.budgetId,
        'missing-budget',
      ]);
      assert.equal(unknown.code, 3, unknown.stdout);
      const independent = await f.cli(
        ['accounts', 'list', '--include-closed'],
        { client: 'independent' },
      );
      assert.equal(independent.code, 0, independent.stderr);
      assert.deepEqual(
        JSON.parse(independent.stdout).data,
        JSON.parse(loaded.stdout).data,
      );
      const afterRemote = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(afterRemote.code, 0, afterRemote.stderr);
      assert.deepEqual(
        JSON.parse(afterRemote.stdout).data,
        JSON.parse(beforeRemote.stdout).data,
      );
      assert.deepEqual(
        await readFile(join(path, 'budget.zip')),
        originalArchive,
      );
      assert.deepEqual(
        await readFile(join(f.root, 'a', f.fixture.budgetId, 'metadata.json')),
        sourceMetadata,
      );
    } finally {
      await f.dispose();
    }
  },
);

test(
  'isolated validation rejects corrupt archives and listing preserves complete artifacts',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true, richBackup: true });
    try {
      const loaded = await f.cli(['accounts', 'list', '--include-closed']);
      assert.equal(loaded.code, 0, loaded.stderr);
      const directory = join(f.root, 'backups');
      const created = await f.cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        directory,
      ]);
      assert.equal(created.code, 0, created.stderr);
      const path = JSON.parse(created.stdout).data.path;
      const original = await readFile(join(path, 'budget.zip'));
      const manifestBytes = await readFile(join(path, 'manifest.json'));
      const validated = await f.cli(['backups', 'validate', path]);
      assert.equal(validated.code, 0, validated.stdout + validated.stderr);
      const validation = JSON.parse(validated.stdout);
      assert.equal(validation.operation, 'backups.validate');
      assert.equal(validation.data.valid, true);
      assert.equal(validation.data.isolated, true);
      assert.ok(validation.data.snapshot.tables.transactions.rows > 0);
      assert.ok(validation.data.snapshot.tables.schedules.rows > 0);
      assert.ok(validation.data.snapshot.tables.rules.rows > 0);
      assert.ok(validation.data.snapshot.tables.zero_budgets.rows > 0);
      assert.deepEqual(validation.data.snapshot, f.fixture.snapshot);
      assert.equal(
        validation.data.snapshot.accountBalances.length,
        JSON.parse(loaded.stdout).data.length,
      );
      const corruptPath = join(directory, 'corrupt.actualbackup');
      await cp(path, corruptPath, { recursive: true, errorOnExist: true });
      const truncated = original.subarray(0, 23);
      await writeFile(join(corruptPath, 'budget.zip'), truncated);
      const hashFailure = await f.cli(['backups', 'validate', corruptPath]);
      assert.equal(hashFailure.code, 2, hashFailure.stdout);
      const forged = JSON.parse(manifestBytes);
      forged.bytes = truncated.length;
      forged.sha256 = createHash('sha256').update(truncated).digest('hex');
      await writeFile(
        join(corruptPath, 'manifest.json'),
        JSON.stringify(forged),
      );
      const importFailure = await f.cli(['backups', 'validate', corruptPath]);
      assert.equal(importFailure.code, 2, importFailure.stdout);
      await writeFile(join(corruptPath, 'budget.zip'), original);
      await writeFile(
        join(corruptPath, 'manifest.json'),
        JSON.stringify({
          ...JSON.parse(manifestBytes),
          archiveFile: '../../budget.zip',
        }),
      );
      const pathFailure = await f.cli(['backups', 'validate', corruptPath]);
      assert.equal(pathFailure.code, 2, pathFailure.stdout);
      await writeFile(
        join(corruptPath, 'manifest.json'),
        JSON.stringify({
          ...JSON.parse(manifestBytes),
          source: { ...JSON.parse(manifestBytes).source, id: 'wrong-identity' },
        }),
      );
      const identityFailure = await f.cli(['backups', 'validate', corruptPath]);
      assert.equal(identityFailure.code, 2, identityFailure.stdout);
      const cancelled = await f.cli(['backups', 'validate', path], {
        input: 'cancel\n',
      });
      assert.equal(cancelled.code, 2, cancelled.stdout);
      assert.match(JSON.parse(cancelled.stdout).error.message, /cancelled/);
      const listed = await f.cli([
        'backups',
        'list',
        '--directory',
        directory,
        '--limit',
        '1',
      ]);
      assert.equal(listed.code, 0, listed.stderr);
      const inventory = JSON.parse(listed.stdout).data;
      assert.equal(inventory.total, 2);
      assert.equal(inventory.items.length, 1);
      assert.equal(inventory.truncated, true);
      assert.deepEqual(await readFile(join(path, 'budget.zip')), original);
      assert.deepEqual(
        await readFile(join(path, 'manifest.json')),
        manifestBytes,
      );
      const after = await f.cli(['accounts', 'list', '--include-closed'], {
        client: 'independent',
      });
      assert.equal(after.code, 0, after.stderr);
      assert.deepEqual(
        JSON.parse(after.stdout).data,
        JSON.parse(loaded.stdout).data,
      );
    } finally {
      await f.dispose();
    }
  },
);

test(
  'an encrypted sync budget creates complete plaintext backups without replacing earlier artifacts',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true });
    try {
      const loaded = await f.cli(['accounts', 'list']);
      assert.equal(loaded.code, 0, loaded.stderr);
      const originalAccounts = JSON.parse(loaded.stdout).data;
      const directory = join(f.root, 'backups');
      const created = await f.cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        directory,
      ]);
      assert.equal(created.code, 0, created.stdout + created.stderr);
      const artifact = JSON.parse(created.stdout);
      assert.equal(artifact.operation, 'backups.create');
      assert.equal(artifact.context.commit, 'none');
      const manifest = JSON.parse(
        await readFile(join(artifact.data.path, 'manifest.json'), 'utf8'),
      );
      const archive = await readFile(join(artifact.data.path, 'budget.zip'));
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.source.syncId, f.fixture.syncId);
      assert.equal(manifest.encrypted, false);
      assert.equal(manifest.sourceEncrypted, true);
      assert.equal(manifest.remoteFreshness, 'unknown');
      assert.equal(manifest.bytes, archive.length);
      assert.equal(
        manifest.sha256,
        createHash('sha256').update(archive).digest('hex'),
      );
      assert.equal(archive.subarray(0, 2).toString(), 'PK');
      const second = await f.cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        directory,
      ]);
      assert.equal(second.code, 0, second.stderr);
      assert.notEqual(JSON.parse(second.stdout).data.path, artifact.data.path);
      assert.deepEqual(
        await readFile(join(artifact.data.path, 'budget.zip')),
        archive,
      );
      const entries = await readdir(directory);
      assert.equal(entries.length, 2);
      assert.ok(entries.every(name => name.endsWith('.actualbackup')));
      const after = await f.cli(['accounts', 'list'], {
        client: 'independent',
      });
      assert.equal(after.code, 0, after.stderr);
      assert.deepEqual(JSON.parse(after.stdout).data, originalAccounts);
    } finally {
      await f.dispose();
    }
  },
);
