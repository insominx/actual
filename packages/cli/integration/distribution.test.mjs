import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFixture, runNode } from './harness.mjs';

// Packaged proof for 0034: the bash first-run tutorial runs against a
// disposable server with spaces in every path and JSON through arguments,
// files and stdin; upgrade check reports device-local schema versions and
// actionable incompatibilities without writing; and (with
// ACTUAL_TEST_PACKED=1, which needs registry access for third-party
// dependencies) packed CLI and API tarballs install into a clean directory
// and run schema, setup, import and backup.

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '../../..');
const cliEntry = join(here, '../dist/cli.js');

async function digest(dir) {
  const hash = createHash('sha256');
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) hash.update(child).update(await readFile(child));
    }
  }
  await walk(dir);
  return hash.digest('hex');
}

async function ok(f, args, options) {
  const result = await f.cli(args, options);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout).data;
}

async function runTutorial(f, cliJs, work) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      [join(here, '../examples/first-run.sh'), work],
      {
        cwd: f.root,
        env: {
          PATH: process.env.PATH,
          HOME: f.root,
          ACTUAL_SERVER_URL: f.serverUrl,
          ACTUAL_PASSWORD: 'disposable-cli-test-password',
          ACTUAL_DATA_DIR: join(f.root, 'a'),
          ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
          ACTUAL_CLI_JS: cliJs,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function checkTutorialBudget(f, budget, work) {
  const local = ['--offline', '--budget-id', budget];
  const accounts = await ok(f, [...local, 'accounts', 'list']);
  const checking = accounts.find(a => a.name === 'Checking');
  const rows = await ok(f, [
    ...local,
    'transactions',
    'list',
    '--account',
    checking.id,
    '--start',
    '2026-09-01',
    '--end',
    '2026-09-30',
  ]);
  const payees = await ok(f, [...local, 'payees', 'list']);
  const names = rows.map(r => payees.find(p => p.id === r.payee)?.name);
  assert.ok(names.includes('Smith, Jones & Co'), JSON.stringify(names));
  assert.ok(names.includes('O\'Brien "Books"'), JSON.stringify(names));
  assert.deepEqual(
    rows.map(r => r.amount).sort((a, b) => a - b),
    [-2345, -1999, -1000],
  );
  assert.equal((await readdir(join(work, 'backups'))).length, 1);
}

test(
  'bash first-run tutorial with spaces and JSON via arguments, files and stdin (A2)',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ fresh: true });
    try {
      await ok(f, ['server', 'bootstrap']);
      const work = join(f.root, 'tutorial dir', 'with spaces');
      const result = await runTutorial(f, cliEntry, work);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      await checkTutorialBudget(f, result.stdout.trim(), work);
    } finally {
      await f.dispose();
    }
  },
);

test(
  'upgrade check reports versions and incompatibilities without writing (A3)',
  { timeout: 240000 },
  async () => {
    const f = await createFixture();
    try {
      await ok(f, ['workflow', 'weekly-checkup', '--as-of', '2026-09-15']);
      const clean = await ok(f, ['upgrade', 'check', '--server']);
      assert.equal(clean.compatible, true, JSON.stringify(clean));
      const runs = clean.stores.find(s => s.store === 'workflowRuns');
      assert.deepEqual(
        [runs.status, runs.records, runs.versions],
        ['compatible', 1, { 1: 1 }],
      );
      assert.equal(clean.stores.find(s => s.store === 'jobs').status, 'absent');
      assert.equal(typeof clean.server.version, 'string');
      assert.equal(typeof clean.server.sameReleaseLine, 'boolean');
      assert.ok(clean.cli.supportedSchemaVersions.receipts.includes(1));

      // Records from a newer CLI are reported, not rewritten.
      const dataDir = join(f.root, 'a');
      await mkdir(join(dataDir, '.actual-cli', 'changes'), { recursive: true });
      await writeFile(
        join(dataDir, '.actual-cli', 'changes', 'future-op.json'),
        JSON.stringify({ schemaVersion: 2, operationId: 'future-op' }),
      );
      await writeFile(
        join(dataDir, 'workflow-runs', 'wf-future.json'),
        JSON.stringify({ schemaVersion: 2, runId: 'wf-future' }),
      );
      const before = await digest(dataDir);
      const report = await ok(f, ['--offline', 'upgrade', 'check']);
      assert.equal(report.compatible, false);
      const receipts = report.stores.find(s => s.store === 'receipts');
      assert.equal(receipts.status, 'incompatible');
      assert.equal(receipts.unsupported[0].schemaVersion, 2);
      assert.ok(
        report.actions.some(
          a => /does not read/.test(a) && /nothing was changed/.test(a),
        ),
      );
      assert.equal(await digest(dataDir), before);
      const inspect = await f.cli(['workflow', 'run', 'inspect', 'wf-future']);
      assert.equal(inspect.code, 2);
      assert.equal(await digest(dataDir), before);
    } finally {
      await f.dispose();
    }
  },
);

