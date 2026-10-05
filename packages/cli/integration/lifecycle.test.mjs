import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

test(
  'encrypted first publication survives a lost response, retries one identity, and preserves rename/archive semantics',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    const uploads = [];
    let loseUploadResponse = true;
    let advertiseEncryption = false;
    const proxy = createServer(async (req, res) => {
      try {
        if (req.url === '/health' && !advertiseEncryption) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'UP' }));
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = { ...req.headers };
        delete headers.host;
        const upstream = await fetch(f.serverUrl + req.url, {
          method: req.method,
          headers,
          ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body }),
        });
        const response = Buffer.from(await upstream.arrayBuffer());
        if (req.url === '/sync/upload-user-file') {
          uploads.push({ body, headers, status: upstream.status });
          if (loseUploadResponse && upstream.ok) {
            loseUploadResponse = false;
            res.destroy();
            return;
          }
        }
        res.writeHead(upstream.status, {
          'Content-Type':
            upstream.headers.get('content-type') ?? 'application/json',
        });
        res.end(response);
      } catch {
        res.destroy();
      }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const env = {
      ACTUAL_SERVER_URL: proxyUrl,
      ACTUAL_ENCRYPTION_PASSWORD: 'publication-secret',
    };
    try {
      const created = await f.cli([
        '--offline',
        'budgets',
        'create',
        '--name',
        'Publish me',
        '--operation-id',
        'create-publication',
        '--currency',
        'USD',
      ]);
      assert.equal(created.code, 0, created.stderr);
      const id = JSON.parse(created.stdout).data.id;
      const account = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'accounts',
        'create',
        '--operation-id',
        'fixture-account-lifecycle-test-1',
        '--name',
        'Cash',
        '--balance',
        '12345',
      ]);
      assert.equal(account.code, 0, account.stderr);
      const selected = await f.cli([
        'budgets',
        'select',
        id,
        '--save-profile',
        'publication',
      ]);
      assert.equal(selected.code, 0, selected.stderr);
      const unsupported = await f.cli(
        ['budgets', 'publish', id, '--operation-id', 'lifecycle-publication'],
        { env },
      );
      assert.equal(
        unsupported.code,
        2,
        unsupported.stderr + unsupported.stdout,
      );
      assert.equal(uploads.length, 0);
      const unchanged = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'inspect',
      ]);
      assert.equal(unchanged.code, 0, unchanged.stderr);
      assert.equal(JSON.parse(unchanged.stdout).data.cloudFileId, null);
      assert.equal(JSON.parse(unchanged.stdout).data.publicationStatus, null);
      advertiseEncryption = true;
      const uncertain = await f.cli(
        ['budgets', 'publish', id, '--operation-id', 'lifecycle-publication'],
        { env },
      );
      assert.equal(uncertain.code, 6, uncertain.stderr + uncertain.stdout);
      const prepared = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'inspect',
      ]);
      assert.equal(prepared.code, 0, prepared.stderr);
      const pending = JSON.parse(prepared.stdout).data;
      assert.equal(pending.publicationStatus, 'prepared');
      assert.ok(pending.cloudFileId);
      assert.ok(pending.encryptKeyId);
      const retry = await f.cli(
        ['budgets', 'publish', id, '--operation-id', 'lifecycle-publication'],
        { env },
      );
      assert.equal(retry.code, 0, retry.stderr + retry.stdout);
      const published = JSON.parse(retry.stdout).data;
      assert.equal(published.cloudFileId, pending.cloudFileId);
      assert.equal(published.encryptKeyId, pending.encryptKeyId);
      assert.equal(published.publicationStatus, 'published');
      assert.ok(published.syncId);
      assert.equal(uploads.length, 1);
      assert.equal(uploads[0].status, 200);
      assert.ok(uploads[0].headers['x-actual-initial-key']);
      assert.notEqual(uploads[0].body.subarray(0, 2).toString(), 'PK');
      const again = await f.cli(
        ['budgets', 'publish', id, '--operation-id', 'lifecycle-publication'],
        { env },
      );
      assert.equal(again.code, 0, again.stderr);
      assert.equal(JSON.parse(again.stdout).data.syncId, published.syncId);
      assert.equal(uploads.length, 1);
      const otherServer = await f.cli(
        ['budgets', 'publish', id, '--operation-id', 'lifecycle-publication'],
        {
          env: { ...env, ACTUAL_SERVER_URL: f.serverUrl },
        },
      );
      assert.notEqual(otherServer.code, 0);
      await f.stop();
      await f.start();
      const readerEnv = {
        ACTUAL_ENCRYPTION_PASSWORD: 'publication-secret',
        ACTUAL_PROFILES_FILE: join(f.root, 'reader-profiles.json'),
      };
      const read = await f.cli(
        ['--sync-id', published.syncId, 'accounts', 'list'],
        { client: 'reader', env: readerEnv },
      );
      assert.equal(read.code, 0, read.stderr);
      assert.equal(JSON.parse(read.stdout).data[0].name, 'Cash');
      const wrong = await f.cli(
        ['--sync-id', published.syncId, 'accounts', 'list'],
        {
          client: 'wrong',
          env: { ...readerEnv, ACTUAL_ENCRYPTION_PASSWORD: 'wrong-secret' },
        },
      );
      assert.notEqual(wrong.code, 0);
      assert.equal(wrong.stdout.includes('publication-secret'), false);
      const renamed = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'rename',
        '--name',
        'Renamed publication',
        '--operation-id',
        'publication-rename',
      ]);
      assert.equal(renamed.code, 0, renamed.stderr);
      const archived = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'archive',
        '--operation-id',
        'publication-archive',
      ]);
      assert.equal(archived.code, 0, archived.stderr);
      assert.equal(JSON.parse(archived.stdout).data.archived, true);
      assert.equal(JSON.parse(archived.stdout).data.remoteDeleted, false);
      const inventory = await f.cli(['--offline', 'budgets', 'list']);
      assert.equal(inventory.code, 0, inventory.stderr);
      assert.equal(
        JSON.parse(inventory.stdout).data.find(b => b.id === id).archived,
        true,
      );
      const restored = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'archive',
        '--restore',
        '--operation-id',
        'publication-unarchive',
      ]);
      assert.equal(restored.code, 0, restored.stderr);
      assert.equal(JSON.parse(restored.stdout).data.archived, false);
      const synced = await f.cli(
        ['--sync-id', published.syncId, 'budgets', 'inspect'],
        { env: readerEnv },
      );
      assert.equal(synced.code, 0, synced.stderr);
      const fresh = await f.cli(
        ['--sync-id', published.syncId, 'budgets', 'inspect'],
        { client: 'fresh-reader', env: readerEnv },
      );
      assert.equal(fresh.code, 0, fresh.stderr);
      assert.equal(JSON.parse(fresh.stdout).data.name, 'Renamed publication');
      assert.equal(JSON.parse(fresh.stdout).data.archived, false);
      const copy = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'clone',
        '--name',
        'Publication copy',
        '--operation-id',
        'publication-clone',
      ]);
      assert.equal(copy.code, 0, copy.stderr);
      const copyData = JSON.parse(copy.stdout).data;
      assert.equal(copyData.publicationStatus, null);
      assert.equal(copyData.cloudFileId, null);
    } finally {
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      await f.dispose();
    }
  },
);

