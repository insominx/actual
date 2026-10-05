import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createFixture, isolatedEnv, repoRoot } from './harness.mjs';

const { fromBinary, SyncRequestSchema } = await import(
  pathToFileURL(join(repoRoot, 'packages/crdt/dist/index.js')).href
);

test(
  'watch freezes its selected budget while profiles switch and cache identities stay separate',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    let child;
    try {
      for (const [name, syncId] of [
        ['source', f.fixture.syncId],
        ['other', f.fixture.otherSyncId],
      ]) {
        const file = await f.writeInput(`${name}.json`, {
          syncId,
          serverUrl: f.serverUrl,
          dataDir: join(f.root, 'a'),
        });
        const set = await f.cli(['profiles', 'set', name, '--file', file]);
        assert.equal(set.code, 0, set.stderr);
      }
      const used = await f.cli(['profiles', 'use', 'source']);
      assert.equal(used.code, 0, used.stderr);
      child = spawn(
        process.execPath,
        [
          join(repoRoot, 'packages/cli/dist/cli.js'),
          'sync',
          'watch',
          '--interval',
          '2',
          '--samples',
          '2',
        ],
        {
          cwd: f.root,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: isolatedEnv({
            ACTUAL_PASSWORD: 'disposable-cli-test-password',
            ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
          }),
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      const closed = new Promise(resolve => child.once('close', resolve));
      const deadline = Date.now() + 15000;
      while (!stderr.includes('"sample":1')) {
        assert.equal(child.exitCode, null, stdout + stderr);
        assert.ok(Date.now() < deadline, stderr);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const switched = await f.cli(['profiles', 'use', 'other']);
      assert.equal(switched.code, 0, switched.stderr);
      const other = await f.cli(['sync', 'refresh'], {
        env: { ACTUAL_SYNC_ID: undefined },
      });
      assert.equal(other.code, 0, other.stderr);
      const otherStatus = JSON.parse(other.stdout).data;
      assert.equal(otherStatus.syncId, f.fixture.otherSyncId);
      assert.equal(await closed, 0, stdout + stderr);
      const watched = JSON.parse(stdout);
      assert.equal(watched.data.observations.length, 2);
      assert.ok(
        watched.data.observations.every(
          status => status.syncId === f.fixture.syncId,
        ),
      );
      assert.notEqual(
        watched.data.observations[0].budgetId,
        otherStatus.budgetId,
      );
      for (const syncId of [f.fixture.syncId, f.fixture.otherSyncId]) {
        const local = await f.cli([
          '--offline',
          '--sync-id',
          syncId,
          'sync',
          'status',
        ]);
        assert.equal(local.code, 0, local.stderr);
        const parsed = JSON.parse(local.stdout);
        assert.equal(parsed.data.syncId, syncId);
        assert.equal(parsed.context.syncId, syncId);
        assert.equal(parsed.data.pendingMessages, 0);
        assert.ok(parsed.context.lastSyncedAt > 0);
      }
      const sourceCloudId = watched.data.observations[0].cloudFileId;
      const cloudSelected = await f.cli([
        '--sync-id',
        sourceCloudId,
        'sync',
        'watch',
        '--samples',
        '1',
      ]);
      assert.equal(
        cloudSelected.code,
        3,
        cloudSelected.stdout + cloudSelected.stderr,
      );
      assert.equal(JSON.parse(cloudSelected.stdout).error.retryable, false);
    } finally {
      if (child?.exitCode === null) {
        const closed = new Promise(resolve => child.once('close', resolve));
        child.kill();
        await closed;
      }
      await f.dispose();
    }
  },
);

test(
  'watch bounds a stalled worker and a subsequent writer can reopen its cache',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    let stalled = 0;
    const proxy = createServer(async (req, res) => {
      if (req.url === '/sync/sync') {
        stalled++;
        return;
      }
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const headers = { ...req.headers };
        delete headers.host;
        const upstream = await fetch(f.serverUrl + req.url, {
          method: req.method,
          headers,
          ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }),
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
    try {
      const loaded = await f.cli(['accounts', 'list']);
      assert.equal(loaded.code, 0, loaded.stderr);
      const started = Date.now();
      const result = await f.cli(
        ['sync', 'watch', '--timeout', '2', '--retries', '0', '--samples', '1'],
        {
          env: {
            ACTUAL_SERVER_URL: `http://127.0.0.1:${proxy.address().port}`,
          },
        },
      );
      assert.equal(result.code, 5, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).error.retryable, true);
      assert.ok(stalled > 0);
      assert.ok(Date.now() - started < 10000);
      const child = spawn(
        process.execPath,
        [
          join(repoRoot, 'packages/cli/dist/cli.js'),
          'sync',
          'watch',
          '--timeout',
          '30',
        ],
        {
          cwd: f.root,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: isolatedEnv({
            ACTUAL_SERVER_URL: `http://127.0.0.1:${proxy.address().port}`,
            ACTUAL_PASSWORD: 'disposable-cli-test-password',
            ACTUAL_SYNC_ID: f.fixture.syncId,
            ACTUAL_DATA_DIR: join(f.root, 'a'),
            ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
          }),
        },
      );
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
      });
      child.stderr.resume();
      const closed = new Promise(resolve => child.once('close', resolve));
      try {
        const deadline = Date.now() + 10000;
        const previousStalled = stalled;
        while (stalled === previousStalled) {
          assert.equal(child.exitCode, null);
          assert.ok(Date.now() < deadline);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const cancelAt = Date.now();
        child.stdin.end('cancel\n');
        assert.equal(await closed, 0, output);
        assert.ok(Date.now() - cancelAt < 5000);
        assert.equal(JSON.parse(output).data.cancelled, true);
      } finally {
        if (child.exitCode === null) {
          child.kill();
          await closed;
        }
      }
      const reopened = await f.cli([
        '--offline',
        'budgets',
        'rename',
        '--name',
        'After stalled watch',
        '--operation-id',
        'after-stalled-watch',
      ]);
      assert.equal(reopened.code, 0, reopened.stderr);
    } finally {
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      await f.dispose();
    }
  },
);

test(
  'encrypted watch reconnects, cancels, and releases its cache for a writer',
  { timeout: 90000 },
  async () => {
    const f = await createFixture({ encrypted: true });
    let child;
    try {
      child = spawn(
        process.execPath,
        [
          join(repoRoot, 'packages/cli/dist/cli.js'),
          'sync',
          'watch',
          '--interval',
          '1',
          '--timeout',
          '5',
          '--samples',
          '100',
        ],
        {
          cwd: f.root,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: isolatedEnv({
            ACTUAL_SERVER_URL: f.serverUrl,
            ACTUAL_PASSWORD: 'disposable-cli-test-password',
            ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password',
            ACTUAL_SYNC_ID: f.fixture.syncId,
            ACTUAL_DATA_DIR: join(f.root, 'a'),
            ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
          }),
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      const closed = new Promise(resolve => child.once('close', resolve));
      async function waitFor(fragment) {
        const deadline = Date.now() + 15000;
        while (!stderr.includes(fragment)) {
          assert.equal(child.exitCode, null, stderr + stdout);
          assert.ok(Date.now() < deadline, `Missing ${fragment}: ${stderr}`);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      await waitFor('"sample":1');
      await f.stop();
      await waitFor('"event":"reconnecting"');
      await f.start();
      await waitFor('"sample":2');
      child.stdin.end('cancel\n');
      assert.equal(await closed, 0, stderr + stdout);
      const result = JSON.parse(stdout);
      assert.equal(result.operation, 'sync.watch');
      assert.equal(result.data.cancelled, true);
      assert.ok(result.data.reconnects >= 1);
      assert.ok(result.data.observations.length >= 2);
      assert.ok(
        result.data.observations.every(
          status => status.syncId === f.fixture.syncId,
        ),
      );
      const write = await f.cli([
        '--offline',
        'budgets',
        'rename',
        '--name',
        'After watch',
        '--operation-id',
        'after-watch',
      ]);
      assert.equal(write.code, 0, write.stderr);
    } finally {
      if (child?.exitCode === null) {
        const closed = new Promise(resolve => child.once('close', resolve));
        child.kill();
        await closed;
      }
      await f.dispose();
    }
  },
);

for (const encrypted of [false, true]) {
  test(
    `a failed push preserves the local write and refresh does not replay it (encrypted=${encrypted})`,
    { timeout: 90000 },
    async () => {
      const f = await createFixture({ encrypted });
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
        const loaded = await f.cli(['accounts', 'list'], { env });
        assert.equal(loaded.code, 0, loaded.stderr);
        rejectWrites = true;
        const write = await f.cli(
          [
            'accounts',
            'create',
            '--operation-id',
            'fixture-account-sync-test-1',
            '--name',
            'Only once',
            '--balance',
            '123',
          ],
          { env },
        );
        assert.equal(write.code, 6, write.stdout + write.stderr);
        assert.equal(
          JSON.parse(write.stdout).context.commit,
          'committed-local',
        );
        assert.equal(JSON.parse(write.stdout).context.freshness, 'unknown');
        assert.equal(JSON.parse(write.stdout).error.retryable, true);
        assert.ok(rejected > 0);
        const pending = await f.cli(['--offline', 'sync', 'status'], { env });
        assert.equal(pending.code, 0, pending.stderr);
        assert.ok(JSON.parse(pending.stdout).data.pendingMessages > 0);
        rejectWrites = false;
        const refreshed = await f.cli(['sync', 'refresh'], { env });
        assert.equal(refreshed.code, 0, refreshed.stderr);
        assert.equal(JSON.parse(refreshed.stdout).data.pendingMessages, 0);
        const remote = await f.cli(['accounts', 'list'], {
          client: 'independent',
        });
        assert.equal(remote.code, 0, remote.stderr);
        assert.equal(
          JSON.parse(remote.stdout).data.filter(a => a.name === 'Only once')
            .length,
          1,
        );
      } finally {
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
        await f.dispose();
      }
    },
  );
}
for (const encrypted of [false, true]) {
  test(
    `pending status is offline and refresh sends existing writes (encrypted=${encrypted})`,
    { timeout: 90000 },
    async () => {
      const f = await createFixture({ encrypted });
      try {
        const downloaded = await f.cli(['accounts', 'list']);
        assert.equal(downloaded.code, 0, downloaded.stderr);
        await f.stop();
        const initial = await f.cli(['--offline', 'sync', 'status']);
        assert.equal(initial.code, 0, initial.stderr);
        const initialStatus = JSON.parse(initial.stdout);
        assert.equal(initialStatus.operation, 'sync.status');
        assert.equal(initialStatus.data.remoteFreshness, 'unknown');
        assert.equal(initialStatus.data.pendingMessages, 0);
        assert.equal(initialStatus.context.freshness, 'unknown');
        const renamed = await f.cli([
          '--offline',
          'budgets',
          'rename',
          '--name',
          'Pending rename',
          '--operation-id',
          'pending-rename',
        ]);
        assert.equal(renamed.code, 0, renamed.stderr);
        const pending = await f.cli(['--offline', 'sync', 'status']);
        assert.equal(pending.code, 0, pending.stderr);
        const pendingStatus = JSON.parse(pending.stdout).data;
        assert.equal(pendingStatus.state, 'pending-sync');
        assert.ok(pendingStatus.pendingMessages > 0);
        assert.equal(pendingStatus.deferredMessages, 0);
        const repeated = await f.cli(['--offline', 'sync', 'status']);
        assert.equal(repeated.code, 0, repeated.stderr);
        assert.equal(
          JSON.parse(repeated.stdout).data.pendingMessages,
          pendingStatus.pendingMessages,
        );
        const unavailable = await f.cli(['sync', 'refresh']);
        assert.notEqual(unavailable.code, 0);
        const requiredFresh = await f.cli([
          '--require-fresh',
          'accounts',
          'list',
        ]);
        assert.notEqual(requiredFresh.code, 0);
        assert.ok(JSON.parse(requiredFresh.stdout).error);
        await f.start();
        const refreshed = await f.cli(['sync', 'refresh']);
        assert.equal(refreshed.code, 0, refreshed.stderr);
        const result = JSON.parse(refreshed.stdout);
        assert.equal(result.operation, 'sync.refresh');
        assert.equal(result.data.state, 'observed-synced');
        assert.equal(result.data.pendingMessages, 0);
        assert.equal(result.context.commit, 'synced');
        assert.equal(result.context.freshness, 'observed');
        assert.equal(result.data.budgetId, pendingStatus.budgetId);
        const independent = await f.cli(['budgets', 'inspect'], {
          client: 'independent',
        });
        assert.equal(independent.code, 0, independent.stderr);
        assert.equal(
          JSON.parse(independent.stdout).data.name,
          'Pending rename',
        );
        const newer = await f.cli(
          [
            'budgets',
            'rename',
            '--name',
            'Remote rename',
            '--operation-id',
            'remote-rename',
          ],
          { client: 'independent' },
        );
        assert.equal(newer.code, 0, newer.stderr);
        const freshRead = await f.cli([
          '--require-fresh',
          'budgets',
          'inspect',
        ]);
        assert.equal(freshRead.code, 0, freshRead.stderr);
        assert.equal(JSON.parse(freshRead.stdout).data.name, 'Remote rename');
      } finally {
        await f.dispose();
      }
    },
  );
}
