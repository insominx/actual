import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createFixture, isolatedEnv, repoRoot } from './harness.mjs';

for (const encrypted of [false, true]) {
  for (const phase of [
    'before-engine',
    'after-remote',
    'after-engine',
    'before-sync',
  ]) {
    test(
      `publication exact interruption retains one identity (${phase}, encrypted=${encrypted})`,
      { timeout: 120000 },
      async () => {
        const f = await createFixture();
        let child;
        let closed;
        let uploads = 0;
        let accepted = false;
        let releaseResponse;
        const released = new Promise(resolve => {
          releaseResponse = resolve;
        });
        const proxy = createServer(async (req, res) => {
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks);
            const headers = { ...req.headers };
            delete headers.host;
            if (req.url === '/sync/upload-user-file') uploads++;
            const upstream = await fetch(f.serverUrl + req.url, {
              method: req.method,
              headers,
              ...(req.method === 'GET' || req.method === 'HEAD'
                ? {}
                : { body }),
            });
            const response = Buffer.from(await upstream.arrayBuffer());
            if (req.url === '/sync/upload-user-file' && upstream.ok) {
              accepted = true;
              if (phase === 'after-remote') await released;
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
        const env = {
          ACTUAL_SERVER_URL: `http://127.0.0.1:${proxy.address().port}`,
          ACTUAL_ENCRYPTION_PASSWORD: encrypted
            ? 'publication-crash-secret'
            : '',
        };
        const options = { client: 'publication-crash', env, timeout: 60000 };
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
            'Crash publication',
            '--operation-id',
            'crash-source',
            '--currency',
            'CAD',
          ]);
          await invoke([
            '--offline',
            '--budget-id',
            source.id,
            'accounts',
            'create',
            '--operation-id',
            'fixture-account-publication-crash-test-1',
            '--name',
            'Preserved cash',
            '--balance',
            '45678',
          ]);
          const operationId = 'crash-publication';
          const prepared = await invoke([
            'changes',
            'preview',
            'budgets.publish',
            source.id,
            '--operation-id',
            operationId,
            '--data',
            JSON.stringify({ encrypted }),
          ]);
          const directory = join(f.root, options.client);
          const args = [
            ...(phase === 'after-remote'
              ? []
              : [
                  '--import',
                  pathToFileURL(
                    join(
                      repoRoot,
                      'packages/cli/integration/change-crash-boundary.mjs',
                    ),
                  ).href,
                ]),
            join(repoRoot, 'packages/cli/dist/cli.js'),
            '--output-version',
            '2',
            'changes',
            'apply',
            operationId,
            '--token',
            prepared.token,
          ];
          child = spawn(process.execPath, args, {
            cwd: f.root,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: isolatedEnv({
              ...env,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_DATA_DIR: directory,
              ACTUAL_TEST_CHANGE_PHASE: phase,
              ACTUAL_TEST_CHANGE_ID: operationId,
            }),
          });
          let stderr = '';
          child.stderr.on('data', data => {
            stderr += data;
          });
          closed = new Promise(resolve =>
            child.once('close', (code, signal) => resolve({ code, signal })),
          );
          const deadline = Date.now() + 15000;
          while (
            phase === 'after-remote'
              ? !accepted
              : !stderr.includes(`"crashCheckpoint":"${phase}"`)
          ) {
            assert.equal(child.exitCode, null, stderr);
            assert.ok(
              Date.now() < deadline,
              'Exact publication interruption was not observed: ' + stderr,
            );
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          const published = JSON.parse(
            await readFile(
              join(directory, '.actual-cli/changes', operationId + '.json'),
              'utf8',
            ),
          );
          assert.equal(
            published.state,
            phase === 'before-sync' ? 'committed-local' : 'uncertain',
          );
          assert.equal(uploads, phase === 'before-engine' ? 0 : 1);
          assert.equal(child.kill('SIGKILL'), true);
          const terminal = await closed;
          assert.ok(terminal.signal !== null || terminal.code !== 0);
          releaseResponse();
          const status = await invoke([
            '--lock-timeout',
            '45',
            'changes',
            'status',
            operationId,
          ]);
          assert.equal(status.state, published.state);
          if (phase === 'before-engine') {
            for (let attempt = 0; attempt < 2; attempt++) {
              const retry = await f.cli(
                [
                  '--lock-timeout',
                  '45',
                  'budgets',
                  'publish',
                  source.id,
                  '--operation-id',
                  operationId,
                ],
                options,
              );
              assert.equal(retry.code, 4, retry.stdout + retry.stderr);
            }
            assert.equal(
              (await invoke(['changes', 'status', operationId])).state,
              'uncertain',
            );
            assert.equal(uploads, 0);
            const metadata = JSON.parse(
              await readFile(
                join(directory, source.id, 'metadata.json'),
                'utf8',
              ),
            );
            assert.equal(metadata.cloudFileId, undefined);
            assert.equal(metadata.publication, undefined);
          } else {
            const retry = await invoke([
              '--lock-timeout',
              '45',
              'budgets',
              'publish',
              source.id,
              '--operation-id',
              operationId,
            ]);
            assert.equal(retry.receipt.state, 'synced');
            assert.equal(
              retry.receipt.outcome.publication.encrypted,
              encrypted,
            );
            const again = await invoke([
              'budgets',
              'publish',
              source.id,
              '--operation-id',
              operationId,
            ]);
            assert.deepEqual(again.receipt, retry.receipt);
            assert.equal(
              uploads,
              1,
              'Interrupted publication recovery must never initial-upload again',
            );
            const observed = await f.cli(
              ['--sync-id', retry.syncId, 'accounts', 'list'],
              { client: 'publication-independent', env },
            );
            assert.equal(observed.code, 0, observed.stdout + observed.stderr);
            const account = JSON.parse(observed.stdout).data.find(
              row => row.name === 'Preserved cash',
            );
            assert.ok(account);
            const balance = await f.cli(
              ['--sync-id', retry.syncId, 'accounts', 'balance', account.id],
              { client: 'publication-independent', env },
            );
            assert.equal(balance.code, 0, balance.stdout + balance.stderr);
            assert.equal(JSON.parse(balance.stdout).data.balance, 45678);
          }
        } finally {
          releaseResponse();
          if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            await closed;
          }
          proxy.closeAllConnections();
          await new Promise(resolve => proxy.close(resolve));
          await f.dispose();
        }
      },
    );
  }
}
