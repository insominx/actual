import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createFixture, isolatedEnv, repoRoot } from './harness.mjs';

// Shared packaged proof for guarded domain adapters. Every case uses a real
// disposable sync server, the packaged CLI and raw SQLite reads of the owned
// disposable cache. Specs describe the operation and its exact raw effect.

export async function readRaw(f) {
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
        sortRows(
          database
            .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
            .all(),
        ),
      ]),
    );
  } finally {
    database.close();
  }
}

export function sortRows(rows) {
  return rows.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

// Rows present in `after` but absent from `before` for one table.
export function createdRows(before, after, table) {
  const ids = new Set(before[table].map(row => row.id));
  return after[table].filter(row => !ids.has(row.id));
}

// Assert that `after` equals `before` with only `mutate` applied.
export function assertRawEffect(before, after, mutate) {
  const expected = structuredClone(before);
  mutate(expected);
  for (const rows of Object.values(expected)) sortRows(rows);
  assert.deepEqual(after, expected);
}

function strictCli(f) {
  return async (args, options) => {
    const result = await f.cli(args, options);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).data;
  };
}

function previewArgs(mode, spec, operationId, target, data) {
  return [
    ...mode,
    'changes',
    'preview',
    spec.operation,
    ...(target ? [target] : []),
    '--operation-id',
    operationId,
    '--data',
    JSON.stringify(data),
  ];
}

/**
 * spec: {
 *   operation, label,
 *   setup?(f, cli) -> ctx,
 *   target?(f, ctx) -> id,
 *   data(f, ctx) -> payload, otherData(f, ctx) -> colliding payload,
 *   verify(before, after, { proposal, outcome, applied, f, ctx }),
 *   direct?(f, ctx) -> { args, verify?(before, after, data) },
 *   laterEdit?(f, ctx, cli, outcome) -> legacy CLI args changing the result,
 *   independent?(f, ctx, outcome) -> { args, check(rows) },
 * }
 */
export function guardedRegularCases(spec) {
  for (const offline of [false, true]) {
    void test(
      `guarded ${spec.label} preserves raw domains and acknowledgements (${offline ? 'offline' : 'online'})`,
      { timeout: 180000 },
      async () => {
        const f = await createFixture({ encrypted: true, richBackup: true });
        try {
          const cli = strictCli(f);
          await cli(['accounts', 'list']);
          const ctx = (await spec.setup?.(f, cli)) ?? {};
          const mode = offline ? ['--offline'] : [];
          const target = spec.target?.(f, ctx);
          const before = await readRaw(f);
          const operationId = spec.label.replaceAll(/[^a-z0-9]+/gi, '-') + '-p';
          const prepared = await cli(
            previewArgs(mode, spec, operationId, target, spec.data(f, ctx)),
          );
          assert.equal(prepared.state, 'prepared');
          assert.deepEqual(await readRaw(f), before, 'preview wrote state');
          const apply = [
            ...mode,
            'changes',
            'apply',
            operationId,
            '--token',
            prepared.token,
          ];
          const applied = await cli(apply);
          assert.equal(applied.state, offline ? 'committed-local' : 'synced');
          assert.equal(applied.outcome.status, 'committed-local');
          const after = await readRaw(f);
          await spec.verify(before, after, {
            proposal: prepared.proposal,
            outcome: applied.outcome,
            applied: true,
            f,
            ctx,
          });
          // Acknowledged retry returns the stored outcome without writing.
          assert.deepEqual((await cli(apply)).outcome, applied.outcome);
          assert.deepEqual(await readRaw(f), after);
          // The same ID cannot name a different request.
          const collision = await f.cli(
            previewArgs(
              mode,
              spec,
              operationId,
              target,
              spec.otherData(f, ctx),
            ),
          );
          assert.equal(collision.code, 2, collision.stdout + collision.stderr);
          assert.deepEqual(await readRaw(f), after);
          let current = after;
          if (spec.direct) {
            const direct = spec.direct(f, ctx, applied.outcome);
            const args = [
              ...mode,
              ...direct.args,
              '--operation-id',
              operationId + '-direct',
            ];
            const result = await cli(args);
            assert.ok(result.receipt, 'direct version 2 returns a receipt');
            assert.equal(result.receipt.outcome.status, 'committed-local');
            const afterDirect = await readRaw(f);
            await direct.verify?.(current, afterDirect, result);
            assert.deepEqual(
              (await cli(args)).receipt.outcome,
              result.receipt.outcome,
            );
            assert.deepEqual(await readRaw(f), afterDirect);
            current = afterDirect;
          }
          if (spec.laterEdit) {
            const edit = await f.cli(
              [...mode, ...spec.laterEdit(f, ctx, applied.outcome)],
              { version: '1' },
            );
            assert.equal(edit.code, 0, edit.stdout + edit.stderr);
            const later = await readRaw(f);
            assert.notDeepEqual(later, current, 'later edit changed state');
            // Retrying the acknowledged ID never overwrites the later edit.
            assert.deepEqual((await cli(apply)).outcome, applied.outcome);
            assert.deepEqual(await readRaw(f), later);
          }
          if (offline) await cli(['sync']);
          if (spec.independent) {
            const check = spec.independent(f, ctx, applied.outcome);
            const rows = await cli(['--require-fresh', ...check.args], {
              client: 'independent',
            });
            check.check(rows);
          }
        } finally {
          await f.dispose();
        }
      },
    );
  }
}

export function guardedInterruptionCases(spec) {
  for (const phase of ['before-engine', 'after-engine', 'before-sync']) {
    void test(
      `killed guarded ${spec.label} at ${phase} retains its exact outcome without replay`,
      { timeout: 180000 },
      async () => {
        const f = await createFixture({ encrypted: true, richBackup: true });
        let child;
        let closed;
        try {
          const cli = strictCli(f);
          await cli(['accounts', 'list']);
          const ctx = (await spec.setup?.(f, cli)) ?? {};
          const target = spec.target?.(f, ctx);
          const before = await readRaw(f);
          const id = spec.label.replaceAll(/[^a-z0-9]+/gi, '-') + '-' + phase;
          const prepared = await cli(
            previewArgs(['--offline'], spec, id, target, spec.data(f, ctx)),
          );
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
          const deadline = Date.now() + 20000;
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
          const after = await readRaw(f);
          if (phase === 'before-engine') {
            assert.deepEqual(after, before, 'no engine write before intent');
          } else {
            await spec.verify(before, after, {
              proposal: prepared.proposal,
              outcome: published.outcome,
              applied: true,
              f,
              ctx,
            });
          }
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
          // Uncertain receipts never replay; acknowledged ones only report.
          assert.equal(
            attempt.code,
            phase === 'before-sync' ? 0 : 6,
            attempt.stdout + attempt.stderr,
          );
          assert.deepEqual(await readRaw(f), after);
          assert.equal(
            (await cli(['--offline', 'sync', 'status'])).pendingMessages,
            pending,
          );
          if (phase === 'before-sync') {
            const synced = await cli([
              'changes',
              'apply',
              id,
              '--token',
              prepared.token,
            ]);
            assert.equal(synced.state, 'synced');
            assert.deepEqual(synced.outcome, published.outcome);
            assert.deepEqual(await readRaw(f), after);
            if (spec.independent) {
              const check = spec.independent(f, ctx, published.outcome);
              check.check(
                await cli(['--require-fresh', ...check.args], {
                  client: 'independent',
                }),
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
}
