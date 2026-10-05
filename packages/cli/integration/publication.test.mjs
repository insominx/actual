import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture, repoRoot, runNode } from './harness.mjs';

test(
  'publication rejects credential-bearing server URLs before authentication or receipt preparation',
  { timeout: 90000 },
  async () => {
    const f = await createFixture();
    let requests = 0;
    const proxy = createServer((req, res) => {
      requests++;
      res.writeHead(400);
      res.end('Unexpected authentication request');
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const client = 'publication-unsafe-url';
    try {
      const created = await f.cli(
        [
          '--offline',
          'budgets',
          'create',
          '--name',
          'Unsafe URL source',
          '--operation-id',
          'unsafe-source',
        ],
        { client },
      );
      assert.equal(created.code, 0, created.stdout + created.stderr);
      const id = JSON.parse(created.stdout).data.id;
      const metadataPath = join(f.root, client, id, 'metadata.json');
      const metadata = await readFile(metadataPath);
      for (const kind of ['userinfo', 'query', 'fragment']) {
        const url = new URL(`http://127.0.0.1:${proxy.address().port}`);
        if (kind === 'userinfo') {
          url.username = 'private-publication-user';
          url.password = 'private-publication-password';
        } else if (kind === 'query') {
          url.search = '?token=private-publication-password';
        } else {
          url.hash = 'private-publication-password';
        }
        const rejected = await f.cli(
          ['budgets', 'publish', id, '--operation-id', `unsafe-${kind}`],
          { client, env: { ACTUAL_SERVER_URL: url.href } },
        );
        assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
        assert.equal(rejected.stdout.includes('private-publication'), false);
        assert.equal(
          requests,
          0,
          'Unsafe server URLs must reject before authentication',
        );
        assert.deepEqual(await readFile(metadataPath), metadata);
        const status = await f.cli(
          ['--offline', 'changes', 'status', `unsafe-${kind}`],
          { client },
        );
        assert.equal(status.code, 3);
      }
    } finally {
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      await f.dispose();
    }
  },
);

for (const encrypted of [false, true]) {
  test(
    `CLI keeps publication uncertain when the upload was not accepted (encrypted=${encrypted})`,
    { timeout: 90000 },
    async () => {
      const f = await createFixture();
      let uploads = 0;
      const proxy = createServer(async (req, res) => {
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          if (req.url === '/sync/upload-user-file') {
            uploads++;
            if (uploads === 1) {
              res.destroy();
              return;
            }
          }
          const headers = { ...req.headers };
          delete headers.host;
          const upstream = await fetch(f.serverUrl + req.url, {
            method: req.method,
            headers,
            ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body }),
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
        ACTUAL_ENCRYPTION_PASSWORD: encrypted
          ? 'absence-publication-secret'
          : '',
      };
      const options = { client: 'publication-absence', env };
      const invoke = async args => {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      };
      try {
        const source = await invoke([
          '--offline',
          'budgets',
          'create',
          '--name',
          'Absent remote publication',
          '--operation-id',
          'absence-source',
        ]);
        await invoke([
          '--offline',
          '--budget-id',
          source.id,
          'accounts',
          'create',
          '--operation-id',
          'fixture-account-publication-test-1',
          '--name',
          'Preserved cash',
          '--balance',
          '45678',
        ]);
        const publish = [
          'budgets',
          'publish',
          source.id,
          '--operation-id',
          'absence-publication',
        ];
        const initial = await f.cli(publish, options);
        assert.equal(initial.code, 6, initial.stdout + initial.stderr);
        const before = await invoke([
          'changes',
          'status',
          'absence-publication',
        ]);
        assert.equal(before.state, 'uncertain');
        const metadata = JSON.parse(
          await readFile(
            join(f.root, options.client, source.id, 'metadata.json'),
            'utf8',
          ),
        );
        assert.ok(metadata.cloudFileId);
        assert.equal(metadata.publication.status, 'prepared');
        for (let attempt = 0; attempt < 2; attempt++) {
          const retry = await f.cli(publish, options);
          assert.equal(retry.code, 6, retry.stdout + retry.stderr);
          assert.deepEqual(
            await invoke(['changes', 'status', 'absence-publication']),
            before,
          );
        }
        assert.equal(
          uploads,
          1,
          'Remote absence must never cause a second initial upload',
        );
        const inventory = await invoke(['budgets', 'list']);
        assert.equal(
          inventory.some(
            row =>
              row.state === 'remote' &&
              row.cloudFileId === metadata.cloudFileId,
          ),
          false,
        );
        const accounts = await invoke([
          '--offline',
          '--budget-id',
          source.id,
          'accounts',
          'list',
        ]);
        assert.equal(
          accounts.find(row => row.name === 'Preserved cash').balance,
          45678,
        );
      } finally {
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
        await f.dispose();
      }
    },
  );
  test(
    `CLI publication receipts acknowledge and reuse one identity (encrypted=${encrypted})`,
    { timeout: 90000 },
    async () => {
      const f = await createFixture();
      try {
        const env = {
          ACTUAL_ENCRYPTION_PASSWORD: encrypted
            ? 'receipt-publication-secret'
            : '',
        };
        const invoke = async args => {
          const result = await f.cli(args, { client: 'publication-cli', env });
          assert.equal(result.code, 0, result.stdout + result.stderr);
          return JSON.parse(result.stdout).data;
        };
        const source = await invoke([
          '--offline',
          'budgets',
          'create',
          '--name',
          'CLI receipt publication',
          '--operation-id',
          'publication-source',
        ]);
        const before = await readFile(
          join(f.root, 'publication-cli', source.id, 'metadata.json'),
        );
        const prepared = await invoke([
          'changes',
          'preview',
          'budgets.publish',
          source.id,
          '--operation-id',
          'publication-receipt',
          '--data',
          JSON.stringify({ encrypted }),
        ]);
        assert.equal(prepared.state, 'prepared');
        assert.deepEqual(
          await readFile(
            join(f.root, 'publication-cli', source.id, 'metadata.json'),
          ),
          before,
        );
        const applied = await invoke([
          'changes',
          'apply',
          'publication-receipt',
          '--token',
          prepared.token,
        ]);
        assert.equal(applied.state, 'synced');
        assert.ok(applied.outcome.publication.syncId);
        assert.equal(applied.outcome.publication.encrypted, encrypted);
        const retried = await invoke([
          'budgets',
          'publish',
          source.id,
          '--operation-id',
          'publication-receipt',
        ]);
        assert.deepEqual(retried.receipt, applied);
        assert.equal(retried.syncId, applied.outcome.publication.syncId);
        const status = await invoke([
          'changes',
          'status',
          'publication-receipt',
        ]);
        assert.deepEqual(status, applied);
        assert.equal(
          JSON.stringify(status).includes('receipt-publication-secret'),
          false,
        );
        const downloaded = await f.cli(
          ['--sync-id', retried.syncId, 'budgets', 'inspect'],
          { client: 'publication-reader', env },
        );
        assert.equal(downloaded.code, 0, downloaded.stdout + downloaded.stderr);
        assert.equal(
          JSON.parse(downloaded.stdout).data.name,
          'CLI receipt publication',
        );
        const collision = await f.cli(
          [
            'changes',
            'preview',
            'budgets.publish',
            source.id,
            '--operation-id',
            'publication-receipt',
            '--data',
            JSON.stringify({ encrypted: !encrypted }),
          ],
          { client: 'publication-cli', env },
        );
        assert.equal(collision.code, 2);
      } finally {
        await f.dispose();
      }
    },
  );
  for (const uploadFault of [null, 'before', 'after', 'source-race']) {
    test(
      `guarded publication API preserves preview and recovers only proven remote identity (encrypted=${encrypted}, uploadFault=${uploadFault})`,
      { timeout: 90000 },
      async () => {
        const f = await createFixture();
        let uploadCount = 0;
        let raceArmed = false;
        let signalBlocked;
        const blocked = new Promise(resolve => {
          signalBlocked = resolve;
        });
        let releaseSnapshot;
        const released = new Promise(resolve => {
          releaseSnapshot = resolve;
        });
        const proxy = createServer(async (req, res) => {
          try {
            if (req.url === '/__arm') {
              raceArmed = true;
              res.end('armed');
              return;
            }
            if (req.url === '/__blocked') {
              await blocked;
              res.end('blocked');
              return;
            }
            if (req.url === '/__release') {
              releaseSnapshot();
              res.end('released');
              return;
            }
            if (raceArmed && req.url === '/sync/list-user-files') {
              raceArmed = false;
              signalBlocked();
              await released;
            }
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks);
            const upload = req.url === '/sync/upload-user-file';
            if (upload) uploadCount++;
            if (upload && uploadCount === 1 && uploadFault === 'before') {
              res.destroy();
              return;
            }
            const headers = { ...req.headers };
            delete headers.host;
            const upstream = await fetch(f.serverUrl + req.url, {
              method: req.method,
              headers,
              ...(req.method === 'GET' || req.method === 'HEAD'
                ? {}
                : { body }),
            });
            const response = Buffer.from(await upstream.arrayBuffer());
            if (
              upload &&
              uploadCount === 1 &&
              uploadFault === 'after' &&
              upstream.ok
            ) {
              res.destroy();
              return;
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
        try {
          const proof = await runNode(
            [join(repoRoot, 'packages/cli/integration/publication-api.mjs')],
            {
              cwd: f.root,
              timeout: 60000,
              input: JSON.stringify({
                dataDir: join(f.root, 'guarded-publication'),
                serverUrl: `http://127.0.0.1:${proxy.address().port}`,
                uploadFault,
                password: 'disposable-cli-test-password',
                ...(encrypted
                  ? { encryptionPassword: 'guarded-publication-secret' }
                  : {}),
              }),
            },
          );
          assert.equal(proof.code, 0, proof.stdout + proof.stderr);
          const result = JSON.parse(
            proof.stdout
              .split('\n')
              .find(line => line.startsWith('{"verified":')),
          );
          assert.equal(result.verified, true);
          assert.equal(result.encrypted, encrypted);
          assert.equal(
            uploadCount,
            uploadFault === 'source-race' ? 0 : 1,
            'Recovery must never submit another initial upload',
          );
        } finally {
          releaseSnapshot();
          proxy.closeAllConnections();
          await new Promise(resolve => proxy.close(resolve));
          await f.dispose();
        }
      },
    );
  }
}