test(
  'CLI clones an encrypted cached budget without modifying or publishing its source',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true });
    try {
      const downloaded = await f.cli(['accounts', 'list']);
      assert.equal(downloaded.code, 0, downloaded.stderr);
      const originalAccounts = JSON.parse(downloaded.stdout).data;
      const before = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(before.code, 0, before.stderr);
      const cloned = await f.cli([
        '--offline',
        'budgets',
        'clone',
        '--name',
        'Isolated copy',
        '--operation-id',
        'isolated-clone',
      ]);
      assert.equal(cloned.code, 0, cloned.stderr);
      const clone = JSON.parse(cloned.stdout);
      assert.equal(clone.operation, 'budgets.clone');
      assert.equal(clone.context.commit, 'committed-local');
      assert.equal(clone.data.published, false);
      assert.equal(clone.data.syncId, null);
      assert.equal(clone.data.cloudFileId, null);
      assert.equal(clone.data.encryptKeyId, null);
      assert.notEqual(clone.data.id, clone.data.sourceBudgetId);
      const metadata = JSON.parse(
        await readFile(
          join(f.root, 'a', clone.data.id, 'metadata.json'),
          'utf8',
        ),
      );
      assert.equal(metadata.cloudFileId, undefined);
      assert.equal(metadata.groupId, undefined);
      assert.equal(metadata.encryptKeyId, undefined);
      const id = clone.data.id;
      const edited = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'accounts',
        'create',
        '--operation-id',
        'fixture-account-lifecycle-test-2',
        '--name',
        'Clone only',
        '--balance',
        '999',
      ]);
      assert.equal(edited.code, 0, edited.stderr);
      const selected = await f.cli([
        'budgets',
        'select',
        id,
        '--save-profile',
        'clone',
      ]);
      assert.equal(selected.code, 0, selected.stderr);
      const store = JSON.parse(
        await readFile(join(f.root, 'profiles.json'), 'utf8'),
      );
      assert.equal(store.selected, 'clone');
      assert.equal(store.profiles.clone.budgetId, id);
      assert.equal(store.profiles.clone.syncId, undefined);
      const reopened = await f.cli([
        '--profile',
        'clone',
        'budgets',
        'inspect',
      ]);
      assert.equal(reopened.code, 0, reopened.stderr);
      assert.equal(JSON.parse(reopened.stdout).data.id, id);
      const cloneAccounts = await f.cli([
        '--profile',
        'clone',
        'accounts',
        'list',
      ]);
      assert.equal(cloneAccounts.code, 0, cloneAccounts.stderr);
      assert.equal(
        JSON.parse(cloneAccounts.stdout).data.length,
        originalAccounts.length + 1,
      );
      // Explicit selectors override the profile. Use a new cache to observe the server.
      const original = await f.cli([
        '--offline',
        '--budget-id',
        clone.data.sourceBudgetId,
        'accounts',
        'list',
      ]);
      assert.equal(original.code, 0, original.stderr);
      assert.deepEqual(JSON.parse(original.stdout).data, originalAccounts);
      const remote = await f.cli(
        ['--sync-id', f.fixture.syncId, 'accounts', 'list'],
        {
          client: 'independent',
          env: { ACTUAL_PROFILES_FILE: join(f.root, 'unused-profiles.json') },
        },
      );
      assert.equal(remote.code, 0, remote.stderr);
      assert.deepEqual(JSON.parse(remote.stdout).data, originalAccounts);
      const after = await f.cli(['budgets', 'list'], {
        client: 'seed',
        env: { ACTUAL_PROFILES_FILE: join(f.root, 'unused-profiles.json') },
      });
      assert.equal(after.code, 0, after.stderr);
      assert.deepEqual(
        JSON.parse(after.stdout).data,
        JSON.parse(before.stdout).data,
      );
      const duplicate = await f.cli([
        '--offline',
        '--budget-id',
        id,
        'budgets',
        'clone',
        '--name',
        'Isolated copy',
        '--operation-id',
        'isolated-clone-duplicate',
      ]);
      assert.equal(duplicate.code, 2, duplicate.stderr);
    } finally {
      await f.dispose();
    }
  },
);

