import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFixture } from './harness.mjs';

// Packaged proof for 0030 with a disposable fake SimpleFIN provider (no real
// credentials): status without secrets, a structured prerequisite before any
// connection exists, per-account refresh outcomes for duplicates, one-account
// refresh, partial failure, rate limiting and expired credentials, and
// device-local run results.

const here = fileURLToPath(new URL('.', import.meta.url));

function strict(f) {
  return async args => {
    const result = await f.cli(args);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).data;
  };
}

function fakeProvider() {
  const now = Math.floor(Date.now() / 1000);
  const state = {
    mode: 'ok',
    omit: new Set(),
    requests: [],
    transactions: {
      'sf-1': [
        {
          id: 't1',
          posted: now - 2 * 86400,
          amount: '-12.34',
          description: 'Coffee',
          payee: 'Cafe',
        },
      ],
      'sf-2': [
        {
          id: 't2',
          posted: now - 3 * 86400,
          amount: '100.00',
          description: 'Deposit',
          payee: 'Employer',
        },
      ],
    },
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    state.requests.push(url.searchParams.getAll('account'));
    if (state.mode === 'forbidden') {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (state.mode === 'rate') {
      res.writeHead(429).end('Too Many Requests');
      return;
    }
    const wanted = url.searchParams.getAll('account');
    const accounts = Object.entries(state.transactions)
      .filter(([id]) => !state.omit.has(id))
      .filter(([id]) => !wanted.length || wanted.includes(id))
      .map(([id, transactions]) => ({
        org: { name: 'Fake Bank', domain: 'fake.example' },
        id,
        name: id === 'sf-1' ? 'Fake checking' : 'Fake savings',
        currency: 'USD',
        balance: '0.00',
        'balance-date': now,
        transactions,
      }));
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ errors: [], accounts }));
  });
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ state, server, port: server.address().port }),
    ),
  );
}

async function setSecrets(f, port) {
  const login = await fetch(`${f.serverUrl}/account/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'disposable-cli-test-password' }),
  }).then(r => r.json());
  const token = login.data.token;
  for (const [name, value] of [
    ['simplefin_token', 'fake-setup-token'],
    ['simplefin_accessKey', `http://user:pass@127.0.0.1:${port}/simplefin`],
  ]) {
    const res = await fetch(`${f.serverUrl}/secret`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actual-token': token,
      },
      body: JSON.stringify({ name, value }),
    });
    assert.equal(res.status, 200, await res.text());
  }
}

