import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readRaw } from './guarded-kit.mjs';
import { createFixture, isolatedEnv } from './harness.mjs';

// Packaged proof for 0033: the optional MCP stdio adapter. A raw JSON-RPC
// client discovers domains and tools, compares tool schemas with the
// registry, gets identical data to the CLI for reads, an import preview and
// a scenario without writes, rejects unknown tools and inputs before any
// execution, previews and applies a guarded change, cancels a call, and
// reconnects. With ACTUAL_TEST_MCP_SDK pointing at an installed official
// SDK, the SDK client repeats discovery and a read.

const cliEntry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const CLI_ONLY = [
  'server_init',
  'server_start',
  'server_stop',
  'server_logs',
  'server_bootstrap',
  'sync_watch',
  'profiles_set',
  'profiles_use',
];

function env(f) {
  return isolatedEnv({
    ACTUAL_SERVER_URL: f.serverUrl,
    ACTUAL_PASSWORD: 'disposable-cli-test-password',
    ACTUAL_SYNC_ID: f.fixture.syncId,
    ACTUAL_DATA_DIR: join(f.root, 'a'),
    ACTUAL_PROFILES_FILE: join(f.root, 'profiles.json'),
  });
}

function connect(f, args = []) {
  const child = spawn(process.execPath, [cliEntry, 'mcp', 'serve', ...args], {
    cwd: f.root,
    env: env(f),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', d => {
    stderr += d;
  });
  const pending = new Map();
  const frames = [];
  createInterface({ input: child.stdout }).on('line', line => {
    // Every stdout line must be a JSON-RPC frame.
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0');
    frames.push(message);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  let next = 1;
  const request = (method, params) => {
    const id = next++;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
    );
    return {
      id,
      response: new Promise(resolve => pending.set(id, resolve)),
    };
  };
  const call = async (method, params) => await request(method, params).response;
  const notify = (method, params) =>
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`,
    );
  const close = () =>
    new Promise(resolve => {
      child.once('close', resolve);
      child.stdin.end();
    });
  return { request, call, notify, close, frames, stderr: () => stderr };
}

async function tool(client, name, args) {
  const response = await client.call('tools/call', { name, arguments: args });
  assert.ok(response.result, JSON.stringify(response));
  return response.result;
}

async function cliData(f, args) {
  const result = await f.cli(args);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout).data;
}

void test(
  'MCP stdio adapter: discovery, schema parity, CLI-identical reads, guarded apply, cancel and reconnect',
  { timeout: 240000 },
  async () => {
    const f = await createFixture();
    let client;
    try {
      client = connect(f);
      const init = await client.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      assert.equal(init.result.protocolVersion, '2025-06-18');
      assert.equal(init.result.serverInfo.name, 'actual-cli');
      assert.ok(init.result.capabilities.tools);
      client.notify('notifications/initialized', {});

      const tools = [];
      let cursor;
      do {
        const page = await client.call('tools/list', cursor ? { cursor } : {});
        tools.push(...page.result.tools);
        cursor = page.result.nextCursor;
      } while (cursor);
      const byName = new Map(tools.map(t => [t.name, t]));
      for (const name of CLI_ONLY) assert.ok(!byName.has(name), name);

      // A2: schemas come from the registry without drift.
      const capabilities = await cliData(f, ['capabilities']);
      const exposed = capabilities.operations.filter(
        o =>
          !CLI_ONLY.includes(o.name.replaceAll('.', '_')) &&
          o.name !== 'mcp.serve',
      );
      assert.equal(tools.length, exposed.length);
      for (const operation of exposed) {
        const t = byName.get(operation.name.replaceAll('.', '_'));
        assert.ok(t, operation.name);
        for (const [key, schema] of Object.entries(
          operation.inputSchema.properties,
        )) {
          assert.deepEqual(
            t.inputSchema.properties[key],
            schema,
            operation.name,
          );
        }
        for (const key of operation.inputSchema.required) {
          assert.ok(t.inputSchema.required.includes(key), operation.name);
        }
        assert.equal(
          t.annotations.readOnlyHint,
          !operation.capabilities.mutates,
        );
        assert.equal(
          t.annotations.destructiveHint,
          operation.capabilities.destructive,
        );
      }
      assert.equal(byName.get('accounts_list').annotations.readOnlyHint, true);
      assert.equal(
        byName.get('transactions_delete').annotations.destructiveHint,
        true,
      );
      assert.ok(
        !JSON.stringify(tools).includes('disposable-cli-test-password'),
      );

      const domains = await client.call('resources/read', {
        uri: 'actual://domains',
      });
      const domainMap = JSON.parse(domains.result.contents[0].text);
      assert.ok(domainMap.accounts.tools.includes('accounts_list'));
      const schema = await client.call('resources/read', {
        uri: 'actual://schema/imports_preview',
      });
      assert.equal(
        JSON.parse(schema.result.contents[0].text).operation,
        'imports.preview',
      );

      // Unknown tools and inputs fail before any execution.
      const unknown = await client.call('tools/call', {
        name: 'execute',
        arguments: {},
      });
      assert.equal(unknown.error.code, -32602);
      const extra = await client.call('tools/call', {
        name: 'accounts_list',
        arguments: { shell: 'rm -rf /' },
      });
      assert.equal(extra.error.code, -32602);
      const wrongType = await client.call('tools/call', {
        name: 'imports_preview',
        arguments: { file: 'x.csv', account: 7 },
      });
      assert.equal(wrongType.error.code, -32602);
      const missing = await client.call('tools/call', {
        name: 'imports_preview',
        arguments: { file: 'x.csv' },
      });
      assert.equal(missing.error.code, -32602);

      // A1: identical data and no writes.
      const listed = await cliData(f, ['accounts', 'list']);
      const raw = await readRaw(f);
      const accounts = await tool(client, 'accounts_list', {});
      assert.equal(accounts.isError, false);
      assert.deepEqual(accounts.structuredContent.data, listed);
      const scenario = JSON.stringify({
        categoryTargets: { [f.fixture.dining]: 77700 },
      });
      const plan = await tool(client, 'cash-planning_inspect', { scenario });
      assert.deepEqual(
        plan.structuredContent.data,
        await cliData(f, ['cash-planning', 'inspect', '--scenario', scenario]),
      );
      const file = join(f.root, 'mcp.csv');
      await writeFile(file, 'Date,Payee,Amount\n2026-09-04,Bakery,-4.50\n');
      const settings = JSON.stringify({
        fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
        dateFormat: 'yyyy mm dd',
      });
      const preview = await tool(client, 'imports_preview', {
        file,
        account: f.fixture.checking,
        settings,
      });
      assert.equal(preview.isError, false, preview.content[0].text);
      assert.deepEqual(
        preview.structuredContent.data,
        await cliData(f, [
          'imports',
          'preview',
          file,
          '--account',
          f.fixture.checking,
          '--settings',
          settings,
        ]),
      );
      assert.deepEqual(await readRaw(f), raw);

      // A3: preview and apply a permitted guarded change.
      const rows = await cliData(f, [
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-01-01',
        '--end',
        '2026-12-31',
      ]);
      const target =
        rows.find(r => !r.is_parent && r.category !== f.fixture.dining) ??
        rows[0];
      const prepared = await tool(client, 'changes_preview', {
        operation: 'transactions.categorize',
        operationId: 'mcp-categorize-1',
        data: JSON.stringify({ ids: [target.id], category: f.fixture.dining }),
      });
      assert.equal(prepared.isError, false, prepared.content[0].text);
      const token = prepared.structuredContent.data.token;
      const applied = await tool(client, 'changes_apply', {
        operationId: 'mcp-categorize-1',
        token,
      });
      assert.equal(applied.isError, false, applied.content[0].text);
      assert.match(
        applied.structuredContent.data.state,
        /committed-local|synced/,
      );

      // Failed operations come back as tool errors with the CLI error code.
      const failed = await tool(client, 'workflow_run_inspect', {
        runId: 'wf-nosuch',
      });
      assert.equal(failed.isError, true);
      assert.ok(failed.structuredContent.error.code);

      // Cancel an in-flight call: no response, server stays responsive.
      const inflight = client.request('tools/call', {
        name: 'workflow_weekly-checkup',
        arguments: { asOf: '2026-09-15', runId: 'wf-mcpcancel' },
      });
      client.notify('notifications/cancelled', { requestId: inflight.id });
      const raced = await Promise.race([
        inflight.response.then(() => 'answered'),
        new Promise(resolve => setTimeout(() => resolve('silent'), 3000)),
      ]);
      assert.equal(raced, 'silent');
      assert.deepEqual((await client.call('ping', {})).result, {});
      await client.close();

      // Reconnect: the applied receipt and run records are intact.
      client = connect(f, ['--domains', 'changes,workflow']);
      await client.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      const limited = (await client.call('tools/list', {})).result.tools;
      assert.ok(limited.every(t => /^(changes|workflow)_/.test(t.name)));
      const status = await tool(client, 'changes_status', {
        operationId: 'mcp-categorize-1',
      });
      assert.match(
        status.structuredContent.data.state,
        /committed-local|synced/,
      );
      const runs = await tool(client, 'workflow_run_list', {});
      assert.equal(runs.isError, false);
      await client.close();
      client = undefined;
      const after = await cliData(f, [
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-01-01',
        '--end',
        '2026-12-31',
      ]);
      assert.equal(
        after.find(r => r.id === target.id).category,
        f.fixture.dining,
      );
    } finally {
      if (client) await client.close();
      await f.dispose();
    }
  },
);

void test(
  'official MCP SDK client interoperates (when ACTUAL_TEST_MCP_SDK is set)',
  { timeout: 120000, skip: !process.env.ACTUAL_TEST_MCP_SDK },
  async () => {
    const sdk = process.env.ACTUAL_TEST_MCP_SDK;
    const { Client } = await import(
      pathToFileURL(join(sdk, 'dist/esm/client/index.js')).href
    );
    const { StdioClientTransport } = await import(
      pathToFileURL(join(sdk, 'dist/esm/client/stdio.js')).href
    );
    const f = await createFixture();
    try {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cliEntry, 'mcp', 'serve', '--domains', 'accounts,categories'],
        env: env(f),
        cwd: f.root,
        stderr: 'pipe',
      });
      const client = new Client({ name: 'sdk-test', version: '1.0.0' });
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.ok(tools.some(t => t.name === 'accounts_list'));
      const result = await client.callTool({
        name: 'accounts_list',
        arguments: {},
      });
      assert.equal(result.isError, false);
      assert.deepEqual(
        result.structuredContent.data,
        await cliData(f, ['accounts', 'list']),
      );
      const resource = await client.readResource({ uri: 'actual://domains' });
      assert.ok(JSON.parse(resource.contents[0].text).categories);
      await client.close();
    } finally {
      await f.dispose();
    }
  },
);