test(
  'CLI creates a usable local budget without publishing to its configured server',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    try {
      const before = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(before.code, 0, before.stdout + before.stderr);
      const missingMode = await f.cli([
        'budgets',
        'create',
        '--name',
        'Local only',
        '--operation-id',
        'online-creation-rejected',
      ]);
      assert.equal(missingMode.code, 2);
      assert.match(JSON.parse(missingMode.stdout).error.message, /offline/);
      const created = await f.cli(
        [
          '--offline',
          'budgets',
          'create',
          '--name',
          'Local only',
          '--operation-id',
          'create-local',
          '--currency',
          'USD',
        ],
        { client: 'local' },
      );
      assert.equal(created.code, 0, created.stderr);
      const result = JSON.parse(created.stdout);
      assert.equal(result.operation, 'budgets.create');
      assert.equal(result.data.published, false);
      assert.equal(result.context.commit, 'committed-local');
      assert.equal(result.context.currency, 'USD');
      const id = result.data.id;
      const metadata = JSON.parse(
        await readFile(join(f.root, 'local', id, 'metadata.json'), 'utf8'),
      );
      assert.equal(metadata.groupId, undefined);
      assert.equal(metadata.cloudFileId, undefined);
      const account = await f.cli(
        [
          '--offline',
          '--budget-id',
          id,
          'accounts',
          'create',
          '--operation-id',
          'fixture-account-lifecycle-test-3',
          '--name',
          'Checking',
          '--balance',
          '10000',
        ],
        { client: 'local' },
      );
      assert.equal(account.code, 0, account.stderr);
      const reopened = await f.cli(
        ['--offline', '--budget-id', id, 'accounts', 'list'],
        { client: 'local' },
      );
      assert.equal(reopened.code, 0, reopened.stderr);
      assert.equal(JSON.parse(reopened.stdout).data[0].name, 'Checking');
      assert.equal(JSON.parse(reopened.stdout).context.currency, 'USD');
      const duplicate = await f.cli(
        [
          '--offline',
          'budgets',
          'create',
          '--name',
          'Local only',
          '--operation-id',
          'create-duplicate',
        ],
        { client: 'local' },
      );
      assert.equal(duplicate.code, 2);
      const after = await f.cli(['budgets', 'list'], { client: 'seed' });
      assert.equal(after.code, 0, after.stderr);
      assert.deepEqual(
        JSON.parse(after.stdout).data,
        JSON.parse(before.stdout).data,
      );
      const published = await f.cli(
        ['budgets', 'publish', id, '--operation-id', 'lifecycle-publication'],
        {
          client: 'local',
        },
      );
      assert.equal(published.code, 0, published.stderr);
      const publication = JSON.parse(published.stdout).data;
      assert.equal(publication.encryptKeyId, null);
      assert.ok(publication.syncId);
      const downloaded = await f.cli(
        ['--sync-id', publication.syncId, 'accounts', 'list'],
        { client: 'published-reader' },
      );
      assert.equal(downloaded.code, 0, downloaded.stderr);
      assert.equal(JSON.parse(downloaded.stdout).data[0].name, 'Checking');
    } finally {
      await f.dispose();
    }
  },
);