// Async spawn: the fake provider runs in this process and must keep serving.
function link(f, accounts) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, 'bank-link.mjs')], {
      cwd: f.root,
      env: {
        PATH: process.env.PATH,
        HOME: f.root,
        ACTUAL_DATA_DIR: join(f.root, 'linker'),
        ACTUAL_SERVER_URL: f.serverUrl,
        ACTUAL_PASSWORD: 'disposable-cli-test-password',
        ACTUAL_SYNC_ID: f.fixture.syncId,
        BANK_LINKS: JSON.stringify(accounts),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`link failed (${code}): ${stderr}${stdout}`));
        return;
      }
      const line = stdout.split('\n').find(l => l.startsWith('LINKED:'));
      try {
        resolve(JSON.parse(line.slice('LINKED:'.length)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

void test('prerequisites before linking, then per-account outcomes for duplicates, one account, partial failure, rate limits and expired credentials', async () => {
  const f = await createFixture();
  const fake = await fakeProvider();
  try {
    const cli = strict(f);
    const accountsBefore = (await cli(['accounts', 'list'])).length;
    const status = await cli(['bank-sync', 'status']);
    assert.equal(status.linkedCount, 0);
    assert.match(status.prerequisite, /consent/);
    assert.equal(status.providers.simpleFin.configured, false);
    assert.ok(!JSON.stringify(status).includes('pass@'), 'no secrets');
    const none = await cli(['bank-sync', 'refresh']);
    assert.equal(none.result.attempted, 0);
    assert.match(none.result.prerequisite, /consent/);
    const unlinked = await cli([
      'bank-sync',
      'refresh',
      '--accounts',
      f.fixture.checking,
    ]);
    assert.equal(unlinked.result.outcomes[0].status, 'not-linked');
    assert.equal(fake.state.requests.length, 0, 'provider contacted');
    assert.equal((await cli(['accounts', 'list'])).length, accountsBefore);

    await setSecrets(f, fake.port);
    const configured = await cli(['bank-sync', 'status']);
    assert.equal(configured.providers.simpleFin.configured, true);
    assert.ok(!JSON.stringify(configured).includes('pass@'), 'no secrets');

    const linked = await link(f, [
      {
        account_id: 'sf-1',
        name: 'Fake checking',
        institution: 'Fake Bank',
        orgDomain: 'fake.example',
        balance: 0,
      },
      {
        account_id: 'sf-2',
        name: 'Fake savings',
        institution: 'Fake Bank',
        orgDomain: 'fake.example',
        balance: 0,
      },
    ]);
    const sf1 = linked.find(a => a.name === 'Fake checking').id;
    const sf2 = linked.find(a => a.name === 'Fake savings').id;
    // The links were written by another client; pull them first.
    const afterLink = await cli(['--refresh', 'bank-sync', 'status']);
    assert.equal(afterLink.linkedCount, 2);
    assert.equal(
      afterLink.accounts.find(a => a.id === sf1).provider,
      'simpleFin',
    );

    // Duplicates: the provider resends the same transactions.
    const repeat = await cli(['bank-sync', 'refresh']);
    assert.equal(repeat.commit, 'synced');
    assert.equal(repeat.result.attempted, 2);
    for (const outcome of repeat.result.outcomes) {
      assert.deepEqual(outcome.addedIds, [], JSON.stringify(outcome));
      assert.equal(outcome.error, null);
    }
    assert.match(repeat.result.coverage, /not verified/);

    // One-account refresh with a new transaction.
    fake.state.transactions['sf-1'].push({
      id: 't3',
      posted: Math.floor(Date.now() / 1000) - 86400,
      amount: '-5.00',
      description: 'Snack',
      payee: 'Shop',
    });
    fake.state.requests.length = 0;
    const one = await cli(['bank-sync', 'refresh', '--accounts', sf1]);
    assert.equal(one.result.outcomes.length, 1);
    assert.equal(one.result.outcomes[0].accountId, sf1);
    assert.equal(one.result.outcomes[0].status, 'imported');
    assert.equal(one.result.outcomes[0].addedIds.length, 1);
    assert.ok(
      fake.state.requests.every(r => r.length === 1 && r[0] === 'sf-1'),
      JSON.stringify(fake.state.requests),
    );

    // Partial failure: the provider no longer returns sf-2.
    fake.state.omit.add('sf-2');
    const partial = await cli(['bank-sync', 'refresh']);
    const byId = Object.fromEntries(
      partial.result.outcomes.map(o => [o.accountId, o]),
    );
    assert.equal(byId[sf1].status, 'no-new-transactions');
    assert.equal(byId[sf2].status, 'account-missing');
    fake.state.omit.clear();

    // Rate limiting is distinct from an empty feed.
    fake.state.mode = 'rate';
    const limited = await cli(['bank-sync', 'refresh']);
    for (const outcome of limited.result.outcomes) {
      assert.equal(outcome.status, 'rate-limited', JSON.stringify(outcome));
      assert.equal(outcome.retryable, true);
    }

    // Expired credentials need reauthentication, not a new connection.
    fake.state.mode = 'forbidden';
    const expired = await cli(['bank-sync', 'refresh', '--accounts', sf1]);
    assert.equal(expired.result.outcomes[0].status, 'auth-required');
    assert.match(expired.result.outcomes[0].prerequisite, /Reauthenticate/);
    const persisted = await cli(['bank-sync', 'status']);
    assert.equal(
      persisted.accounts.find(a => a.id === sf1).bankSyncStatus,
      'reauth-required',
    );
    assert.equal(
      (await cli(['accounts', 'list'])).length,
      accountsBefore + 2,
      'no connection created',
    );

    const runs = await cli(['bank-sync', 'results']);
    assert.ok(runs.runs.length >= 6);
    assert.equal(runs.runs[0].runId, expired.runId);
    const read = await cli(['bank-sync', 'results', one.runId]);
    assert.deepEqual(read.result, one.result);
    assert.equal(read.commit, 'synced');
  } finally {
    fake.server.closeAllConnections();
    fake.server.close();
    await f.dispose();
  }
});
