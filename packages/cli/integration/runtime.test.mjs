import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createFixture, repoRoot, runNode, unusedPort } from './harness.mjs';

test(
  'fresh server bootstraps through CLI and authenticates without a browser',
  { timeout: 60000 },
  async () => {
    const f = await createFixture({ fresh: true });
    try {
      const result = await f.cli(['server', 'bootstrap']);
      assert.equal(result.code, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.data.bootstrapped, true);
      assert.ok(!result.stdout.includes('disposable-cli-test-password'));
      assert.ok(!('token' in output.data));
      const repeated = await f.cli(['server', 'bootstrap']);
      assert.equal(repeated.code, 2);
      assert.equal(
        JSON.parse(repeated.stdout).error.details.reason,
        'already-bootstrapped',
      );
      const connected = await f.cli(['connection', 'test']);
      assert.equal(connected.code, 0, connected.stderr);
      assert.equal(JSON.parse(connected.stdout).data.authenticated, true);
      const diagnosis = await f.cli(['doctor'], {
        env: { ACTUAL_PASSWORD: 'incorrect-secret' },
      });

      assert.equal(diagnosis.code, 5);
      assert.equal(
        JSON.parse(diagnosis.stdout).error.details.issue,
        'authentication-failed',
      );
      assert.ok(!diagnosis.stdout.includes('incorrect-secret'));
    } finally {
      await f.dispose();
    }
  },
);

test(
  'managed lifecycle checks ownership, port, executable, restart, and shutdown',
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'actual-managed-runtime-'));
    const dir = join(root, 'server with spaces');
    const port = await unusedPort();
    const url = `http://127.0.0.1:${port}`;
    const entry = join(root, 'server-entry.mjs');
    const entryText = `import ${JSON.stringify(pathToFileURL(join(repoRoot, 'packages/sync-server/build/bin/actual-server.js')).href)};\n`;
    await writeFile(entry, entryText);
    const cli = args =>
      runNode([join(repoRoot, 'packages/cli/dist/cli.js'), ...args], {
        cwd: root,
      });
    const managed = (verb, ...args) =>
      cli(['server', verb, '--server-dir', dir, ...args]);
    let originalState;
    try {
      let result = await managed(
        'init',
        '--port',
        String(port),
        '--server-entry',
        entry,
      );
      assert.equal(result.code, 0, result.stderr);
      const occupied = createServer();
      await new Promise(resolveReady =>
        occupied.listen(port, '127.0.0.1', resolveReady),
      );
      try {
        result = await managed('start');
        assert.equal(result.code, 5);
        assert.equal(
          JSON.parse(result.stdout).error.details.issue,
          'port-unavailable',
        );
        assert.equal(occupied.listening, true);
      } finally {
        await new Promise(resolveClosed => occupied.close(resolveClosed));
      }
      result = await managed('start');
      assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).data.healthy, true);
      const passwordFile = join(root, 'password');
      await writeFile(passwordFile, 'runtime-disposable-password');
      result = await runNode(
        [
          join(repoRoot, 'packages/cli/dist/cli.js'),
          '--server-url',
          url,
          'server',
          'bootstrap',
        ],
        {
          cwd: root,
          env: {
            ACTUAL_PASSWORD_FILE: passwordFile,
            ACTUAL_PROFILES_FILE: join(root, 'profiles.json'),
          },
        },
      );
      assert.equal(result.code, 0, result.stderr);
      const statePath = join(dir, '.actual-runtime/state.json');
      const stateText = await readFile(statePath, 'utf8');
      originalState = stateText;
      const state = JSON.parse(stateText);
      assert.equal(
        (await (await fetch(`${url}/health`)).json()).instanceId,
        state.owner,
      );
      await writeFile(
        statePath,
        JSON.stringify({
          ...state,
          pid: process.pid,
          token: 'wrong-ownership-token',
        }),
      );
      result = await managed('stop');
      assert.equal(result.code, 5);
      assert.equal(
        JSON.parse(result.stdout).error.details.issue,
        'ownership-unconfirmed',
      );
      assert.equal((await fetch(`${url}/health`)).ok, true);
      await writeFile(statePath, stateText);
      await writeFile(entry, entryText + '// changed after launch\n');
      result = await managed('stop');
      assert.equal(result.code, 5);
      assert.equal(
        JSON.parse(result.stdout).error.details.issue,
        'executable-changed',
      );
      assert.equal((await fetch(`${url}/health`)).ok, true);
      await writeFile(entry, entryText);
      result = await managed('logs');
      assert.equal(result.code, 0, result.stderr);
      assert.ok(
        JSON.parse(result.stdout).data.events.some(e => e.event === 'healthy'),
      );
      assert.ok(!result.stdout.includes(state.token));
      result = await managed('stop');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        JSON.parse((await managed('status')).stdout).data.running,
        false,
      );
      result = await managed('start');
      assert.equal(result.code, 0, result.stderr);
      result = await managed('stop');
      assert.equal(result.code, 0, result.stderr);
      const unavailableDir = join(root, 'unhealthy');
      await mkdir(unavailableDir);
      const badEntry = join(root, 'bad-entry.mjs');
      await writeFile(badEntry, 'process.exit(1);\n');
      result = await cli([
        'server',
        'init',
        '--server-dir',
        unavailableDir,
        '--port',
        String(port),
        '--server-entry',
        badEntry,
      ]);
      assert.equal(result.code, 0, result.stderr);
      result = await cli(['server', 'start', '--server-dir', unavailableDir]);
      assert.equal(result.code, 5);
      assert.equal(
        JSON.parse(result.stdout).error.details.issue,
        'startup-failed',
      );
    } finally {
      await writeFile(entry, entryText);
      if (originalState) {
        const statePath = join(dir, '.actual-runtime/state.json');
        const current = await readFile(statePath, 'utf8')
          .then(JSON.parse)
          .catch(() => null);
        const saved = JSON.parse(originalState);
        if (current?.owner === saved.owner && current.token !== saved.token) {
          await writeFile(statePath, originalState);
        }
      }
      const stopped = await managed('stop');
      assert.ok(
        stopped.code === 0 || stopped.code === 3,
        'Fixture cleanup must confirm shutdown before deleting server files',
      );
      assert.ok(root.startsWith(join(tmpdir(), 'actual-managed-runtime-')));
      await rm(root, { recursive: true, force: true });
    }
  },
);