test(
  'packed CLI and API install into a clean directory and run first-run workflows (A1)',
  { timeout: 900000, skip: process.env.ACTUAL_TEST_PACKED !== '1' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'actual packed '));
    const f = await createFixture({ fresh: true });
    try {
      const yarn = async (args, cwd = repoRoot) => {
        const { spawn } = await import('node:child_process');
        return new Promise(resolve => {
          const child = spawn('yarn', args, {
            cwd,
            env: process.env,
            stdio: 'pipe',
          });
          let out = '';
          child.stdout.on('data', d => (out += d));
          child.stderr.on('data', d => (out += d));
          child.on('close', code => resolve({ code, out }));
        });
      };
      const npm = async (args, cwd) => {
        const { spawn } = await import('node:child_process');
        return new Promise(resolve => {
          const child = spawn('npm', args, {
            cwd,
            env: process.env,
            stdio: 'pipe',
          });
          let out = '';
          child.stdout.on('data', d => (out += d));
          child.stderr.on('data', d => (out += d));
          child.on('close', code => resolve({ code, out }));
        });
      };
      for (const [workspace, file] of [
        ['@actual-app/api', 'api.tgz'],
        ['@actual-app/cli', 'cli.tgz'],
      ]) {
        const packed = await yarn([
          'workspace',
          workspace,
          'pack',
          '--out',
          join(root, file),
        ]);
        assert.equal(packed.code, 0, packed.out);
      }
      const install = join(root, 'clean install');
      await mkdir(install);
      await writeFile(
        join(install, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: {
            '@actual-app/api': `file:${join(root, 'api.tgz')}`,
            '@actual-app/cli': `file:${join(root, 'cli.tgz')}`,
          },
          overrides: { '@actual-app/api': `file:${join(root, 'api.tgz')}` },
        }),
      );
      const installed = await npm(
        ['install', '--no-audit', '--no-fund'],
        install,
      );
      assert.equal(installed.code, 0, installed.out);
      const packedCli = join(
        install,
        'node_modules/@actual-app/cli/dist/cli.js',
      );
      const run = args =>
        runNode([packedCli, '--output-version', '2', ...args], {
          cwd: install,
          env: {
            ACTUAL_SERVER_URL: f.serverUrl,
            ACTUAL_PASSWORD: 'disposable-cli-test-password',
            ACTUAL_DATA_DIR: join(root, 'packed data'),
          },
        });
      const capabilities = await run(['capabilities']);
      assert.equal(capabilities.code, 0, capabilities.stderr);
      assert.ok(JSON.parse(capabilities.stdout).data.operations.length > 150);
      const schema = await run(['schema', 'imports.preview']);
      assert.equal(JSON.parse(schema.stdout).data.name, 'imports.preview');
      const bootstrap = await run(['server', 'bootstrap']);
      assert.equal(bootstrap.code, 0, bootstrap.stdout + bootstrap.stderr);
      const context = await run(['context']);
      assert.ok([0, 3].includes(context.code), context.stdout);
      const work = join(root, 'tutorial work');
      const tutorial = await runTutorial({ ...f, root }, packedCli, work);
      assert.equal(tutorial.code, 0, tutorial.stdout + tutorial.stderr);
    } finally {
      await f.dispose();
      if (root.includes('actual packed ')) {
        await rm(root, { recursive: true, force: true });
      }
    }
  },
);
