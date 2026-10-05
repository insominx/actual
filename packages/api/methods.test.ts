import * as fs from 'fs/promises';
import * as path from 'path';

import { safeZip } from '@actual-app/core/server/util/zip';
import * as monthUtils from '@actual-app/core/shared/months';
import type { RuleEntity } from '@actual-app/core/types/models';
import { getClock } from '@actual-app/crdt';
import { vi } from 'vitest';

import * as api from './index';

declare global {
  var IS_TESTING: boolean;
  var currentMonth: string | null;
}

// In tests we run from source; loot-core's API fs uses __dirname (for the built dist/).
// Mock the fs so path constants point at loot-core package root where migrations live.
vi.mock(
  '../loot-core/src/platform/server/fs/index.api',
  async importOriginal => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const pathMod = await import('path');
    const lootCoreRoot = pathMod.join(__dirname, '..', 'loot-core');
    return {
      ...actual,
      migrationsPath: pathMod.join(lootCoreRoot, 'migrations'),
      bundledDatabasePath: pathMod.join(lootCoreRoot, 'default-db.sqlite'),
      demoBudgetPath: pathMod.join(lootCoreRoot, 'demo-budget'),
    };
  },
);

const budgetName = 'test-budget';

global.IS_TESTING = true;

beforeEach(async () => {
  const budgetPath = path.join(__dirname, '/mocks/budgets/', budgetName);
  await fs.rm(budgetPath, { force: true, recursive: true });

  await createTestBudget('default-budget-template', budgetName);
  await api.init({
    dataDir: path.join(__dirname, '/mocks/budgets/'),
  });
});

afterEach(async () => {
  global.currentMonth = null;
  await api.shutdown();
});

async function createTestBudget(templateName: string, name: string) {
  const templatePath = path.join(
    __dirname,
    '/../loot-core/src/mocks/files',
    templateName,
  );
  const budgetPath = path.join(__dirname, '/mocks/budgets/', name);

  await fs.mkdir(budgetPath);
  await fs.copyFile(
    path.join(templatePath, 'metadata.json'),
    path.join(budgetPath, 'metadata.json'),
  );
  await fs.copyFile(
    path.join(templatePath, 'db.sqlite'),
    path.join(budgetPath, 'db.sqlite'),
  );
}

describe('API setup and teardown', () => {
  // apis: loadBudget, getBudgetMonths
  test('successfully loads budget', async () => {
    await expect(api.loadBudget(budgetName)).resolves.toBeUndefined();

    await expect(api.getBudgetMonths()).resolves.toMatchSnapshot();
  });
});

describe('API budget import/export', () => {
  const importedBudgetIds = new Set<string>();

  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });

  afterEach(async () => {
    // Close any budget loaded by an import before removing its files
    await api.shutdown();

    for (const id of importedBudgetIds) {
      await fs.rm(path.join(__dirname, '/mocks/budgets/', id), {
        force: true,
        recursive: true,
      });
    }
    importedBudgetIds.clear();
  });

  test('createBudget loads a local budget and preserves currency after reload', async () => {
    const { id } = await api.createBudget({
      name: 'Local creation',
      currency: 'USD',
    });
    importedBudgetIds.add(id);
    expect(await api.getPreferences()).toMatchObject({
      defaultCurrencyCode: 'USD',
    });
    const account = await api.createAccount({ name: 'Cash' }, 12345);
    await api.shutdown();
    await api.init({ dataDir: path.join(__dirname, '/mocks/budgets/') });
    await api.loadBudget(id, { offline: true });
    expect(await api.getPreferences()).toMatchObject({
      defaultCurrencyCode: 'USD',
    });
    expect(await api.getAccounts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: account, name: 'Cash' }),
      ]),
    );
    const created = (await api.getBudgets()).find(b => b.id === id);
    expect(created?.groupId).toBeFalsy();
    expect(created?.cloudFileId).toBeFalsy();
  });

  test('guarded creation previews without changing budgets and rejects changed name availability', async () => {
    const source = await api.inspectBudget();
    const inventory = await api.getBudgets();
    const request = { name: 'Guarded created budget', currency: 'USD' };
    const proposal = await api.previewBudgetCreation(request);
    expect(proposal).toMatchObject({
      operation: 'budgets.create',
      budget: null,
      delivery: 'local-only',
      before: { exists: false },
      after: { name: request.name, currency: 'USD', published: false },
    });
    expect(await api.inspectBudget()).toEqual(source);
    expect(await api.getBudgets()).toEqual(inventory);
    request.name = 'Caller mutation';
    expect(proposal.request.name).toBe('Guarded created budget');
    const outcome = await api.applyBudgetCreation(proposal);
    expect(outcome.status).toBe('committed-local');
    if (outcome.status !== 'committed-local') {
      throw new Error('Expected creation acknowledgement');
    }
    const id = outcome.affectedIds[0];
    importedBudgetIds.add(id);
    expect(await api.inspectBudget()).toMatchObject({
      id,
      name: proposal.request.name,
      currency: 'USD',
      syncId: null,
      cloudFileId: null,
    });
    expect(outcome.checkpoint).toBeTruthy();
    expect(await api.applyBudgetCreation(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      (await api.getBudgets()).filter(b => b.name === proposal.request.name),
    ).toHaveLength(1);
    await api.loadBudget(source.id);
    expect(await api.inspectBudget()).toEqual(source);
  });

  test('guarded creation rejects malformed proposals and a concurrently occupied name', async () => {
    await expect(api.previewBudgetCreation({ name: ' ' })).rejects.toThrow();
    await expect(
      api.previewBudgetCreation({ name: 'Bad currency', currency: 'usd' }),
    ).rejects.toThrow();
    const proposal = await api.previewBudgetCreation({
      name: 'Occupied guarded name',
    });
    expect(
      await api.applyBudgetCreation({
        ...proposal,
        operation: 'budgets.archive',
      } as unknown as typeof proposal),
    ).toMatchObject({ status: 'rejected', code: 'INVALID_INPUT' });
    const created = await api.createBudget({ name: proposal.request.name });
    importedBudgetIds.add(created.id);
    const before = await api.inspectBudget();
    expect(await api.applyBudgetCreation(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(await api.inspectBudget()).toEqual(before);
  });

  test('guarded creation works without a loaded budget and serializes competing applies', async () => {
    await api.shutdown();
    await api.init({ dataDir: path.join(__dirname, '/mocks/budgets/') });
    const inventory = await api.getBudgets();
    const proposal = await api.previewBudgetCreation({
      name: 'Fresh guarded creation',
      currency: 'CAD',
    });
    expect(await api.getBudgets()).toEqual(inventory);
    const outcomes = await Promise.all([
      api.applyBudgetCreation(proposal),
      api.applyBudgetCreation(proposal),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'committed-local') {
        importedBudgetIds.add(outcome.affectedIds[0]);
      }
    }
    expect(outcomes.map(outcome => outcome.status)).toEqual([
      'committed-local',
      'rejected',
    ]);
    const committed = outcomes[0];
    if (committed.status !== 'committed-local') {
      throw new Error('Expected a creation acknowledgement');
    }
    importedBudgetIds.add(committed.affectedIds[0]);
    expect(outcomes[1]).toMatchObject({ code: 'STALE_PREVIEW' });
    expect(await api.inspectBudget()).toMatchObject({
      id: committed.affectedIds[0],
      name: proposal.request.name,
      currency: 'CAD',
      syncId: null,
    });
    expect(
      (await api.getBudgets()).filter(b => b.name === proposal.request.name),
    ).toHaveLength(1);
  });

  test('guarded restore preview preserves source files and binds the archive before creating a new identity', async () => {
    const createdSource = await api.createBudget({
      name: 'Guarded restore source',
    });
    importedBudgetIds.add(createdSource.id);
    const source = await api.inspectBudget();
    const account = await api.createAccount(
      { name: 'Guarded restore cash' },
      45678,
    );
    const archive = await api.exportBudget();
    const directory = path.join(__dirname, 'mocks/budgets', source.id);
    const files = await Promise.all(
      ['db.sqlite', 'metadata.json'].map(name =>
        fs.readFile(path.join(directory, name)),
      ),
    );
    const inventory = await api.getBudgets();
    const request = { name: 'Guarded restored destination' };
    const proposal = await api.previewBudgetRestore(archive, request);
    expect(proposal.budget).toBeNull();
    expect(proposal.before.sourceId).toBe(source.id);
    expect(proposal.before.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await api.getBudgets()).toEqual(inventory);
    expect(
      await Promise.all(
        ['db.sqlite', 'metadata.json'].map(name =>
          fs.readFile(path.join(directory, name)),
        ),
      ),
    ).toEqual(files);
    request.name = 'Changed caller request';
    expect(proposal.request.name).toBe('Guarded restored destination');
    const outcome = await api.applyBudgetRestore(proposal, archive);
    if (outcome.status === 'committed-local') {
      importedBudgetIds.add(outcome.affectedIds[0]);
    }
    expect(outcome.status).toBe('committed-local');
    if (outcome.status !== 'committed-local') {
      throw new Error('Restore was rejected');
    }
    expect(await api.inspectBudget()).toMatchObject({
      id: outcome.affectedIds[0],
      name: proposal.after.name,
      syncId: null,
      cloudFileId: null,
      encryptKeyId: null,
    });
    expect(outcome.affectedIds[0]).not.toBe(source.id);
    expect(await api.getAccountBalance(account)).toBe(45678);
    await api.loadBudget(source.id, { offline: true });
    expect(await api.getAccountBalance(account)).toBe(45678);
    expect(await api.applyBudgetRestore(proposal, archive)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });

  test('guarded restore rejects changed archive, occupied name and invalid SQLite without a destination', async () => {
    const source = await api.inspectBudget();
    const archive = await api.exportBudget();
    const proposal = await api.previewBudgetRestore(archive, {
      name: 'Guarded stale restore',
    });
    const inventory = await api.getBudgets();
    const changed = archive.slice();
    changed[changed.length - 1] ^= 1;
    expect(await api.applyBudgetRestore(proposal, changed)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      await api.applyBudgetRestore(
        { ...proposal, after: { ...proposal.after, name: 'Tampered' } },
        archive,
      ),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    const invalid = safeZip({
      'db.sqlite': new Uint8Array([1, 2, 3]),
      'metadata.json': new TextEncoder().encode(
        JSON.stringify({ id: source.id, budgetName: source.name }),
      ),
    });
    await expect(
      api.previewBudgetRestore(invalid, { name: 'Invalid guarded restore' }),
    ).rejects.toThrow();
    expect(await api.getBudgets()).toEqual(inventory);
    expect((await api.inspectBudget()).id).toBe(source.id);
    const collision = await api.createBudget({ name: proposal.request.name });
    importedBudgetIds.add(collision.id);
    await api.loadBudget(source.id, { offline: true });
    const occupied = await api.getBudgets();
    expect(await api.applyBudgetRestore(proposal, archive)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(await api.getBudgets()).toEqual(occupied);
    expect((await api.inspectBudget()).id).toBe(source.id);
  });

  test('guarded restore works without a loaded budget and competing applies create one destination', async () => {
    const archive = await api.exportBudget();
    await api.shutdown();
    await api.init({ dataDir: path.join(__dirname, 'mocks/budgets') });
    const inventory = await api.getBudgets();
    const proposal = await api.previewBudgetRestore(archive, {
      name: 'Fresh guarded restore',
    });
    expect(await api.getBudgets()).toEqual(inventory);
    const outcomes = await Promise.all([
      api.applyBudgetRestore(proposal, archive),
      api.applyBudgetRestore(proposal, archive),
    ]);
    const acknowledged = outcomes.filter(
      outcome => outcome.status === 'committed-local',
    );
    for (const outcome of acknowledged) {
      importedBudgetIds.add(outcome.affectedIds[0]);
    }
    expect(acknowledged).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toEqual([
      expect.objectContaining({ code: 'STALE_PREVIEW' }),
    ]);
    expect(
      (await api.getBudgets()).filter(
        budget => budget.name === proposal.request.name,
      ),
    ).toHaveLength(1);
  });

  test('restoreBudget creates a new identity without replacing its source', async () => {
    const original = await api.inspectBudget();
    const account = await api.createAccount(
      { name: 'Original restore cash' },
      12345,
    );
    const archive = await api.exportBudget();
    const { id } = await api.restoreBudget(archive, {
      name: 'Restored API copy',
    });
    importedBudgetIds.add(id);
    expect(id).not.toBe(original.id);
    expect(await api.inspectBudget()).toMatchObject({
      id,
      name: 'Restored API copy',
      syncId: null,
      cloudFileId: null,
      encryptKeyId: null,
    });
    expect(await api.getAccountBalance(account)).toBe(12345);
    await api.loadBudget(original.id, { offline: true });
    expect(await api.getAccountBalance(account)).toBe(12345);
    const before = await api.getBudgets();
    await expect(
      api.restoreBudget(archive, { name: 'Restored API copy' }),
    ).rejects.toThrow('already exists');
    expect(await api.getBudgets()).toEqual(before);
    expect((await api.inspectBudget()).id).toBe(original.id);
    await expect(
      api.restoreBudget(new Uint8Array([1, 2, 3]), { name: 'Invalid restore' }),
    ).rejects.toThrow();
    expect(await api.getBudgets()).toEqual(before);
  });

  test('restore removes invalid SQLite archives and incomplete writes without modifying existing budgets', async () => {
    const original = await api.inspectBudget();
    const archive = await api.exportBudget();
    const directory = path.join(__dirname, '/mocks/budgets/');
    const before = await fs.readdir(directory);
    const invalidDatabase = safeZip({
      'db.sqlite': new Uint8Array([1, 2, 3]),
      'metadata.json': new TextEncoder().encode(
        JSON.stringify({ id: original.id, budgetName: original.name }),
      ),
    });
    await expect(
      api.restoreBudget(invalidDatabase, { name: 'Invalid database restore' }),
    ).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual(before);
    const engineFs = await import('@actual-app/core/platform/server/fs');
    const write = vi
      .spyOn(engineFs, 'writeFile')
      .mockRejectedValueOnce(new Error('Injected restore write failure'));
    try {
      await expect(
        api.restoreBudget(archive, { name: 'Incomplete restore' }),
      ).rejects.toThrow('Injected restore write failure');
      expect(await fs.readdir(directory)).toEqual(before);
    } finally {
      write.mockRestore();
    }
    await api.loadBudget(original.id, { offline: true });
    expect((await api.inspectBudget()).id).toBe(original.id);
  });

  test('restore never cleans up a directory when exclusive creation failed', async () => {
    const archive = await api.exportBudget();
    const engineFs = await import('@actual-app/core/platform/server/fs');
    const mkdir = vi
      .spyOn(engineFs, 'mkdir')
      .mockRejectedValueOnce(new Error('Injected exclusive creation failure'));
    const cleanup = vi.spyOn(engineFs, 'removeDirRecursively');
    try {
      await expect(
        api.restoreBudget(archive, { name: 'Collision restore' }),
      ).rejects.toThrow('Injected exclusive creation failure');
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      mkdir.mockRestore();
      cleanup.mockRestore();
    }
  });

  test('creation validates before closing the selected budget', async () => {
    const before = await api.getBudgets();
    await expect(api.createBudget({ name: '  ' })).rejects.toThrow('blank');
    await expect(
      api.createBudget({ name: 'Invalid currency', currency: 'usd' }),
    ).rejects.toThrow('Currency');
    expect(await api.getBudgets()).toEqual(before);
    await expect(api.getAccounts()).resolves.toBeDefined();
  });

  test('creation removes incomplete files when the database copy fails', async () => {
    const engineFs = await import('@actual-app/core/platform/server/fs');
    const before = await fs.readdir(path.join(__dirname, '/mocks/budgets/'));
    const copy = vi
      .spyOn(engineFs, 'copyFile')
      .mockRejectedValueOnce(new Error('Injected copy failure'));
    try {
      await expect(
        api.createBudget({ name: 'Failed creation' }),
      ).rejects.toThrow('Injected copy failure');
      expect(await fs.readdir(path.join(__dirname, '/mocks/budgets/'))).toEqual(
        before,
      );
    } finally {
      copy.mockRestore();
    }
  });

  // apis: exportBudget, importBudget
  test('cloneBudget preserves ledger and preferences with a separate local identity', async () => {
    const account = await api.createAccount({ name: 'Original cash' }, 12345);
    await api.setPreference('defaultCurrencyCode', 'USD');
    const original = await api.inspectBudget();
    const originalNode = getClock().timestamp.node();
    const { id } = await api.cloneBudget({ name: 'Independent clone' });
    importedBudgetIds.add(id);
    expect(id).not.toBe(original.id);
    expect(getClock().timestamp.node()).not.toBe(originalNode);
    expect(await api.inspectBudget()).toMatchObject({
      id,
      name: 'Independent clone',
      syncId: null,
      cloudFileId: null,
      encryptKeyId: null,
      currency: 'USD',
    });
    expect(await api.getAccountBalance(account)).toBe(12345);
    await api.updateAccount(account, { name: 'Clone cash' });
    await api.loadBudget(original.id, { offline: true });
    expect(await api.getAccounts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: account, name: 'Original cash' }),
      ]),
    );
    await expect(
      api.cloneBudget({ name: 'Independent clone' }),
    ).rejects.toThrow();
    expect((await api.inspectBudget()).id).toBe(original.id);
  });

  test('guarded clone preview preserves source files and reload accepts the same copied state', async () => {
    const account = await api.createAccount(
      { name: 'Guarded source cash' },
      23456,
    );
    await api.setPreference('defaultCurrencyCode', 'CAD');
    const source = await api.inspectBudget();
    const directory = path.join(__dirname, '/mocks/budgets/', source.id);
    const sourceFiles = await Promise.all(
      ['db.sqlite', 'metadata.json'].map(name =>
        fs.readFile(path.join(directory, name)),
      ),
    );
    const inventory = await api.getBudgets();
    const request = { id: source.id, name: 'Guarded cloned destination' };
    const proposal = await api.previewBudgetClone(request);
    expect(proposal).toMatchObject({
      operation: 'budgets.clone',
      delivery: 'local-only',
      budget: { id: source.id },
      after: { name: request.name, published: false },
    });
    expect(proposal.before.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await api.getBudgets()).toEqual(inventory);
    expect(await api.inspectBudget()).toEqual(source);
    expect(
      await Promise.all(
        ['db.sqlite', 'metadata.json'].map(name =>
          fs.readFile(path.join(directory, name)),
        ),
      ),
    ).toEqual(sourceFiles);
    request.name = 'Caller changed input';
    expect(proposal.request.name).toBe('Guarded cloned destination');
    await api.getBudgetMonths();
    await api.loadBudget(source.id, { offline: true });
    const refreshed = await api.previewBudgetClone(proposal.request);
    expect(refreshed).toEqual(proposal);
    const result = await api.applyBudgetClone(proposal);
    expect(result.status).toBe('committed-local');
    if (result.status !== 'committed-local') {
      throw new Error('Expected clone acknowledgement');
    }
    const id = result.affectedIds[0];
    importedBudgetIds.add(id);
    expect(id).not.toBe(source.id);
    expect(await api.inspectBudget()).toMatchObject({
      id,
      name: proposal.request.name,
      currency: 'CAD',
      syncId: null,
      cloudFileId: null,
      encryptKeyId: null,
    });
    expect(await api.getAccountBalance(account)).toBe(23456);
    await api.updateAccount(account, { name: 'Clone-only edit' });
    await api.loadBudget(source.id, { offline: true });
    expect(await api.getAccounts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: account, name: 'Guarded source cash' }),
      ]),
    );
    expect(await api.applyBudgetClone(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });

  test('guarded clone rejects source edits and wrong identities before creating a destination', async () => {
    const account = await api.createAccount(
      { name: 'Mutable clone source' },
      1000,
    );
    const source = await api.inspectBudget();
    const request = { id: source.id, name: 'Clone must remain absent' };
    await expect(
      api.previewBudgetClone({ ...request, id: 'another-budget' }),
    ).rejects.toThrow();
    await expect(
      api.previewBudgetClone({ ...request, name: ' ' }),
    ).rejects.toThrow();
    const preview = await api.previewBudgetClone(request);
    expect(
      await api.applyBudgetClone({
        ...preview,
        budget: { ...preview.budget, id: 'another-budget' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    const [transaction] = await api.getTransactions(
      account,
      '2000-01-01',
      '2100-12-31',
    );
    for (const edit of [
      () => api.updateAccount(account, { name: 'Edited source account' }),
      () => api.setPreference('dateFormat', 'DD/MM/YYYY'),
      () =>
        api.updateTransaction(transaction.id, {
          notes: 'Edited source transaction',
        }),
      () => api.renameBudget('Edited source metadata'),
    ]) {
      const proposal = await api.previewBudgetClone(request);
      await edit();
      const inventory = await api.getBudgets();
      const outcome = await api.applyBudgetClone(proposal);
      if (outcome.status === 'committed-local') {
        importedBudgetIds.add(outcome.affectedIds[0]);
      }
      expect(outcome).toMatchObject({
        status: 'rejected',
        code: 'STALE_PREVIEW',
      });
      expect(await api.getBudgets()).toEqual(inventory);
      expect((await api.inspectBudget()).id).toBe(source.id);
    }
  });

  test('creation reports incomplete cleanup instead of inviting a blind retry', async () => {
    const engineFs = await import('@actual-app/core/platform/server/fs');
    const before = new Set(
      await fs.readdir(path.join(__dirname, '/mocks/budgets/')),
    );
    const copy = vi
      .spyOn(engineFs, 'copyFile')
      .mockRejectedValueOnce(new Error('Injected copy failure'));
    const cleanup = vi
      .spyOn(engineFs, 'removeDirRecursively')
      .mockRejectedValueOnce(new Error('Injected cleanup failure'));
    try {
      await expect(
        api.createBudget({ name: 'Incomplete cleanup' }),
      ).rejects.toMatchObject({ code: 'creation-cleanup-failed' });
      const remaining = await fs.readdir(
        path.join(__dirname, '/mocks/budgets/'),
      );
      for (const id of remaining) {
        if (!before.has(id)) importedBudgetIds.add(id);
      }
      expect(remaining.length).toBe(before.size + 1);
    } finally {
      copy.mockRestore();
      cleanup.mockRestore();
    }
  });

  test('cloneBudget removes incomplete copies when copying the database fails', async () => {
    const engineFs = await import('@actual-app/core/platform/server/fs');
    const before = await fs.readdir(path.join(__dirname, '/mocks/budgets/'));
    const copy = vi
      .spyOn(engineFs, 'copyFile')
      .mockRejectedValueOnce(new Error('Injected clone copy failure'));
    try {
      await expect(api.cloneBudget({ name: 'Failed clone' })).rejects.toThrow(
        'Injected clone copy failure',
      );
      expect(await fs.readdir(path.join(__dirname, '/mocks/budgets/'))).toEqual(
        before,
      );
      await api.loadBudget(budgetName, { offline: true });
      expect((await api.inspectBudget()).id).toBe(budgetName);
    } finally {
      copy.mockRestore();
    }
  });

  test('renaming preserves identity and local archiving is reversible', async () => {
    const { id } = await api.inspectBudget();
    await api.renameBudget('Renamed budget');
    expect(await api.inspectBudget()).toMatchObject({
      id,
      name: 'Renamed budget',
      archived: false,
    });
    await api.archiveBudget();
    expect(await api.inspectBudget()).toMatchObject({ id, archived: true });
    await api.archiveBudget(false);
    expect(await api.inspectBudget()).toMatchObject({ id, archived: false });
    await expect(api.renameBudget(' ')).rejects.toThrow();
    expect((await api.inspectBudget()).name).toBe('Renamed budget');
    await expect(api.publishBudget(id)).rejects.toThrow('authenticated server');
    expect((await api.inspectBudget()).cloudFileId).toBeNull();
  });

  test('sync status reports local unpublished writes without synchronizing or changing them', async () => {
    const { id } = await api.createBudget({ name: 'Pending status' });
    importedBudgetIds.add(id);
    const before = await api.getSyncStatus();
    expect(before.budgetId).toBe(id);
    expect(before.syncId).toBeNull();
    expect(before.state).toBe('unpublished');
    const account = await api.createAccount({ name: 'Pending cash' }, 999);
    const after = await api.getSyncStatus();
    expect(after.pendingMessages).toBeGreaterThan(before.pendingMessages);
    expect(after.deferredMessages).toBe(0);
    expect(after.lastSyncedTimestamp).toBeNull();
    expect(after.observedAt).toEqual(expect.any(Number));
    expect(await api.getSyncStatus()).toMatchObject({
      pendingMessages: after.pendingMessages,
      budgetId: id,
      state: 'unpublished',
    });
    expect(await api.getAccountBalance(account)).toBe(999);
  });

  test('exportBudget returns bytes that importBudget loads back', async () => {
    const accountId = await api.createAccount({ name: 'round-trip' }, 0);
    await api.addTransactions(accountId, [
      { date: '2023-10-01', amount: 1234, notes: 'round-trip transaction' },
    ]);

    const data = await api.exportBudget();
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBeGreaterThan(0);

    const { id } = await api.importBudget(data);
    expect(id).toBeTruthy();
    importedBudgetIds.add(id);

    // The imported budget is now the loaded one; verify the data
    // survived the round-trip
    const accounts = await api.getAccounts();
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: accountId, name: 'round-trip' }),
      ]),
    );

    const transactions = await api.getTransactions(
      accountId,
      '2023-10-01',
      '2023-10-31',
    );
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 1234,
          notes: 'round-trip transaction',
        }),
      ]),
    );
  });

  // apis: exportBudget, importBudget
  test('importBudget imports from a file path', async () => {
    const data = await api.exportBudget();
    const filepath = path.join(__dirname, '/mocks/budgets/', 'export.zip');
    await fs.writeFile(filepath, data);

    try {
      const { id } = await api.importBudget(filepath);
      expect(id).toBeTruthy();
      importedBudgetIds.add(id);
    } finally {
      await fs.rm(filepath, { force: true });
    }
  });

  // apis: importBudget
  test('importBudget rejects with an Error on failure', async () => {
    await expect(api.importBudget('/does/not/exist.zip')).rejects.toThrow(
      /^Error importing budget:/,
    );

    await expect(api.importBudget(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /^Error importing budget:/,
    );
  });
});

describe('API CRUD operations', () => {
  beforeEach(async () => {
    // load test budget
    await api.loadBudget(budgetName);
  });

  // api: getBudgets
  test('getBudgets', async () => {
    const budgets = await api.getBudgets();
    expect(budgets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'test-budget',
          name: 'Default Test Db',
        }),
      ]),
    );
  });

  // apis: getCategoryGroups, createCategoryGroup, updateCategoryGroup, deleteCategoryGroup
  test('CategoryGroups: successfully update category groups', async () => {
    const month = '2023-10';
    global.currentMonth = month;

    // get existing category groups
    const groups = await api.getCategoryGroups();
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hidden: false,
          id: 'fc3825fd-b982-4b72-b768-5b30844cf832',
          is_income: false,
          name: 'Usual Expenses',
        }),
        expect.objectContaining({
          hidden: false,
          id: 'a137772f-cf2f-4089-9432-822d2ddc1466',
          is_income: false,
          name: 'Investments and Savings',
        }),
        expect.objectContaining({
          hidden: false,
          id: '2E1F5BDB-209B-43F9-AF2C-3CE28E380C00',
          is_income: true,
          name: 'Income',
        }),
      ]),
    );

    // create our test category group
    const mainGroupId = await api.createCategoryGroup({
      name: 'test-group',
    });

    let budgetMonth = await api.getBudgetMonth(month);
    expect(budgetMonth.categoryGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mainGroupId,
        }),
      ]),
    );

    // update group
    await api.updateCategoryGroup(mainGroupId, {
      name: 'update-tests',
    });

    budgetMonth = await api.getBudgetMonth(month);
    expect(budgetMonth.categoryGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mainGroupId,
        }),
      ]),
    );

    // delete group
    await api.deleteCategoryGroup(mainGroupId);

    budgetMonth = await api.getBudgetMonth(month);
    expect(budgetMonth.categoryGroups).toEqual(
      expect.arrayContaining([
        expect.not.objectContaining({
          id: mainGroupId,
        }),
      ]),
    );
  });

  // apis: createCategory, getCategories, updateCategory, deleteCategory
  test('Categories: successfully update categories', async () => {
    const month = '2023-10';
    global.currentMonth = month;

    // create our test category group
    const mainGroupId = await api.createCategoryGroup({
      name: 'test-group',
    });
    const secondaryGroupId = await api.createCategoryGroup({
      name: 'test-secondary-group',
    });
    const categoryId = await api.createCategory({
      name: 'test-budget',
      group_id: mainGroupId,
    });
    const categoryIdHidden = await api.createCategory({
      name: 'test-budget-hidden',
      group_id: mainGroupId,
      hidden: true,
    });

    let categories = await api.getCategories();
    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: categoryId,
          name: 'test-budget',
          hidden: false,
          group_id: mainGroupId,
        }),
        expect.objectContaining({
          id: categoryIdHidden,
          name: 'test-budget-hidden',
          hidden: true,
          group_id: mainGroupId,
        }),
      ]),
    );

    // update/move category
    await api.updateCategory(categoryId, {
      name: 'updated-budget',
      group_id: secondaryGroupId,
    });

    await api.updateCategory(categoryIdHidden, {
      name: 'updated-budget-hidden',
      group_id: secondaryGroupId,
      hidden: false,
    });

    categories = await api.getCategories();
    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: categoryId,
          name: 'updated-budget',
          hidden: false,
          group_id: secondaryGroupId,
        }),
        expect.objectContaining({
          id: categoryIdHidden,
          name: 'updated-budget-hidden',
          hidden: false,
          group_id: secondaryGroupId,
        }),
      ]),
    );

    // delete categories
    await api.deleteCategory(categoryId);

    expect(categories).toEqual(
      expect.arrayContaining([
        expect.not.objectContaining({
          id: categoryId,
        }),
      ]),
    );
  });

  // apis: setBudgetAmount, setBudgetCarryover, getBudgetMonth
  test('Budgets: successfully update budgets', async () => {
    const month = '2023-10';
    global.currentMonth = month;

    // create some new categories to test with
    const groupId = await api.createCategoryGroup({
      name: 'tests',
    });
    const categoryId = await api.createCategory({
      name: 'test-budget',
      group_id: groupId,
    });

    await api.setBudgetAmount(month, categoryId, 100);
    await api.setBudgetCarryover(month, categoryId, true);

    const budgetMonth = await api.getBudgetMonth(month);
    expect(budgetMonth.categoryGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: groupId,
          categories: expect.arrayContaining([
            expect.objectContaining({
              id: categoryId,
              budgeted: 100,
              carryover: true,
            }),
          ]),
        }),
      ]),
    );
  });

  //apis: createAccount, getAccounts, updateAccount, closeAccount, deleteAccount, reopenAccount, getAccountBalance
  test('Accounts: successfully complete account operators', async () => {
    const accountId1 = await api.createAccount(
      { name: 'test-account1', offbudget: true },
      1000,
    );
    const accountId2 = await api.createAccount({ name: 'test-account2' }, 0);
    let accounts = await api.getAccounts();

    // accounts successfully created
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accountId1,
          name: 'test-account1',
          offbudget: true,
        }),
        expect.objectContaining({ id: accountId2, name: 'test-account2' }),
      ]),
    );

    expect(await api.getAccountBalance(accountId1)).toEqual(1000);
    expect(await api.getAccountBalance(accountId2)).toEqual(0);

    await api.updateAccount(accountId1, { offbudget: false });
    await api.closeAccount(accountId1, accountId2);
    await api.deleteAccount(accountId2);

    // accounts successfully updated, and one of them deleted
    accounts = await api.getAccounts();
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accountId1,
          name: 'test-account1',
          closed: true,
          offbudget: false,
        }),
        expect.not.objectContaining({ id: accountId2 }),
      ]),
    );

    await api.reopenAccount(accountId1);

    // the non-deleted account is reopened
    accounts = await api.getAccounts();
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accountId1,
          name: 'test-account1',
          closed: false,
        }),
      ]),
    );
  });

  // apis: createPayee, getPayees, updatePayee, deletePayee
  test('Payees: successfully update payees', async () => {
    const payeeId1 = await api.createPayee({ name: 'test-payee1' });
    const payeeId2 = await api.createPayee({ name: 'test-payee2' });
    let payees = await api.getPayees();

    // payees successfully created
    expect(payees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: payeeId1,
          name: 'test-payee1',
        }),
        expect.objectContaining({
          id: payeeId2,
          name: 'test-payee2',
        }),
      ]),
    );

    await api.updatePayee(payeeId1, { name: 'test-updated-payee' });
    await api.deletePayee(payeeId2);

    // confirm update and delete were successful
    payees = await api.getPayees();
    expect(payees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: payeeId1,
          name: 'test-updated-payee',
        }),
        expect.not.objectContaining({
          name: 'test-payee1',
        }),
        expect.not.objectContaining({
          id: payeeId2,
        }),
      ]),
    );
  });

  // apis: createTag, getTags, updateTag, deleteTag
  test('Tags: successfully complete tag operations', async () => {
    // Create tags
    const tagId1 = await api.createTag({ tag: 'test-tag1', color: '#ff0000' });
    const tagId2 = await api.createTag({
      tag: 'test-tag2',
      description: 'A test tag',
    });

    let tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId1,
          tag: 'test-tag1',
          color: '#ff0000',
        }),
        expect.objectContaining({
          id: tagId2,
          tag: 'test-tag2',
          description: 'A test tag',
        }),
      ]),
    );

    // Update tag
    await api.updateTag(tagId1, { tag: 'updated-tag', color: '#00ff00' });
    tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId1,
          tag: 'updated-tag',
          color: '#00ff00',
        }),
      ]),
    );

    // Delete tag
    await api.deleteTag(tagId2);
    tags = await api.getTags();
    expect(tags).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tagId2 })]),
    );
  });

  test('Tags: create tag with minimal fields', async () => {
    const tagId = await api.createTag({ tag: 'minimal-tag' });
    const tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId,
          tag: 'minimal-tag',
          color: null,
          description: null,
        }),
      ]),
    );
  });

  test('Tags: update single field only', async () => {
    const tagId = await api.createTag({ tag: 'original', color: '#ff0000' });

    // Update only color, tag and description should remain unchanged
    await api.updateTag(tagId, { color: '#00ff00' });

    const tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId,
          tag: 'original',
          color: '#00ff00',
          description: null,
        }),
      ]),
    );
  });

  test('Tags: handle null values correctly', async () => {
    const tagId = await api.createTag({
      tag: 'with-nulls',
      color: null,
      description: null,
    });

    const tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId,
          color: null,
          description: null,
        }),
      ]),
    );
  });

  test('Tags: clear optional field', async () => {
    const tagId = await api.createTag({
      tag: 'clearable',
      color: '#ff0000',
      description: 'will be cleared',
    });

    // Clear color by setting to null
    await api.updateTag(tagId, { color: null });

    let tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId,
          tag: 'clearable',
          color: null,
          description: 'will be cleared',
        }),
      ]),
    );

    // Clear description by setting to null
    await api.updateTag(tagId, { description: null });

    tags = await api.getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tagId,
          tag: 'clearable',
          color: null,
          description: null,
        }),
      ]),
    );
  });

  // apis: getNote, updateNote
  test('Notes: successfully get and update note', async () => {
    const categories = await api.getCategories();
    const categoryId = categories[0].id;

    // No note exists initially
    const initial = await api.getNote(categoryId);
    expect(initial).toBeNull();

    // Set a note
    await api.updateNote(categoryId, 'Test note content');
    const afterSet = await api.getNote(categoryId);
    expect(afterSet).toEqual({ id: categoryId, note: 'Test note content' });

    // Update the note
    await api.updateNote(categoryId, 'Updated note content');
    const afterUpdate = await api.getNote(categoryId);
    expect(afterUpdate).toEqual({
      id: categoryId,
      note: 'Updated note content',
    });
  });

  // apis: getRules, getPayeeRules, createRule, updateRule, deleteRule
  test('Rules: successfully update rules', async () => {
    await api.createPayee({ name: 'test-payee' });
    await api.createPayee({ name: 'test-payee2' });

    // create our test rules
    const rule = await api.createRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        {
          field: 'payee',
          op: 'is',
          value: 'test-payee',
        },
      ],
      actions: [
        {
          op: 'set',
          field: 'category',
          value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
        },
      ],
    });
    const rule2 = await api.createRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        {
          field: 'payee',
          op: 'is',
          value: 'test-payee2',
        },
      ],
      actions: [
        {
          op: 'set',
          field: 'category',
          value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
        },
      ],
    });

    // get existing rules
    const rules = await api.getRules();
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({
              field: 'category',
              op: 'set',
              type: 'id',
              value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
            }),
          ]),
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'payee',
              op: 'is',
              type: 'id',
              value: 'test-payee2',
            }),
          ]),
          conditionsOp: 'and',
          id: rule2.id,
          stage: 'pre',
        }),
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({
              field: 'category',
              op: 'set',
              type: 'id',
              value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
            }),
          ]),
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'payee',
              op: 'is',
              type: 'id',
              value: 'test-payee',
            }),
          ]),
          conditionsOp: 'and',
          id: rule.id,
          stage: 'pre',
        }),
      ]),
    );

    // get by payee
    expect(await api.getPayeeRules('test-payee')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({
              field: 'category',
              op: 'set',
              type: 'id',
              value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
            }),
          ]),
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'payee',
              op: 'is',
              type: 'id',
              value: 'test-payee',
            }),
          ]),
          conditionsOp: 'and',
          id: rule.id,
          stage: 'pre',
        }),
      ]),
    );

    expect(await api.getPayeeRules('test-payee2')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({
              field: 'category',
              op: 'set',
              type: 'id',
              value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
            }),
          ]),
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'payee',
              op: 'is',
              type: 'id',
              value: 'test-payee2',
            }),
          ]),
          conditionsOp: 'and',
          id: rule2.id,
          stage: 'pre',
        }),
      ]),
    );

    // update one rule
    const updatedRule = {
      ...rule,
      stage: 'post',
      conditionsOp: 'or',
    } satisfies RuleEntity;
    expect(await api.updateRule(updatedRule)).toEqual(updatedRule);

    expect(await api.getRules()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({
              field: 'category',
              op: 'set',
              type: 'id',
              value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
            }),
          ]),
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'payee',
              op: 'is',
              type: 'id',
              value: 'test-payee',
            }),
          ]),
          conditionsOp: 'or',
          id: rule.id,
          stage: 'post',
        }),
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({
              field: 'category',
              op: 'set',
              type: 'id',
              value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
            }),
          ]),
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'payee',
              op: 'is',
              type: 'id',
              value: 'test-payee2',
            }),
          ]),
          conditionsOp: 'and',
          id: rule2.id,
          stage: 'pre',
        }),
      ]),
    );

    // delete rules
    await api.deleteRule(rules[1].id);
    expect(await api.getRules()).toHaveLength(1);

    await api.deleteRule(rules[0].id);
    expect(await api.getRules()).toHaveLength(0);
  });

  // apis: addTransactions, getTransactions, importTransactions, updateTransaction, deleteTransaction
  test('Transactions: successfully update transactions', async () => {
    const accountId = await api.createAccount({ name: 'test-account' }, 0);

    let newTransaction = [
      {
        account: accountId,
        date: '2023-11-03',
        imported_id: '11',
        amount: 100,
        notes: 'notes',
      },
      {
        account: accountId,
        date: '2023-11-03',
        imported_id: '12',
        amount: 100,
        notes: '',
      },
    ];

    const addResult = await api.addTransactions(accountId, newTransaction, {
      learnCategories: true,
      runTransfers: true,
    });
    expect(addResult).toBe('ok');

    expect(await api.getAccountBalance(accountId)).toEqual(200);
    expect(
      await api.getAccountBalance(accountId, new Date(2023, 10, 2)),
    ).toEqual(0);

    // confirm added transactions exist
    let transactions = await api.getTransactions(
      accountId,
      '2023-11-01',
      '2023-11-30',
    );
    expect(transactions).toEqual(
      expect.arrayContaining(
        newTransaction.map(trans => expect.objectContaining(trans)),
      ),
    );
    expect(transactions).toHaveLength(2);

    newTransaction = [
      {
        account: accountId,
        date: '2023-12-03',
        imported_id: '11',
        amount: 100,
        notes: 'notes',
      },
      {
        account: accountId,
        date: '2023-12-03',
        imported_id: '12',
        amount: 100,
        notes: 'notes',
      },
      {
        account: accountId,
        date: '2023-12-03',
        imported_id: '22',
        amount: 200,
        notes: '',
      },
    ];

    const reconciled = await api.importTransactions(accountId, newTransaction);

    // Expect it to reconcile and to have updated one of the previous transactions
    expect(reconciled.added).toHaveLength(1);
    expect(reconciled.updated).toHaveLength(1);

    // confirm imported transactions exist
    transactions = await api.getTransactions(
      accountId,
      '2023-12-01',
      '2023-12-31',
    );
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ imported_id: '22', amount: 200 }),
      ]),
    );
    expect(transactions).toHaveLength(1);

    // confirm imported transactions update perfomed
    transactions = await api.getTransactions(
      accountId,
      '2023-11-01',
      '2023-11-30',
    );
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ notes: 'notes', amount: 100 }),
      ]),
    );
    expect(transactions).toHaveLength(2);

    const idToUpdate = reconciled.added[0];
    const idToDelete = reconciled.updated[0];
    await api.updateTransaction(idToUpdate, { amount: 500 });
    await api.deleteTransaction(idToDelete);

    // confirm updates and deletions work
    transactions = await api.getTransactions(
      accountId,
      '2023-12-01',
      '2023-12-31',
    );
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: idToUpdate, amount: 500 }),
        expect.not.objectContaining({ id: idToDelete }),
      ]),
    );
    expect(transactions).toHaveLength(1);
  });

  // apis: mergeTransactions
  test('Transactions: successfully merge two transactions', async () => {
    const accountId = await api.createAccount({ name: 'test-account' }, 0);

    await api.addTransactions(accountId, [
      { date: '2023-11-03', amount: 100, notes: 'notes' },
      { date: '2023-11-03', amount: 100, imported_id: '1' },
    ]);

    const before = await api.getTransactions(
      accountId,
      '2023-11-01',
      '2023-11-30',
    );
    expect(before).toHaveLength(2);

    const keptId = await api.mergeTransactions([before[0].id, before[1].id]);

    const after = await api.getTransactions(
      accountId,
      '2023-11-01',
      '2023-11-30',
    );
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: keptId, notes: 'notes' });
  });

  test('Transactions: import notes are preserved when importing', async () => {
    const accountId = await api.createAccount({ name: 'test-account' }, 0);

    // Test with notes
    const transactionsWithNotes = [
      {
        date: '2023-11-03',
        imported_id: '11',
        amount: 100,
        notes: 'test note',
      },
    ];

    const addResultWithNotes = await api.addTransactions(
      accountId,
      transactionsWithNotes,
      {
        learnCategories: true,
        runTransfers: true,
      },
    );
    expect(addResultWithNotes).toBe('ok');

    let transactions = await api.getTransactions(
      accountId,
      '2023-11-01',
      '2023-11-30',
    );
    expect(transactions[0].notes).toBe('test note');

    // Clear transactions
    await api.deleteTransaction(transactions[0].id);

    // Test without notes
    const transactionsWithoutNotes = [
      { date: '2023-11-03', imported_id: '11', amount: 100 },
    ];

    const addResultWithoutNotes = await api.addTransactions(
      accountId,
      transactionsWithoutNotes,
      {
        learnCategories: true,
        runTransfers: true,
      },
    );
    expect(addResultWithoutNotes).toBe('ok');

    transactions = await api.getTransactions(
      accountId,
      '2023-11-01',
      '2023-11-30',
    );
    expect(transactions[0].notes).toBeNull();
  });

  test('Transactions: reimportDeleted=false prevents reimporting deleted transactions', async () => {
    const accountId = await api.createAccount({ name: 'test-account' }, 0);

    // Import a transaction
    const result1 = await api.importTransactions(accountId, [
      {
        date: '2023-11-03',
        imported_id: 'reimport-test-1',
        amount: 100,
        account: accountId,
      },
    ]);
    expect(result1.added).toHaveLength(1);

    // Delete the transaction
    await api.deleteTransaction(result1.added[0]);

    // Reimport the same transaction with reimportDeleted=false
    const result2 = await api.importTransactions(
      accountId,
      [
        {
          date: '2023-11-03',
          imported_id: 'reimport-test-1',
          amount: 100,
          account: accountId,
        },
      ],
      { reimportDeleted: false },
    );

    // Should match the deleted transaction and not create a new one
    expect(result2.added).toHaveLength(0);
    expect(result2.updated).toHaveLength(0);
  });

  test('Transactions: reimportDeleted=true reimports deleted transactions', async () => {
    const accountId = await api.createAccount({ name: 'test-account' }, 0);

    // Import a transaction
    const result1 = await api.importTransactions(accountId, [
      {
        date: '2023-11-03',
        imported_id: 'reimport-test-2',
        amount: 200,
        account: accountId,
      },
    ]);
    expect(result1.added).toHaveLength(1);

    // Delete the transaction
    await api.deleteTransaction(result1.added[0]);

    // Reimport the same transaction relying on reimportDeleted=true default
    const result2 = await api.importTransactions(accountId, [
      {
        date: '2023-11-03',
        imported_id: 'reimport-test-2',
        amount: 200,
        account: accountId,
      },
    ]);

    // Should create a new transaction since deleted ones are ignored
    expect(result2.added).toHaveLength(1);
  });
});

//apis: createSchedule, getSchedules, updateSchedule, deleteSchedule
test('Schedules: successfully complete schedules operations', async () => {
  await api.loadBudget(budgetName);
  //test a schedule with a recuring configuration
  const ScheduleId1 = await api.createSchedule({
    name: 'test-schedule 1',
    posts_transaction: true,
    //    amount: -5000,
    amountOp: 'is',
    date: {
      frequency: 'monthly',
      interval: 1,
      start: '2025-06-13',
      patterns: [],
      skipWeekend: false,
      weekendSolveMode: 'after',
      endMode: 'never',
    },
  });
  //test the creation of non recurring schedule
  const ScheduleId2 = await api.createSchedule({
    name: 'test-schedule 2',
    posts_transaction: false,
    amount: 4000,
    amountOp: 'is',
    date: '2025-06-13',
  });
  let schedules = await api.getSchedules();

  // Schedules successfully created
  expect(schedules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'test-schedule 1',
        posts_transaction: true,
        //       amount: -5000,
        amountOp: 'is',
        date: {
          frequency: 'monthly',
          interval: 1,
          start: '2025-06-13',
          patterns: [],
          skipWeekend: false,
          weekendSolveMode: 'after',
          endMode: 'never',
        },
      }),
      expect.objectContaining({
        name: 'test-schedule 2',
        posts_transaction: false,
        amount: 4000,
        amountOp: 'is',
        date: '2025-06-13',
      }),
    ]),
  );
  //check getIDByName works on schedules
  expect(await api.getIDByName('schedules', 'test-schedule 1')).toEqual(
    ScheduleId1,
  );
  expect(await api.getIDByName('schedules', 'test-schedule 2')).toEqual(
    ScheduleId2,
  );

  //check getIDByName works on accounts
  const schedAccountId1 = await api.createAccount(
    { name: 'sched-test-account1', offbudget: true },
    1000,
  );

  expect(await api.getIDByName('accounts', 'sched-test-account1')).toEqual(
    schedAccountId1,
  );

  //check getIDByName works on payees
  const schedPayeeId1 = await api.createPayee({ name: 'sched-test-payee1' });

  expect(await api.getIDByName('payees', 'sched-test-payee1')).toEqual(
    schedPayeeId1,
  );
  await api.updateSchedule(ScheduleId1, {
    amount: -10000,
    account: schedAccountId1,
  });
  await api.deleteSchedule(ScheduleId2);

  // schedules successfully updated, and one of them deleted
  await api.updateSchedule(ScheduleId1, {
    amount: -10000,
    account: schedAccountId1,
    payee: schedPayeeId1,
  });
  await api.deleteSchedule(ScheduleId2);

  schedules = await api.getSchedules();
  expect(schedules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: ScheduleId1,
        posts_transaction: true,
        amount: -10000,
        account: schedAccountId1,
        payee: schedPayeeId1,
        amountOp: 'is',
        date: {
          frequency: 'monthly',
          interval: 1,
          start: '2025-06-13',
          patterns: [],
          skipWeekend: false,
          weekendSolveMode: 'after',
          endMode: 'never',
        },
      }),
      expect.not.objectContaining({ id: ScheduleId2 }),
    ]),
  );
});

// apis: getPreferences
test('Preferences: successfully read synced preferences', async () => {
  await api.loadBudget(budgetName);

  await api.internal?.send('preferences/save', {
    id: 'numberFormat',
    value: '1.234,56',
  });
  await api.internal?.send('preferences/save', {
    id: 'hideFraction',
    value: 'true',
  });

  const preferences = await api.getPreferences();
  expect(preferences).toMatchObject({
    numberFormat: '1.234,56',
    hideFraction: 'true',
  });
});

describe('API preferences: setPreference', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });

  // apis: setPreference
  test('successfully sets a single preference', async () => {
    await api.setPreference('numberFormat', '1,234.5');

    const preferences = await api.getPreferences();
    expect(preferences.numberFormat).toBe('1,234.5');
  });

  // apis: setPreference
  test('can set multiple preferences', async () => {
    await api.setPreference('numberFormat', '1,234.5');
    await api.setPreference('hideFraction', 'true');
    await api.setPreference('defaultCurrencyCode', 'USD');

    const preferences = await api.getPreferences();
    expect(preferences).toMatchObject({
      numberFormat: '1,234.5',
      hideFraction: 'true',
      defaultCurrencyCode: 'USD',
    });
  });

  // apis: setPreference
  test('can set feature flag preferences', async () => {
    await api.setPreference('flags.newSidebarUI', 'true');

    const preferences = await api.getPreferences();
    expect(preferences['flags.newSidebarUI']).toBe('true');
  });

  // apis: setPreference
  test('can set account-specific preferences', async () => {
    const accountId = 'test-account-123';
    await api.setPreference(
      `show-account-${accountId}-net-worth-chart`,
      'false',
    );

    const preferences = await api.getPreferences();
    expect(preferences[`show-account-${accountId}-net-worth-chart`]).toBe(
      'false',
    );
  });

  // apis: setPreference
  test('can set CSV import preferences', async () => {
    await api.setPreference(
      `csv-mappings-${budgetName}`,
      'col1:name,col2:amount',
    );

    const preferences = await api.getPreferences();
    expect(preferences[`csv-mappings-${budgetName}`]).toBe(
      'col1:name,col2:amount',
    );
  });
});

describe('guarded transaction changes', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });

  test('previews without writing, applies exact state, and rejects a stale repeat', async () => {
    const account = await api.createAccount({ name: 'Guarded cash' }, 0);
    await api.addTransactions(account, [
      { date: '2026-08-02', amount: -100, notes: 'before' },
    ]);
    const before = await api.getTransactions(
      account,
      '2026-08-01',
      '2026-08-31',
    );
    const id = (
      await api.getTransactions(account, '2026-08-01', '2026-08-31')
    )[0].id;
    const proposal = await api.previewTransactionUpdate({
      id,
      fields: { notes: 'after', amount: -222 },
    });
    expect(proposal.operation).toBe('transactions.update');
    expect(proposal.budget.id).toBe(budgetName);
    expect(proposal.before).toEqual(before);
    expect(proposal.after[0]).toMatchObject({
      id,
      notes: 'after',
      amount: -222,
    });
    expect(
      await api.getTransactions(account, '2026-08-01', '2026-08-31'),
    ).toEqual(before);
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      (await api.getTransactions(account, '2026-08-01', '2026-08-31'))[0],
    ).toMatchObject({ amount: -222, notes: 'after' });
  });

  test('rejects edited state, another budget, and invalid fields before a write', async () => {
    const account = await api.createAccount({ name: 'Guarded isolation' }, 0);
    await api.addTransactions(account, [
      { date: '2026-08-02', amount: -100, notes: 'before' },
    ]);
    const id = (
      await api.getTransactions(account, '2026-08-01', '2026-08-31')
    )[0].id;
    const proposal = await api.previewTransactionUpdate({
      id,
      fields: { notes: 'proposed' },
    });
    await api.updateTransaction(id, { notes: 'concurrent' });
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      await api.applyTransactionUpdate({
        ...proposal,
        budget: { ...proposal.budget, id: 'another-budget' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    await expect(
      api.previewTransactionUpdate({
        id,
        // @ts-expect-error Runtime boundary must reject unsupported fields.
        fields: { id: 'replaced' },
      }),
    ).rejects.toThrow();
    expect(
      (await api.getTransactions(account, '2026-08-01', '2026-08-31')).find(
        row => row.id === id,
      )?.notes,
    ).toBe('concurrent');
  });

  test('previews the full split and applies parent inheritance without preview writes', async () => {
    const account = await api.createAccount(
      { name: 'Guarded split parent' },
      0,
    );
    await api.addTransactions(account, [
      {
        date: '2026-08-03',
        amount: -200,
        subtransactions: [
          { amount: -80, notes: 'first' },
          { amount: -120, notes: 'second' },
        ],
      },
    ]);
    const before = await api.getTransactions(
      account,
      '2026-08-01',
      '2026-08-31',
    );
    const parent = before.find(row => row.is_parent)!;
    const proposal = await api.previewTransactionUpdate({
      id: parent.id,
      fields: { date: '2026-08-04', cleared: true, amount: -250 },
    });
    expect(proposal.before).toHaveLength(3);
    expect(proposal.after).toHaveLength(3);
    expect(
      proposal.after.every(row => row.date === '2026-08-04' && row.cleared),
    ).toBe(true);
    expect(
      proposal.after.find(row => row.id === parent.id)?.error,
    ).toMatchObject({
      type: 'SplitTransactionError',
      difference: -50,
    });
    expect(
      await api.getTransactions(account, '2026-08-01', '2026-08-31'),
    ).toEqual(before);
    const outcome = await api.applyTransactionUpdate(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    if (outcome.status !== 'committed-local') {
      throw new Error('Expected commit');
    }
    expect(outcome.affectedIds.sort()).toEqual(
      proposal.before.map(row => row.id).sort(),
    );
    const after = await api.getTransactions(
      account,
      '2026-08-01',
      '2026-08-31',
    );
    expect(after[0].date).toBe('2026-08-04');
    expect(after[0].subtransactions?.map(row => row.amount)).toEqual([
      -80, -120,
    ]);
    expect(after[0].subtransactions?.every(row => row.cleared)).toBe(true);
  });

  test('updates a split child with canonical error recalculation and rejects sibling changes', async () => {
    const account = await api.createAccount({ name: 'Guarded split child' }, 0);
    await api.addTransactions(account, [
      {
        date: '2026-08-03',
        amount: -200,
        subtransactions: [
          { amount: -80, notes: 'first' },
          { amount: -120, notes: 'second' },
        ],
      },
    ]);
    const read = () => api.getTransactions(account, '2026-08-01', '2026-08-31');
    const parent = (await read()).find(row => row.is_parent)!;
    const [child, sibling] = parent.subtransactions!;
    const stale = await api.previewTransactionUpdate({
      id: child.id,
      fields: { notes: 'proposed' },
    });
    await api.updateTransaction(sibling.id, { notes: 'concurrent sibling' });
    expect(await api.applyTransactionUpdate(stale)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const before = await read();
    const proposal = await api.previewTransactionUpdate({
      id: child.id,
      fields: { amount: -90, notes: 'applied child' },
    });
    expect(proposal.before.map(row => row.id).sort()).toEqual(
      [parent.id, child.id, sibling.id].sort(),
    );
    expect(
      proposal.after.find(row => row.id === parent.id)?.error,
    ).toMatchObject({ difference: 10 });
    expect(await read()).toEqual(before);
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'committed-local',
    });
    const after = (await read())[0];
    expect(after.amount).toBe(-200);
    expect(
      after.subtransactions?.find(row => row.id === child.id),
    ).toMatchObject({ amount: -90, notes: 'applied child' });
    expect(
      after.subtransactions?.find(row => row.id === sibling.id)?.notes,
    ).toBe('concurrent sibling');
  });
});

describe('guarded linked transfer changes', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });

  test('preserves cross-budget categories and rejects changed account references or missing links', async () => {
    const from = await api.createAccount({ name: 'Guarded budget account' }, 0);
    const to = await api.createAccount(
      { name: 'Guarded tracking account', offbudget: true },
      0,
    );
    const group = await api.createCategoryGroup({
      name: 'Guarded transfer category',
    });
    const category = await api.createCategory({
      name: 'Tracked spending',
      group_id: group,
    });
    const payee = (await api.getPayees()).find(
      row => row.transfer_acct === to,
    )!;
    await api.addTransactions(
      from,
      [{ date: '2026-08-03', amount: -100, category, payee: payee.id }],
      { runTransfers: true },
    );
    const read = () => api.getTransactions(from, '2026-08-01', '2026-08-31');
    const original = (await read())[0];
    const proposal = await api.previewTransactionUpdate({
      id: original.id,
      fields: { amount: -150 },
    });
    expect(proposal.after.find(row => row.id === original.id)?.category).toBe(
      category,
    );
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'committed-local',
    });
    expect((await read())[0].category).toBe(category);
    const stale = await api.previewTransactionUpdate({
      id: original.id,
      fields: { notes: 'proposed' },
    });
    await api.updateAccount(to, { name: 'Changed account reference' });
    expect(await api.applyTransactionUpdate(stale)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    await api.addTransactions(
      from,
      [
        {
          date: '2026-08-04',
          amount: -100,
          payee: payee.id,
          transfer_id: 'missing-counterpart',
        },
      ],
      { runTransfers: false },
    );
    const before = await read();
    const broken = before.find(
      row => row.transfer_id === 'missing-counterpart',
    )!;
    await expect(
      api.previewTransactionUpdate({
        id: broken.id,
        fields: { notes: 'must not write' },
      }),
    ).rejects.toThrow();
    expect(await read()).toEqual(before);
  });

  test('previews both sides without writes, mirrors canonical fields, and rejects counterpart edits', async () => {
    const from = await api.createAccount({ name: 'Guarded transfer from' }, 0);
    const to = await api.createAccount({ name: 'Guarded transfer to' }, 0);
    const payee = (await api.getPayees()).find(
      row => row.transfer_acct === to,
    )!;
    await api.addTransactions(
      from,
      [{ date: '2026-08-03', amount: -200, payee: payee.id, notes: 'before' }],
      { runTransfers: true },
    );
    const read = (account: string) =>
      api.getTransactions(account, '2026-08-01', '2026-08-31');
    const original = (await read(from))[0];
    const counterpart = (await read(to))[0];
    const before = [await read(from), await read(to)];
    const proposal = await api.previewTransactionUpdate({
      id: original.id,
      fields: {
        notes: 'after',
        amount: -275,
        date: '2026-08-05',
        cleared: true,
      },
    });
    expect(proposal.before.map(row => row.id).sort()).toEqual(
      [original.id, counterpart.id].sort(),
    );
    expect(proposal.after.find(row => row.id === counterpart.id)).toMatchObject(
      {
        amount: 275,
        notes: 'after',
        date: counterpart.date,
        cleared: counterpart.cleared,
      },
    );
    expect([await read(from), await read(to)]).toEqual(before);
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: expect.arrayContaining([original.id, counterpart.id]),
    });
    expect((await read(from))[0]).toMatchObject({
      amount: -275,
      date: '2026-08-05',
      cleared: true,
    });
    expect((await read(to))[0]).toMatchObject({
      amount: 275,
      date: counterpart.date,
      notes: 'after',
      cleared: counterpart.cleared,
    });
    const stale = await api.previewTransactionUpdate({
      id: original.id,
      fields: { amount: -300 },
    });
    await api.updateTransaction(counterpart.id, { cleared: true });
    expect(await api.applyTransactionUpdate(stale)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect((await read(from))[0].amount).toBe(-275);
  });

  test('includes the counterpart split and recalculates its error through the transfer owner', async () => {
    const from = await api.createAccount(
      { name: 'Guarded split transfer from' },
      0,
    );
    const to = await api.createAccount(
      { name: 'Guarded split transfer to' },
      0,
    );
    const payee = (await api.getPayees()).find(
      row => row.transfer_acct === to,
    )!;
    await api.addTransactions(
      from,
      [
        {
          date: '2026-08-03',
          amount: -300,
          subtransactions: [
            { amount: -200, payee: payee.id, notes: 'linked' },
            { amount: -100, notes: 'sibling' },
          ],
        },
      ],
      { runTransfers: true },
    );
    const read = (account: string) =>
      api.getTransactions(account, '2026-08-01', '2026-08-31');
    const parent = (await read(from))[0];
    const original = (await read(to))[0];
    const child = parent.subtransactions!.find(
      row => row.transfer_id === original.id,
    )!;
    const sibling = parent.subtransactions!.find(row => row.id !== child.id)!;
    const before = [await read(from), await read(to)];
    const proposal = await api.previewTransactionUpdate({
      id: original.id,
      fields: { amount: 210, notes: 'counterpart update' },
    });
    expect(proposal.before.map(row => row.id).sort()).toEqual(
      [original.id, parent.id, child.id, sibling.id].sort(),
    );
    expect(
      proposal.after.find(row => row.id === parent.id)?.error,
    ).toMatchObject({ difference: 10 });
    expect([await read(from), await read(to)]).toEqual(before);
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'committed-local',
    });
    const after = (await read(from))[0];
    expect(after.amount).toBe(-300);
    expect(after.error).toMatchObject({ difference: 10 });
    expect(
      after.subtransactions!.find(row => row.id === child.id),
    ).toMatchObject({ amount: -210, notes: 'counterpart update' });
    const stale = await api.previewTransactionUpdate({
      id: original.id,
      fields: { amount: 220 },
    });
    await api.updateTransaction(sibling.id, { notes: 'changed sibling' });
    expect(await api.applyTransactionUpdate(stale)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect((await read(to))[0].amount).toBe(210);
  });
});

describe('guarded budget metadata changes', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });

  test('previews rename without writes and rejects stale or wrong-budget metadata', async () => {
    await api.renameBudget('Guarded metadata source');
    const before = await api.inspectBudget();
    const pending = (await api.getSyncStatus()).pendingMessages;
    try {
      const proposal = await api.previewBudgetMetadata({
        operation: 'budgets.rename',
        id: before.id,
        name: 'Guarded renamed budget',
      });
      expect(proposal.before).toEqual({
        name: before.name,
        archived: before.archived,
      });
      expect(proposal.after.name).toBe('Guarded renamed budget');
      expect(await api.inspectBudget()).toEqual(before);
      expect((await api.getSyncStatus()).pendingMessages).toBe(pending);
      expect(
        await api.applyBudgetMetadata({
          ...proposal,
          budget: { ...proposal.budget, id: 'another-budget' },
        }),
      ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
      expect(await api.applyBudgetMetadata(proposal)).toMatchObject({
        status: 'committed-local',
        changed: true,
        affectedIds: [before.id],
      });
      expect((await api.inspectBudget()).name).toBe('Guarded renamed budget');
      expect(await api.applyBudgetMetadata(proposal)).toMatchObject({
        status: 'rejected',
        code: 'STALE_PREVIEW',
      });
      const stale = await api.previewBudgetMetadata({
        operation: 'budgets.rename',
        id: before.id,
        name: 'Second guarded name',
      });
      await api.renameBudget('Concurrent name');
      expect(await api.applyBudgetMetadata(stale)).toMatchObject({
        status: 'rejected',
        code: 'STALE_PREVIEW',
      });
      expect((await api.inspectBudget()).name).toBe('Concurrent name');
    } finally {
      await api.renameBudget(before.name);
    }
  });

  test('archives only local metadata, preserves pending messages, and supports a zero-write no-op', async () => {
    const before = await api.inspectBudget();
    const pending = (await api.getSyncStatus()).pendingMessages;
    try {
      const proposal = await api.previewBudgetMetadata({
        operation: 'budgets.archive',
        id: before.id,
        archived: true,
      });
      expect(await api.inspectBudget()).toEqual(before);
      expect(await api.applyBudgetMetadata(proposal)).toMatchObject({
        status: 'committed-local',
        changed: !before.archived,
      });
      expect((await api.inspectBudget()).archived).toBe(true);
      expect((await api.getSyncStatus()).pendingMessages).toBe(pending);
      const noop = await api.previewBudgetMetadata({
        operation: 'budgets.archive',
        id: before.id,
        archived: true,
      });
      expect(await api.applyBudgetMetadata(noop)).toMatchObject({
        status: 'committed-local',
        changed: false,
      });
      await expect(
        api.previewBudgetMetadata({
          operation: 'budgets.rename',
          id: before.id,
          name: '',
        }),
      ).rejects.toThrow();
      await expect(
        api.previewBudgetMetadata({
          operation: 'budgets.archive',
          id: 'another-budget',
          archived: false,
        }),
      ).rejects.toThrow();
    } finally {
      await api.archiveBudget(before.archived);
    }
  });
});

describe('guarded account creation', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
    global.currentMonth = '2023-10';
  });
  test('account creation previews without writes and acknowledges actual account, payee and opening identities', async () => {
    const before = {
      accounts: await api.getAccounts(),
      payees: await api.getPayees(),
      budget: await api.getBudgetMonth('2023-10'),
    };
    const proposal = await api.previewAccountCreation({
      name: 'Guarded cash',
      offbudget: false,
      initialBalance: -12345,
    });
    expect(proposal.after.openingTransaction).toMatchObject({
      amount: -12345,
      cleared: true,
    });
    expect({
      accounts: await api.getAccounts(),
      payees: await api.getPayees(),
      budget: await api.getBudgetMonth('2023-10'),
    }).toEqual(before);
    const outcome = await api.applyAccountCreation(proposal);
    expect(outcome.status).toBe('committed-local');
    if (outcome.status !== 'committed-local') {
      throw new Error('Creation was rejected');
    }
    const proof = outcome.accountCreation;
    expect(proof.accountId).toBeTruthy();
    expect(
      (await api.getPayees()).find(row => row.id === proof.transferPayeeId),
    ).toMatchObject({ transfer_acct: proof.accountId });
    const rows = await api.getTransactions(
      proof.accountId,
      '2000-01-01',
      '2030-12-31',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: proof.openingTransactionId,
        account: proof.accountId,
        amount: -12345,
        date: proposal.after.openingTransaction?.date,
        cleared: true,
        starting_balance_flag: true,
        payee: proof.startingBalancePayeeId,
      }),
    ]);
    expect(await api.applyAccountCreation(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });
  test('zero/off-budget account creation preserves canonical opening behavior and rejects changed date, source or identity', async () => {
    const request = {
      name: 'Tracking cash',
      offbudget: true,
      initialBalance: 32100,
    };
    const proposal = await api.previewAccountCreation(request);
    expect(proposal.after.openingTransaction?.categoryId).toBeNull();
    const clock = vi
      .spyOn(monthUtils, 'currentDay')
      .mockReturnValue('2099-02-02');
    try {
      expect(await api.applyAccountCreation(proposal)).toMatchObject({
        status: 'rejected',
        code: 'STALE_PREVIEW',
      });
    } finally {
      clock.mockRestore();
    }
    expect(
      await api.applyAccountCreation({
        ...proposal,
        budget: { ...proposal.budget, id: 'another' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    expect(
      await api.applyAccountCreation({
        ...proposal,
        after: {
          ...proposal.after,
          openingTransaction: {
            ...proposal.after.openingTransaction!,
            date: '2000-01-01',
          },
        },
      }),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    await api.createAccount({ name: 'Concurrent cash' }, 0);
    expect(await api.applyAccountCreation(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const fresh = await api.previewAccountCreation(request);
    const outcome = await api.applyAccountCreation(fresh);
    if (outcome.status !== 'committed-local') {
      throw new Error('Creation was rejected');
    }
    expect(
      await api.getAccountBalance(
        outcome.accountCreation.accountId,
        new Date('2030-12-31'),
      ),
    ).toBe(32100);
    const zero = await api.previewAccountCreation({
      name: 'Empty cash',
      offbudget: false,
      initialBalance: 0,
    });
    expect(zero.after.openingTransaction).toBeNull();
    const empty = await api.applyAccountCreation(zero);
    if (empty.status !== 'committed-local') {
      throw new Error('Creation was rejected');
    }
    expect(empty.accountCreation.openingTransactionId).toBeNull();
    expect(empty.accountCreation.startingBalancePayeeId).toBeNull();
    await expect(
      api.previewAccountCreation({
        name: ' ',
        offbudget: false,
        initialBalance: 0,
      }),
    ).rejects.toThrow();
    await expect(
      api.previewAccountCreation({
        name: 'Bad cash',
        offbudget: false,
        initialBalance: 1.5,
      }),
    ).rejects.toThrow();
  });
});

describe('guarded account reopening', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews without writes and reopens only visibility through the canonical owner', async () => {
    const id = await api.createAccount(
      { name: 'Closed tracking cash', offbudget: true, closed: true },
      -12345,
    );
    const before = (await api.getAccounts()).find(account => account.id === id);
    const payees = await api.getPayees();
    const transactions = await api.getTransactions(
      id,
      '2000-01-01',
      '2030-12-31',
    );
    const proposal = await api.previewAccountReopen({ id });
    expect(
      (await api.getAccounts()).find(account => account.id === id),
    ).toEqual(before);
    expect(await api.getPayees()).toEqual(payees);
    expect(await api.getTransactions(id, '2000-01-01', '2030-12-31')).toEqual(
      transactions,
    );
    expect(proposal.before.account.closed).toBe(true);
    expect(proposal.after.account).toEqual({
      ...proposal.before.account,
      closed: false,
    });
    expect(proposal.after.transferPayees).toEqual(
      proposal.before.transferPayees,
    );
    expect(await api.applyAccountReopen(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect(
      (await api.getAccounts()).find(account => account.id === id),
    ).toEqual({ ...before, closed: false });
    expect(await api.getPayees()).toEqual(payees);
    expect(await api.getTransactions(id, '2000-01-01', '2030-12-31')).toEqual(
      transactions,
    );
    expect(await api.getAccountBalance(id, new Date('2030-12-31'))).toBe(
      -12345,
    );
    expect(await api.applyAccountReopen(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const noChange = await api.previewAccountReopen({ id });
    expect(await api.applyAccountReopen(noChange)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
  });
  test('rejects stale ledger, missing accounts, wrong identities and tampered consequences', async () => {
    const id = await api.createAccount(
      { name: 'Reopen source', closed: true },
      0,
    );
    const proposal = await api.previewAccountReopen({ id });
    expect(
      await api.applyAccountReopen({
        ...proposal,
        budget: { ...proposal.budget, id: 'other-budget' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    expect(
      await api.applyAccountReopen({
        ...proposal,
        after: {
          ...proposal.after,
          account: { ...proposal.after.account, name: 'Tampered' },
        },
      }),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    await api.addTransactions(id, [{ date: '2026-08-01', amount: -111 }]);
    expect(await api.applyAccountReopen(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      (await api.getAccounts()).find(account => account.id === id),
    ).toMatchObject({ closed: true, name: 'Reopen source' });
    await expect(api.previewAccountReopen({ id: 'missing' })).rejects.toThrow();
    await expect(api.previewAccountReopen({ id: '' })).rejects.toThrow();
    await expect(
      // @ts-expect-error runtime validation rejects extra fields
      api.previewAccountReopen({ id, fields: { closed: false } }),
    ).rejects.toThrow();
    await api.reopenAccount(id);
    const fresh = await api.previewAccountReopen({ id });
    await api.deleteAccount(id);
    expect((await api.getAccounts()).some(account => account.id === id)).toBe(
      false,
    );
    expect(await api.applyAccountReopen(fresh)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });
});

describe('guarded account deletion', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews exact deletion and counterpart updates without writes and acknowledges actual IDs', async () => {
    const id = await api.createAccount({ name: 'Delete source' }, -5000);
    const destination = await api.createAccount(
      { name: 'Delete destination' },
      0,
    );
    const transferPayee = (await api.getPayees()).find(
      payee => payee.transfer_acct === destination,
    );
    if (!transferPayee) {
      throw new Error('Missing fixture transfer payee');
    }
    await api.addTransactions(
      id,
      [
        {
          date: '2026-10-01',
          amount: -900,
          payee: transferPayee.id,
        },
      ],
      { runTransfers: true },
    );
    const accounts = await api.getAccounts();
    const payees = await api.getPayees();
    const rows = await api.getTransactions(id, '2000-01-01', '2100-01-01');
    const counterpart = (
      await api.getTransactions(destination, '2000-01-01', '2100-01-01')
    )[0];
    const proposal = await api.previewAccountDeletion({ id });
    expect(proposal.after.action).toBe('deleted');
    expect(proposal.after.deletedTransactionIds.sort()).toEqual(
      rows.map(row => row.id).sort(),
    );
    expect(proposal.after.updatedTransactionIds).toEqual([counterpart.id]);
    expect(await api.getAccounts()).toEqual(accounts);
    expect(await api.getPayees()).toEqual(payees);
    expect(await api.getTransactions(id, '2000-01-01', '2100-01-01')).toEqual(
      rows,
    );
    const outcome = await api.applyAccountDeletion(proposal);
    expect(outcome).toMatchObject({
      status: 'committed-local',
      changed: true,
      accountClosure: {
        action: 'deleted',
        accountId: id,
        unlink: { localChanged: false, remoteStatus: 'not-required' },
      },
    });
    expect((await api.getAccounts()).some(account => account.id === id)).toBe(
      false,
    );
    expect(await api.getTransactions(id, '2000-01-01', '2100-01-01')).toEqual(
      [],
    );
    expect(
      (await api.getTransactions(destination, '2000-01-01', '2100-01-01'))[0],
    ).toEqual({ ...counterpart, payee: null, transfer_id: null });
    expect(await api.applyAccountDeletion(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects stale or tampered deletion and preserves canonical closed-account no-op', async () => {
    const id = await api.createAccount(
      { name: 'Closed delete', closed: true },
      -1234,
    );
    const proposal = await api.previewAccountDeletion({ id });
    expect(proposal.after.action).toBe('unchanged');
    expect(
      await api.applyAccountDeletion({
        ...proposal,
        budget: { ...proposal.budget, id: 'other' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    expect(
      await api.applyAccountDeletion({
        ...proposal,
        after: { ...proposal.after, action: 'deleted' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    expect(await api.applyAccountDeletion(proposal)).toMatchObject({
      status: 'committed-local',
      changed: false,
      accountClosure: { action: 'unchanged' },
    });
    await api.addTransactions(id, [{ date: '2026-10-01', amount: 25 }]);
    expect(await api.applyAccountDeletion(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      (await api.getAccounts()).find(account => account.id === id),
    ).toMatchObject({ closed: true });
    await expect(
      api.previewAccountDeletion({ id: 'missing' }),
    ).rejects.toThrow();
    await expect(api.previewAccountDeletion({ id: '' })).rejects.toThrow();
    await expect(
      // @ts-expect-error runtime validation rejects extra deletion fields
      api.previewAccountDeletion({ id, forced: false }),
    ).rejects.toThrow();
  });
});

describe('guarded account updates', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('preview preserves ledger and references and canonical apply keeps omitted fields', async () => {
    const id = await api.createAccount({ name: 'Update cash' }, -12345);
    const group = await api.createAccountGroup({ name: 'Update group' });
    const accounts = await api.getAccounts();
    const payees = await api.getPayees();
    const transactions = await api.getTransactions(
      id,
      '2000-01-01',
      '2030-12-31',
    );
    const proposal = await api.previewAccountUpdate({
      id,
      fields: {
        name: 'Renamed cash',
        offbudget: true,
        account_group_id: group,
        balance_current: -555,
      },
    });
    expect(await api.getAccounts()).toEqual(accounts);
    expect(await api.getPayees()).toEqual(payees);
    expect(await api.getTransactions(id, '2000-01-01', '2030-12-31')).toEqual(
      transactions,
    );
    expect(proposal.before.account).toMatchObject({
      name: 'Update cash',
      offbudget: false,
      closed: false,
    });
    expect(proposal.after.account).toMatchObject({
      id,
      name: 'Renamed cash',
      offbudget: true,
      closed: false,
      account_group_id: group,
      balance_current: -555,
    });
    expect(await api.applyAccountUpdate(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getAccounts()).find(row => row.id === id)).toEqual(
      proposal.after.account,
    );
    expect(await api.getAccountBalance(id, new Date('2030-12-31'))).toBe(
      -12345,
    );
    expect(await api.getPayees()).toEqual(
      payees.map(payee =>
        payee.transfer_acct === id ? { ...payee, name: 'Renamed cash' } : payee,
      ),
    );
    expect(proposal.after.transferPayees).toEqual(
      proposal.before.transferPayees.map(payee => ({
        ...payee,
        name: 'Renamed cash',
      })),
    );
    expect(await api.getTransactions(id, '2000-01-01', '2030-12-31')).toEqual(
      transactions,
    );
    expect(await api.applyAccountUpdate(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const noChange = await api.previewAccountUpdate({
      id,
      fields: { name: 'Renamed cash' },
    });
    expect(await api.applyAccountUpdate(noChange)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
    const clear = await api.previewAccountUpdate({
      id,
      fields: { closed: true, balance_current: null, account_group_id: null },
    });
    expect(await api.applyAccountUpdate(clear)).toMatchObject({
      status: 'committed-local',
    });
    expect((await api.getAccounts()).find(row => row.id === id)).toMatchObject({
      closed: true,
      balance_current: null,
      account_group_id: null,
      name: 'Renamed cash',
      offbudget: true,
    });
    expect(await api.getTransactions(id, '2000-01-01', '2030-12-31')).toEqual(
      transactions,
    );
  });
  test('rejects stale ledger, deleted groups, wrong identities, and tampered account consequences', async () => {
    const id = await api.createAccount({ name: 'Guarded update source' }, 0);
    const group = await api.createAccountGroup({
      name: 'Guarded destination group',
    });
    const proposal = await api.previewAccountUpdate({
      id,
      fields: {
        name: 'Intended name',
        offbudget: true,
        account_group_id: group,
      },
    });
    expect(
      await api.applyAccountUpdate({
        ...proposal,
        budget: { ...proposal.budget, id: 'other-budget' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    expect(
      await api.applyAccountUpdate({
        ...proposal,
        after: {
          ...proposal.after,
          account: { ...proposal.after.account, name: 'Tampered' },
        },
      }),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    await api.addTransactions(id, [{ date: '2026-08-01', amount: -111 }]);
    expect(await api.applyAccountUpdate(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const fresh = await api.previewAccountUpdate(proposal.request);
    await api.deleteAccountGroup(group);
    expect(await api.applyAccountUpdate(fresh)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect((await api.getAccounts()).find(row => row.id === id)).toMatchObject({
      name: 'Guarded update source',
      offbudget: false,
      account_group_id: null,
    });
    for (const fields of [
      {},
      { name: ' ' },
      { offbudget: 'true' },
      { balance_current: 1.5 },
      { account_group_id: 'missing' },
      { id: 'override' },
      { unknown: true },
    ]) {
      // Runtime payload validation also covers clients without TypeScript.
      // @ts-expect-error invalid runtime field types
      await expect(api.previewAccountUpdate({ id, fields })).rejects.toThrow();
    }
    await expect(
      api.previewAccountUpdate({ id: 'missing', fields: { name: 'Valid' } }),
    ).rejects.toThrow();
  });
});

describe('guarded account opening references', () => {
  test('preview never creates a missing starting balance payee and acknowledged IDs identify its actual creation', async () => {
    await api.loadBudget(budgetName);
    const existing = (await api.getPayees()).find(
      row => row.name.toLowerCase() === 'starting balance',
    );
    if (existing) await api.deletePayee(existing.id);
    const before = await api.getPayees();
    const proposal = await api.previewAccountCreation({
      name: 'Closed opening cash',
      closed: true,
      offbudget: false,
      initialBalance: 1234,
    });
    expect(proposal.after.openingTransaction).toMatchObject({
      createsPayee: true,
      payeeId: null,
    });
    expect(await api.getPayees()).toEqual(before);
    const outcome = await api.applyAccountCreation(proposal);
    if (outcome.status !== 'committed-local') {
      throw new Error('Creation was rejected');
    }
    const proof = outcome.accountCreation;
    expect(
      (await api.getPayees()).find(
        row => row.id === proof.startingBalancePayeeId,
      ),
    ).toMatchObject({ name: 'Starting Balance' });
    expect(
      (await api.getAccounts()).find(row => row.id === proof.accountId),
    ).toMatchObject({ closed: true, name: 'Closed opening cash' });
  });
});

describe('guarded budget holds', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
    global.currentMonth = '2023-10';
  });
  test('hold preview preserves state and uses the engine clamp before reset', async () => {
    const account = await api.createAccount({ name: 'Guarded hold funds' }, 0);
    const income = (await api.getCategories()).find(row => row.is_income);
    if (!income) {
      throw new Error('Hold fixture needs an income category');
    }
    await api.addTransactions(account, [
      { date: '2023-10-01', amount: 1000000, category: income.id },
    ]);
    const before = await api.getBudgetMonth('2023-10');
    expect(before.toBudget).toBeGreaterThan(0);
    const proposal = await api.previewBudgetHold({
      operation: 'budgets.hold-next-month',
      month: '2023-10',
      amount: Number.MAX_SAFE_INTEGER,
    });
    expect(await api.getBudgetMonth('2023-10')).toEqual(before);
    expect(proposal.after.buffered).toBe(before.forNextMonth + before.toBudget);
    expect(await api.applyBudgetHold(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    expect((await api.getBudgetMonth('2023-10')).forNextMonth).toBe(
      proposal.after.buffered,
    );
    expect(await api.applyBudgetHold(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const reset = await api.previewBudgetHold({
      operation: 'budgets.reset-hold',
      month: '2023-10',
    });
    expect(reset.after.buffered).toBe(0);
    expect(await api.applyBudgetHold(reset)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    expect((await api.getBudgetMonth('2023-10')).forNextMonth).toBe(0);
  });
  test('holds with no available funds acknowledge no change and reset preserves missing-row behavior', async () => {
    const category = (await api.getCategories()).find(row => !row.is_income);
    if (!category) {
      throw new Error('Hold fixture needs an expense category');
    }
    const categoryId = category.id;
    await api.setBudgetAmount('2023-10', categoryId, 1000000000);
    const hold = await api.previewBudgetHold({
      operation: 'budgets.hold-next-month',
      month: '2023-10',
      amount: 1000,
    });
    expect(hold.references.toBudget).toBeLessThanOrEqual(0);
    expect(hold.after.willWrite).toBe(false);
    expect(await api.applyBudgetHold(hold)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
    const reset = await api.previewBudgetHold({
      operation: 'budgets.reset-hold',
      month: '2023-12',
    });
    expect(await api.applyBudgetHold(reset)).toMatchObject({
      status: 'committed-local',
      changed: reset.before.row === null || reset.before.buffered !== 0,
    });
    const noOp = await api.previewBudgetHold({
      operation: 'budgets.reset-hold',
      month: '2023-12',
    });
    expect(noOp.before.row).not.toBeNull();
    expect(await api.applyBudgetHold(noOp)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
  });
  test('holds reject changed ledger inputs, wrong identity, mode and malformed requests', async () => {
    const hold = await api.previewBudgetHold({
      operation: 'budgets.hold-next-month',
      month: '2023-10',
      amount: 1000,
    });
    await api.createAccount({ name: 'Changed hold source' }, 0);
    expect(await api.applyBudgetHold(hold)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const reset = await api.previewBudgetHold({
      operation: 'budgets.reset-hold',
      month: '2023-10',
    });
    expect(
      await api.applyBudgetHold({
        ...reset,
        budget: { ...reset.budget, id: 'another' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    expect(
      await api.applyBudgetHold({
        ...reset,
        after: { buffered: 123, willWrite: true },
      }),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    await api.setPreference('budgetType', 'tracking');
    expect(await api.applyBudgetHold(reset)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewBudgetHold({
        operation: 'budgets.hold-next-month',
        month: '2023-10',
        amount: 0,
      }),
    ).rejects.toThrow();
    await expect(
      api.previewBudgetHold({
        operation: 'budgets.hold-next-month',
        month: '2023-10',
        amount: 1.5,
      }),
    ).rejects.toThrow();
    await expect(
      api.previewBudgetHold({
        operation: 'budgets.reset-hold',
        month: '2023-13',
      }),
    ).rejects.toThrow();
  });
});

describe('guarded allocation changes', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
    global.currentMonth = '2023-10';
  });
  test('carryover preview preserves rows and applies the complete future month range', async () => {
    const group = await api.createCategoryGroup({ name: 'Carryover scope' });
    const categoryId = await api.createCategory({
      name: 'Carryover scope',
      group_id: group,
    });
    await api.setBudgetAmount('2023-10', categoryId, 123);
    await api.setBudgetAmount('2023-12', categoryId, 456);
    const before = await api.getBudgetMonth('2023-12');
    const proposal = await api.previewBudgetCarryover({
      month: '2023-10',
      categoryId,
      flag: true,
    });
    expect(proposal.before.months.map(row => row.month)).toContain('2023-12');
    expect(await api.getBudgetMonth('2023-12')).toEqual(before);
    expect(await api.applyBudgetCarryover(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    for (const month of ['2023-10', '2023-12']) {
      const category = (await api.getBudgetMonth(month)).categoryGroups
        .flatMap(group => group.categories)
        .find(row => row?.id === categoryId);
      expect(category).toMatchObject({
        carryover: true,
        budgeted: month === '2023-10' ? 123 : 456,
      });
    }
    expect(await api.applyBudgetCarryover(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });
  test('carryover binds budget mode and preserves missing-row writer behavior', async () => {
    const group = await api.createCategoryGroup({ name: 'Carryover modes' });
    const categoryId = await api.createCategory({
      name: 'Carryover modes',
      group_id: group,
    });
    const original = await api.getPreferences();
    try {
      await api.setPreference('budgetType', 'envelope');
      const envelope = await api.previewBudgetCarryover({
        month: '2023-10',
        categoryId,
        flag: false,
      });
      expect(
        envelope.before.months.some(
          row => row.month === '2023-10' && row.row === null,
        ),
      ).toBe(true);
      await api.setPreference('budgetType', 'tracking');
      expect(await api.applyBudgetCarryover(envelope)).toMatchObject({
        status: 'rejected',
        code: 'STALE_PREVIEW',
      });
      const tracking = await api.previewBudgetCarryover({
        month: '2023-10',
        categoryId,
        flag: false,
      });
      expect(tracking.references).toMatchObject({ table: 'reflect_budgets' });
      expect(await api.applyBudgetCarryover(tracking)).toMatchObject({
        status: 'committed-local',
        changed: true,
      });
      const noOp = await api.previewBudgetCarryover({
        month: '2023-10',
        categoryId,
        flag: false,
      });
      expect(noOp.before.months.every(row => row.row !== null)).toBe(true);
      expect(await api.applyBudgetCarryover(noOp)).toMatchObject({
        status: 'committed-local',
        changed: false,
      });
    } finally {
      await api.setPreference('budgetType', original.budgetType ?? 'envelope');
    }
  });
  test('carryover rejects changed future rows and validates its entire proposal', async () => {
    const group = await api.createCategoryGroup({ name: 'Carryover stale' });
    const categoryId = await api.createCategory({
      name: 'Carryover stale',
      group_id: group,
    });
    await api.getBudgetMonth('2023-12');
    const proposal = await api.previewBudgetCarryover({
      month: '2023-10',
      categoryId,
      flag: true,
    });
    await api.setBudgetAmount('2023-12', categoryId, 789);
    expect(await api.applyBudgetCarryover(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const fresh = await api.previewBudgetCarryover({
      month: '2023-10',
      categoryId,
      flag: false,
    });
    expect(
      await api.applyBudgetCarryover({
        ...fresh,
        budget: { ...fresh.budget, id: 'another' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    expect(
      await api.applyBudgetCarryover({ ...fresh, after: { months: [] } }),
    ).toMatchObject({ status: 'rejected', code: 'STALE_PREVIEW' });
    await api.setBudgetAmount('2024-02', categoryId, 1);
    expect(await api.applyBudgetCarryover(fresh)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewBudgetCarryover({ month: '2023-13', categoryId, flag: true }),
    ).rejects.toThrow();
    await expect(
      api.previewBudgetCarryover({
        month: '2023-10',
        categoryId: 'missing',
        flag: true,
      }),
    ).rejects.toThrow();
  });
  test('previews a canonical allocation without writes and preserves carryover when applying', async () => {
    const group = await api.createCategoryGroup({ name: 'Guarded allocation' });
    const categoryId = await api.createCategory({
      name: 'Allocation category',
      group_id: group,
    });
    await api.setBudgetAmount('2023-10', categoryId, 100);
    await api.setBudgetCarryover('2023-10', categoryId, true);
    const before = await api.getBudgetMonth('2023-10');
    const proposal = await api.previewBudgetAmount({
      month: '2023-10',
      categoryId,
      amount: 275,
    });
    expect(proposal.operation).toBe('budgets.set-amount');
    expect(proposal.before.amount).toBe(100);
    expect(proposal.after.amount).toBe(275);
    expect(await api.getBudgetMonth('2023-10')).toEqual(before);
    expect(await api.applyBudgetAmount(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    const updated = (await api.getBudgetMonth('2023-10')).categoryGroups
      .flatMap(group => group.categories)
      .find(category => category?.id === categoryId);
    expect(updated).toMatchObject({ budgeted: 275, carryover: true });
    expect(await api.applyBudgetAmount(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects invalid inputs, changed allocation state, and another budget before a write', async () => {
    const group = await api.createCategoryGroup({ name: 'Allocation stale' });
    const categoryId = await api.createCategory({
      name: 'Allocation stale category',
      group_id: group,
    });
    const proposal = await api.previewBudgetAmount({
      month: '2023-10',
      categoryId,
      amount: -200,
    });
    expect(proposal.before.amount).toBe(0);
    expect(proposal.before.row).toBeNull();
    const noOp = await api.previewBudgetAmount({
      month: '2023-10',
      categoryId,
      amount: 0,
    });
    expect(await api.applyBudgetAmount(noOp)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
    expect(
      (
        await api.previewBudgetAmount({
          month: '2023-10',
          categoryId,
          amount: 0,
        })
      ).before.row,
    ).toBeNull();
    await api.setBudgetCarryover('2023-10', categoryId, true);
    expect(await api.applyBudgetAmount(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    expect(
      await api.applyBudgetAmount({
        ...proposal,
        budget: { ...proposal.budget, id: 'another' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'MISSING_CONTEXT' });
    await expect(
      api.previewBudgetAmount({ month: '2023-13', categoryId, amount: 12 }),
    ).rejects.toThrow();
    await expect(
      api.previewBudgetAmount({ month: '2023-10', categoryId, amount: 1.5 }),
    ).rejects.toThrow();
    await expect(
      api.previewBudgetAmount({
        month: '2023-10',
        categoryId: 'missing',
        amount: 12,
      }),
    ).rejects.toThrow();
  });
});

describe('guarded account closure', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test.each([false, true])(
    'previews canonical closing transfers and rules without writes (offbudget=%s)',
    async offbudget => {
      const id = await api.createAccount({ name: 'Closure source' }, 1000);
      const destination = await api.createAccount(
        { name: 'Closure destination', offbudget },
        200,
      );
      const category = (await api.getCategories()).find(row => !row.is_income);
      if (!category) {
        throw new Error('Missing category fixture');
      }
      await api.createRule({
        stage: null,
        conditionsOp: 'and',
        conditions: [
          { field: 'notes', op: 'contains', value: 'Closing account' },
        ],
        actions: [
          {
            op: 'set',
            field: 'notes',
            value: '',
            options: {
              formula:
                '=CONCATENATE("source=", BALANCE_OF("Closure source"), ";destination=", balance)',
            },
          },
          { op: 'set', field: 'cleared', value: true },
          { op: 'set', field: 'amount', value: 99999 },
        ],
      });
      const before = await api.getTransactions(id, '2000-01-01', '2100-01-01');
      const destinationBefore = await api.getTransactions(
        destination,
        '2000-01-01',
        '2100-01-01',
      );
      const accounts = await api.getAccounts();
      const proposal = await api.previewAccountClosure({
        id,
        transferAccountId: destination,
        categoryId: category.id,
      });
      expect(await api.getAccounts()).toEqual(accounts);
      expect(await api.getTransactions(id, '2000-01-01', '2100-01-01')).toEqual(
        before,
      );
      expect(
        await api.getTransactions(destination, '2000-01-01', '2100-01-01'),
      ).toEqual(destinationBefore);
      expect(proposal.after.action).toBe('closed');
      expect(proposal.after.counterpart).toMatchObject({
        amount: before.reduce((total, row) => total + row.amount, 0),
        notes: `source=0;destination=${destinationBefore.reduce((total, row) => total + row.amount, 0)}`,
        cleared: true,
      });
      expect(proposal.after.source?.category).toBe(
        offbudget ? category.id : null,
      );
      const outcome = await api.applyAccountClosure(proposal);
      expect(outcome).toMatchObject({
        status: 'committed-local',
        changed: true,
        accountClosure: { action: 'closed', accountId: id },
      });
      const actualSource = (
        await api.getTransactions(id, '2000-01-01', '2100-01-01')
      ).find(row => row.id === proposal.seed?.id);
      const actualCounterpart = (
        await api.getTransactions(destination, '2000-01-01', '2100-01-01')
      ).find(row => row.transfer_id === proposal.seed?.id);
      if (!proposal.after.source || !proposal.after.counterpart) {
        throw new Error('Missing closing-transfer proposal rows');
      }
      expect(actualSource).toMatchObject(proposal.after.source);
      expect(actualCounterpart).toMatchObject(proposal.after.counterpart);
      expect(outcome).toMatchObject({
        accountClosure: {
          addedTransactionIds: [actualSource?.id, actualCounterpart?.id],
        },
      });
      expect(await api.applyAccountClosure(proposal)).toMatchObject({
        status: 'rejected',
        code: 'STALE_PREVIEW',
      });
    },
  );
  test('preserves empty, zero-balance and already-closed behavior and rejects stale or malformed proposals', async () => {
    const empty = await api.createAccount({ name: 'Empty close' });
    const emptyProposal = await api.previewAccountClosure({ id: empty });
    expect(emptyProposal.after).toMatchObject({
      action: 'deleted',
      source: null,
      counterpart: null,
    });
    expect(await api.applyAccountClosure(emptyProposal)).toMatchObject({
      accountClosure: { action: 'deleted' },
    });
    const id = await api.createAccount({ name: 'Zero close' });
    await api.addTransactions(id, [{ date: '2026-10-01', amount: 0 }]);
    const proposal = await api.previewAccountClosure({ id });
    expect(proposal.after).toMatchObject({
      action: 'closed',
      source: null,
      counterpart: null,
    });
    expect(
      await api.applyAccountClosure({
        ...proposal,
        after: { ...proposal.after, action: 'deleted' },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    expect(
      await api.applyAccountClosure({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    await api.addTransactions(id, [{ date: '2099-01-01', amount: 1 }]);
    expect(await api.applyAccountClosure(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(api.previewAccountClosure({ id })).rejects.toThrow();
    await expect(
      api.previewAccountClosure({ id, transferAccountId: id }),
    ).rejects.toThrow();
    const closed = await api.createAccount(
      { name: 'Already closed', closed: true },
      123,
    );
    const closedProposal = await api.previewAccountClosure({ id: closed });
    expect(closedProposal.after.action).toBe('unchanged');
    expect(await api.applyAccountClosure(closedProposal)).toMatchObject({
      changed: false,
      accountClosure: { action: 'unchanged' },
    });
    await expect(api.previewAccountClosure({ id: '' })).rejects.toThrow();
    await expect(
      api.previewAccountClosure({ id: 'missing' }),
    ).rejects.toThrow();
    await expect(
      // @ts-expect-error forced deletion is a separate public operation
      api.previewAccountClosure({ id, forced: true }),
    ).rejects.toThrow();
  });
});

describe('partial category updates', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('updates hidden, group and income without requiring a name or changing unrelated fields', async () => {
    const group = await api.createCategoryGroup({
      name: 'Partial source',
      is_income: false,
    });
    const destination = await api.createCategoryGroup({
      name: 'Partial destination',
      is_income: false,
    });
    const id = await api.createCategory({
      name: 'Unchanged category',
      group_id: group,
      is_income: false,
      hidden: false,
    });
    const before = await api.getCategories();
    await api.updateCategory(id, { hidden: true });
    expect(await api.getCategories()).toEqual(
      before.map(row => (row.id === id ? { ...row, hidden: true } : row)),
    );
    await api.updateCategory(id, { group_id: destination });
    const moved = (await api.getCategories()).find(row => row.id === id);
    expect(moved).toMatchObject({
      name: 'Unchanged category',
      group_id: destination,
      hidden: true,
      is_income: false,
    });
    await api.updateCategory(id, { is_income: true });
    expect(
      (await api.getCategories()).find(row => row.id === id),
    ).toMatchObject({ ...moved, is_income: true });
    await api.updateCategory(id, { name: '  Trimmed category  ' });
    expect((await api.getCategories()).find(row => row.id === id)?.name).toBe(
      'Trimmed category',
    );
  });
});

describe('guarded category updates', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews the complete public field scope without writes and acknowledges canonical updates', async () => {
    const group = await api.createCategoryGroup({
      name: 'Guarded categories',
      is_income: false,
    });
    const destination = await api.createCategoryGroup({
      name: 'Guarded destination',
      is_income: false,
    });
    const id = await api.createCategory({
      name: 'Before guarded category',
      group_id: group,
      hidden: false,
      is_income: false,
    });
    const before = await api.getCategories();
    const proposal = await api.previewCategoryUpdate({
      id,
      fields: {
        name: '  After guarded category  ',
        group_id: destination,
        hidden: true,
        is_income: true,
      },
    });
    expect(await api.getCategories()).toEqual(before);
    expect(proposal.after).toMatchObject({
      id,
      name: 'After guarded category',
      cat_group: destination,
      hidden: 1,
      is_income: 1,
    });
    expect(await api.applyCategoryUpdate(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getCategories()).find(row => row.id === id)).toEqual({
      id,
      name: 'After guarded category',
      group_id: destination,
      hidden: true,
      is_income: true,
    });
    expect(await api.applyCategoryUpdate(proposal)).toMatchObject({
      status: 'rejected',
      code: 'STALE_PREVIEW',
    });
    const unchanged = await api.previewCategoryUpdate({
      id,
      fields: { hidden: true },
    });
    expect(await api.applyCategoryUpdate(unchanged)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
  });
  test('rejects malformed, stale, tampered and wrong-budget updates before writing', async () => {
    const group = await api.createCategoryGroup({
      name: 'Stale categories',
      is_income: false,
    });
    const id = await api.createCategory({
      name: 'Unchanged guarded',
      group_id: group,
      hidden: false,
      is_income: false,
    });
    const proposal = await api.previewCategoryUpdate({
      id,
      fields: { hidden: true },
    });
    expect(
      await api.applyCategoryUpdate({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyCategoryUpdate({
        ...proposal,
        after: { ...proposal.after, name: 'tampered' },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    await api.updateCategory(id, { name: 'Changed after preview' });
    expect(await api.applyCategoryUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect((await api.getCategories()).find(row => row.id === id)?.hidden).toBe(
      false,
    );
    await expect(
      api.previewCategoryUpdate({ id, fields: {} }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryUpdate({ id, fields: { name: ' ' } }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryUpdate({ id, fields: { group_id: 'missing' } }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryUpdate({ id: 'missing', fields: { hidden: true } }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryUpdate({ id, fields: { id: 'other' } }),
    ).rejects.toThrow();
  });
});

describe('guarded category creation', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews canonical creation without writes and acknowledges generated category and mapping identities', async () => {
    const group = await api.createCategoryGroup({
      name: 'Guarded creation group',
      is_income: false,
    });
    const before = await api.getCategories();
    const proposal = await api.previewCategoryCreation({
      name: '  Guarded new category  ',
      group_id: group,
      hidden: true,
      is_income: false,
    });
    expect(await api.getCategories()).toEqual(before);
    expect(proposal.after.category).toMatchObject({
      name: 'Guarded new category',
      cat_group: group,
      hidden: 1,
      is_income: 0,
    });
    const outcome = await api.applyCategoryCreation(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    if (outcome.status !== 'committed-local') {
      throw new Error('Creation did not commit');
    }
    expect(outcome.categoryCreation.categoryId).toBeTruthy();
    expect(outcome.categoryCreation.mappingId).toBe(
      outcome.categoryCreation.categoryId,
    );
    expect(
      (await api.getCategories()).find(
        row => row.id === outcome.categoryCreation.categoryId,
      ),
    ).toEqual({
      id: outcome.categoryCreation.categoryId,
      name: 'Guarded new category',
      group_id: group,
      hidden: true,
      is_income: false,
    });
    expect(await api.applyCategoryCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewCategoryCreation({
        name: 'guarded NEW CATEGORY',
        group_id: group,
      }),
    ).rejects.toThrow('already exists');
  });
  test('binds destination/source state and rejects malformed or tampered proposals before creation', async () => {
    const group = await api.createCategoryGroup({
      name: 'Creation stale group',
      is_income: false,
    });
    const proposal = await api.previewCategoryCreation({
      name: 'Default flags',
      group_id: group,
    });
    expect(proposal.after.category).toMatchObject({ hidden: 0, is_income: 0 });
    const before = await api.getCategories();
    expect(
      await api.applyCategoryCreation({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyCategoryCreation({
        ...proposal,
        after: {
          ...proposal.after,
          category: { ...proposal.after.category, name: 'tampered' },
        },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    expect(await api.getCategories()).toEqual(before);
    await api.createCategory({ name: 'Changed ordering', group_id: group });
    expect(await api.applyCategoryCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewCategoryCreation({ name: ' ', group_id: group }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryCreation({
        name: 'Missing group',
        group_id: 'missing',
      }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryCreation({ name: 'Missing ID', group_id: '' }),
    ).rejects.toThrow();
  });
});

describe('guarded category deletion', () => {
  beforeEach(async () => {
    global.currentMonth = '2023-10';
    await api.loadBudget(budgetName);
  });
  test.each([false, true])(
    'previews and applies canonical mappings and allocations for income=%s',
    async is_income => {
      const group = await api.createCategoryGroup({
        name: 'Deletion group',
        is_income,
      });
      const source = await api.createCategory({
        name: 'Deletion source',
        group_id: group,
        is_income,
      });
      const target = await api.createCategory({
        name: 'Deletion target',
        group_id: group,
        is_income,
      });
      const forwarder = await api.createCategory({
        name: 'Old forwarder',
        group_id: group,
        is_income,
      });
      const account = await api.createAccount({ name: 'Deletion ledger' }, 0);
      await api.addTransactions(account, [
        {
          date: '2023-10-02',
          amount: -50,
          category: forwarder,
          notes: 'Preserve ledger',
        },
      ]);
      await api.deleteCategory(forwarder, source);
      await api.setBudgetAmount('2023-10', source, 700);
      await api.setBudgetAmount('2023-10', target, 300);
      if (!is_income) await api.setBudgetCarryover('2023-10', target, true);
      const before = {
        categories: await api.getCategories(),
        month: await api.getBudgetMonth('2023-10'),
        transactions: await api.getTransactions(
          account,
          '2023-10-01',
          '2023-10-31',
        ),
      };
      const proposal = await api.previewCategoryDeletion({
        id: source,
        transferCategoryId: target,
      });
      expect(proposal.after.category).toMatchObject({
        id: source,
        tombstone: 1,
      });
      expect(proposal.after.mappings).toEqual(
        expect.arrayContaining([
          { id: forwarder, transferId: target },
          { id: source, transferId: target },
        ]),
      );
      const october = proposal.after.budgetTransfers.find(
        row => row.month === '2023-10',
      );
      expect(october?.amount).toBe(is_income ? undefined : 1000);
      expect(
        proposal.sideEffects.some(effect =>
          effect.startsWith('transfer expense allocations'),
        ),
      ).toBe(!is_income);
      expect(await api.getCategories()).toEqual(before.categories);
      expect(await api.getBudgetMonth('2023-10')).toEqual(before.month);
      expect(
        await api.getTransactions(account, '2023-10-01', '2023-10-31'),
      ).toEqual(before.transactions);
      expect(await api.applyCategoryDeletion(proposal)).toMatchObject({
        status: 'committed-local',
        changed: true,
        affectedIds: expect.arrayContaining([source, forwarder]),
      });
      expect((await api.getCategories()).some(row => row.id === source)).toBe(
        false,
      );
      expect(
        await api.getTransactions(account, '2023-10-01', '2023-10-31'),
      ).toEqual(before.transactions.map(row => ({ ...row, category: target })));
      if (!is_income) {
        const month = await api.getBudgetMonth('2023-10');
        expect(
          month.categoryGroups
            .flatMap(row => row.categories)
            .find(row => row?.id === target),
        ).toMatchObject({ budgeted: 1000, carryover: true });
      }
      expect(await api.applyCategoryDeletion(proposal)).toMatchObject({
        code: 'STALE_PREVIEW',
      });
    },
  );
  test('binds complete source state and rejects invalid targets, wrong identity and tampering before writes', async () => {
    const group = await api.createCategoryGroup({
      name: 'Deletion validation',
    });
    const source = await api.createCategory({
      name: 'Source',
      group_id: group,
    });
    const target = await api.createCategory({
      name: 'Target',
      group_id: group,
    });
    const income = await api.createCategory({
      name: 'Income target',
      group_id: group,
      is_income: true,
    });
    const proposal = await api.previewCategoryDeletion({
      id: source,
      transferCategoryId: target,
    });
    const before = await api.getCategories();
    expect(
      await api.applyCategoryDeletion({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyCategoryDeletion({
        ...proposal,
        after: {
          ...proposal.after,
          category: { ...proposal.after.category, hidden: 1 },
        },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    for (const request of [
      { id: '' },
      { id: 'missing' },
      { id: source, transferCategoryId: source },
      { id: source, transferCategoryId: income },
      { id: source, transferCategoryId: 'missing' },
    ]) {
      await expect(api.previewCategoryDeletion(request)).rejects.toThrow();
    }
    expect(await api.getCategories()).toEqual(before);
    await api.setBudgetAmount('2023-10', source, 1);
    expect(await api.applyCategoryDeletion(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await api.deleteCategory(target);
    await expect(
      api.previewCategoryDeletion({ id: source, transferCategoryId: target }),
    ).rejects.toThrow();
    const withoutTransfer = await api.previewCategoryDeletion({ id: source });
    expect(withoutTransfer.after.mappings).toEqual([]);
    expect(withoutTransfer.after.budgetTransfers).toEqual([]);
    expect(withoutTransfer.sideEffects).toHaveLength(1);
    expect(await api.applyCategoryDeletion(withoutTransfer)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
  });
});

test('public category group creation preserves declared income and hidden flags', async () => {
  await api.loadBudget(budgetName);
  const id = await api.createCategoryGroup({
    name: 'Public income group',
    is_income: true,
    hidden: true,
  });
  expect(
    (await api.getCategoryGroups()).find(group => group.id === id),
  ).toEqual({
    id,
    name: 'Public income group',
    is_income: true,
    hidden: true,
    categories: [],
  });
  await api.updateCategoryGroup(id, { hidden: false });
  expect(
    (await api.getCategoryGroups()).find(group => group.id === id),
  ).toMatchObject({
    name: 'Public income group',
    is_income: true,
    hidden: false,
  });
});

describe('guarded category group creation', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('preserves full creation flags and existing child-input semantics with actual generated identity', async () => {
    const categories = await api.getCategories();
    const children = [
      {
        id: 'ignored-child',
        name: 'Ignored child',
        group_id: 'ignored-group',
        is_income: true,
        hidden: true,
      },
    ];
    const legacy = await api.createCategoryGroup({
      name: 'Legacy child semantics',
      categories: children,
    });
    expect(
      (await api.getCategoryGroups()).find(row => row.id === legacy)
        ?.categories,
    ).toEqual([]);
    expect(await api.getCategories()).toEqual(categories);
    const before = await api.getCategoryGroups();
    const proposal = await api.previewCategoryGroupCreation({
      name: '  Exact group name  ',
      is_income: true,
      hidden: true,
      categories: children,
    });
    expect(await api.getCategoryGroups()).toEqual(before);
    expect(await api.getCategories()).toEqual(categories);
    expect(proposal.after.group).toMatchObject({
      name: '  Exact group name  ',
      is_income: 1,
      hidden: 1,
    });
    const outcome = await api.applyCategoryGroupCreation(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local', changed: true });
    if (outcome.status !== 'committed-local') {
      throw new Error('Group creation did not commit');
    }
    expect(outcome.groupCreation.groupId).toBeTruthy();
    expect(outcome.affectedIds).toEqual([outcome.groupCreation.groupId]);
    expect(
      (await api.getCategoryGroups()).find(
        row => row.id === outcome.groupCreation.groupId,
      ),
    ).toEqual({
      id: outcome.groupCreation.groupId,
      name: '  Exact group name  ',
      is_income: true,
      hidden: true,
      categories: [],
    });
    expect(await api.getCategories()).toEqual(categories);
    expect(await api.applyCategoryGroupCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewCategoryGroupCreation({ name: '  EXACT GROUP NAME  ' }),
    ).rejects.toThrow('already exists');
  });
  test('rejects wrong identity, tampered order, malformed requests and changed source before writes', async () => {
    const proposal = await api.previewCategoryGroupCreation({
      name: 'Default group flags',
    });
    expect(proposal.after.group).toMatchObject({ is_income: 0, hidden: 0 });
    const before = await api.getCategoryGroups();
    expect(
      await api.applyCategoryGroupCreation({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyCategoryGroupCreation({
        ...proposal,
        after: { group: { ...proposal.after.group, sort_order: -1 } },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    expect(await api.getCategoryGroups()).toEqual(before);
    await api.createCategoryGroup({ name: 'Changed group order' });
    expect(await api.applyCategoryGroupCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewCategoryGroupCreation({ name: ' ' }),
    ).rejects.toThrow();
    await expect(
      api.previewCategoryGroupCreation({ name: '' }),
    ).rejects.toThrow();
  });
});

describe('guarded category group updates', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews full declared group fields and preserves child categories through the canonical owner', async () => {
    const id = await api.createCategoryGroup({
      name: 'Update owner group',
      is_income: true,
    });
    const child = await api.createCategory({
      name: 'Preserved child',
      group_id: id,
      is_income: true,
    });
    const categories = (await api.getCategories()).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const groups = await api.getCategoryGroups();
    const fields = {
      id,
      name: '  Exact updated name  ',
      hidden: true,
      is_income: false,
      categories: [
        {
          id: child,
          name: 'Ignored child rename',
          group_id: 'ignored-group',
          is_income: false,
          hidden: true,
        },
      ],
    };
    const proposal = await api.previewCategoryGroupUpdate({ id, fields });
    expect(await api.getCategoryGroups()).toEqual(groups);
    expect(
      (await api.getCategories()).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(categories);
    expect(proposal.after).toMatchObject({
      id,
      name: fields.name,
      hidden: 1,
      is_income: 0,
    });
    expect(await api.applyCategoryGroupUpdate(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect(
      (await api.getCategories()).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(categories);
    expect(
      (await api.getCategoryGroups()).find(row => row.id === id),
    ).toMatchObject({ id, name: fields.name, hidden: true, is_income: false });
    expect(await api.applyCategoryGroupUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await api.updateCategoryGroup(id, { categories: fields.categories });
    expect(
      (await api.getCategories()).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(categories);
    const noOp = await api.previewCategoryGroupUpdate({
      id,
      fields: { hidden: true },
    });
    expect(await api.applyCategoryGroupUpdate(noOp)).toMatchObject({
      status: 'committed-local',
      changed: false,
    });
  });
  test('rejects duplicate names, invalid fields and changed source before writing', async () => {
    const id = await api.createCategoryGroup({
      name: 'Validated update group',
    });
    const duplicate = await api.createCategoryGroup({
      name: 'Existing duplicate',
    });
    const proposal = await api.previewCategoryGroupUpdate({
      id,
      fields: { hidden: true },
    });
    const before = await api.getCategoryGroups();
    expect(
      await api.applyCategoryGroupUpdate({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyCategoryGroupUpdate({
        ...proposal,
        after: { ...proposal.after, name: 'tampered' },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    for (const request of [
      { id, fields: {} },
      { id, fields: { id: 'wrong' } },
      { id, fields: { name: ' ' } },
      { id: 'missing', fields: { hidden: true } },
      { id, fields: { name: 'EXISTING DUPLICATE' } },
    ]) {
      await expect(api.previewCategoryGroupUpdate(request)).rejects.toThrow();
    }
    expect(await api.getCategoryGroups()).toEqual(before);
    await api.updateCategoryGroup(duplicate, { hidden: true });
    expect(await api.applyCategoryGroupUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
});

describe('guarded category group deletion', () => {
  beforeEach(async () => {
    global.currentMonth = '2023-10';
    await api.loadBudget(budgetName);
  });
  test.each([false, true])(
    'preserves canonical child mappings and live allocations for income=%s',
    async is_income => {
      const group = await api.createCategoryGroup({
        name: 'Guarded group deletion',
        is_income,
      });
      const destination = await api.createCategoryGroup({
        name: 'Preserved destination',
        is_income,
      });
      const children = [];
      for (const name of ['Child a', 'Child b', 'Deleted child']) {
        children.push(
          await api.createCategory({ name, group_id: group, is_income }),
        );
      }
      const [a, b, dead] = children;
      const target = await api.createCategory({
        name: 'Target',
        group_id: destination,
        is_income,
      });
      const forwarder = await api.createCategory({
        name: 'Forwarder',
        group_id: destination,
        is_income,
      });
      const account = await api.createAccount(
        { name: 'Preserved group ledger' },
        0,
      );
      await api.addTransactions(account, [
        {
          date: '2023-10-02',
          amount: -50,
          category: forwarder,
          notes: 'Preserve group ledger',
        },
      ]);
      await api.deleteCategory(dead);
      await api.deleteCategory(forwarder, dead);
      for (const [category, amount] of [
        [a, 700],
        [b, -100],
        [dead, 999],
        [target, 200],
      ] as const) {
        await api.setBudgetAmount('2023-10', category, amount);
      }
      const before = {
        groups: await api.getCategoryGroups(),
        month: await api.getBudgetMonth('2023-10'),
        transactions: await api.getTransactions(
          account,
          '2023-10-01',
          '2023-10-31',
        ),
      };
      const proposal = await api.previewCategoryGroupDeletion({
        id: group,
        transferCategoryId: target,
      });
      expect(proposal.after.group).toMatchObject({ id: group, tombstone: 1 });
      expect(proposal.after.categories.map(row => row.id).sort()).toEqual(
        [...children].sort(),
      );
      expect(proposal.after.mappings).toEqual(
        expect.arrayContaining(
          [...children, forwarder].map(id => ({ id, transferId: target })),
        ),
      );
      expect(
        proposal.after.budgetTransfers.find(row => row.month === '2023-10')
          ?.amount,
      ).toBe(800);
      expect(await api.getCategoryGroups()).toEqual(before.groups);
      expect(await api.getBudgetMonth('2023-10')).toEqual(before.month);
      expect(
        await api.getTransactions(account, '2023-10-01', '2023-10-31'),
      ).toEqual(before.transactions);
      expect(await api.applyCategoryGroupDeletion(proposal)).toMatchObject({
        status: 'committed-local',
        changed: true,
        affectedIds: expect.arrayContaining([group, ...children, forwarder]),
      });
      expect(
        (await api.getCategoryGroups()).some(row => row.id === group),
      ).toBe(false);
      expect(
        await api.getTransactions(account, '2023-10-01', '2023-10-31'),
      ).toEqual(before.transactions.map(row => ({ ...row, category: target })));
      expect(await api.applyCategoryGroupDeletion(proposal)).toMatchObject({
        code: 'STALE_PREVIEW',
      });
    },
  );
  test('deletes empty groups and preserves mappings and allocations without a destination', async () => {
    for (const populated of [false, true]) {
      const id = await api.createCategoryGroup({
        name: 'No transfer ' + populated,
      });
      if (populated) {
        await api.createCategory({ name: 'No transfer child', group_id: id });
      }
      const proposal = await api.previewCategoryGroupDeletion({ id });
      expect(proposal.after.categories).toHaveLength(populated ? 1 : 0);
      expect(proposal.after.mappings).toEqual([]);
      expect(proposal.after.budgetTransfers).toEqual([]);
      expect(await api.applyCategoryGroupDeletion(proposal)).toMatchObject({
        status: 'committed-local',
        changed: true,
      });
    }
  });
  test('rejects invalid destinations, malformed, stale and tampered group proposals before writes', async () => {
    const id = await api.createCategoryGroup({
      name: 'Validated group deletion',
    });
    const child = await api.createCategory({
      name: 'Invalid inside destination',
      group_id: id,
    });
    const outsideCategory = (await api.getCategories()).find(
      row => row.group_id !== id,
    );
    if (!outsideCategory) {
      throw new Error('Fixture requires an outside category');
    }
    const outside = outsideCategory.id;
    const proposal = await api.previewCategoryGroupDeletion({
      id,
      transferCategoryId: outside,
    });
    const before = await api.getCategoryGroups();
    expect(
      await api.applyCategoryGroupDeletion({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyCategoryGroupDeletion({
        ...proposal,
        after: { ...proposal.after, categories: [] },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    for (const request of [
      { id: '' },
      { id: 'missing' },
      { id, transferCategoryId: child },
      { id, transferCategoryId: 'missing' },
      { id, transferCategoryId: '' },
      { id, extra: true },
    ]) {
      await expect(api.previewCategoryGroupDeletion(request)).rejects.toThrow();
    }
    expect(await api.getCategoryGroups()).toEqual(before);
    await api.updateCategory(child, { hidden: true });
    expect(await api.applyCategoryGroupDeletion(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
});

describe('guarded payee creation', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('preserves legacy exact, duplicate and empty names and ignores declared transfer account input', async () => {
    const name = '  Exact public payee  ';
    const first = await api.createPayee({
      name,
      transfer_acct: 'ignored-account',
    });
    const second = await api.createPayee({ name });
    const empty = await api.createPayee({ name: '' });
    expect(second).not.toBe(first);
    const payees = await api.getPayees();
    for (const id of [first, second]) {
      expect(payees.find(row => row.id === id)).toEqual({
        id,
        name,
        transfer_acct: null,
      });
    }
    expect(payees.find(row => row.id === empty)).toEqual({
      id: empty,
      name: '',
      transfer_acct: null,
    });
  });
  test('previews without writes and acknowledges actual payee and self mapping identities with full public creation scope', async () => {
    const before = await api.getPayees();
    const request = {
      name: '  Guarded exact payee  ',
      transfer_acct: 'ignored-account',
    };
    const proposal = await api.previewPayeeCreation(request);
    expect(proposal.after).toEqual({
      payee: { name: request.name },
      mapping: { creates: true },
    });
    expect(await api.getPayees()).toEqual(before);
    const applied = await api.applyPayeeCreation(proposal);
    expect(applied).toMatchObject({
      status: 'committed-local',
      changed: true,
      payeeCreation: {
        payeeId: expect.any(String),
        mappingId: expect.any(String),
      },
    });
    if (applied.status !== 'committed-local') {
      throw new Error('Expected committed creation');
    }
    expect(applied.payeeCreation.mappingId).toBe(applied.payeeCreation.payeeId);
    expect(applied.affectedIds).toEqual([applied.payeeCreation.payeeId]);
    expect(
      (await api.getPayees()).find(
        row => row.id === applied.payeeCreation.payeeId,
      ),
    ).toEqual({
      id: applied.payeeCreation.payeeId,
      name: request.name,
      transfer_acct: null,
    });
    expect(await api.applyPayeeCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    const duplicate = await api.applyPayeeCreation(
      await api.previewPayeeCreation(request),
    );
    expect(duplicate.status).toBe('committed-local');
    if (duplicate.status === 'committed-local') {
      expect(duplicate.payeeCreation.payeeId).not.toBe(
        applied.payeeCreation.payeeId,
      );
    }
    const empty = await api.previewPayeeCreation({ name: '' });
    expect((await api.applyPayeeCreation(empty)).status).toBe(
      'committed-local',
    );
  });
  test('rejects wrong-budget, tampered, malformed and changed-source proposals before creation', async () => {
    const proposal = await api.previewPayeeCreation({
      name: 'Validated payee',
    });
    const before = await api.getPayees();
    expect(
      await api.applyPayeeCreation({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyPayeeCreation({
        ...proposal,
        after: { ...proposal.after, payee: { name: 'tampered' } },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    for (const request of [
      { name: null },
      {},
      { name: 'Payee', extra: true },
      { name: 'Payee', transfer_acct: 42 },
    ]) {
      await expect(
        api.previewPayeeCreation(
          request as unknown as Parameters<typeof api.previewPayeeCreation>[0],
        ),
      ).rejects.toThrow();
    }
    expect(await api.getPayees()).toEqual(before);
    await api.createPayee({ name: 'Changed source payee' });
    expect(await api.applyPayeeCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
});

describe('guarded payee updates, deletions and merges', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews a rename without writes and acknowledges the raw payee row', async () => {
    const id = await api.createPayee({ name: 'Old name' });
    const before = await api.getPayees();
    const proposal = await api.previewPayeeUpdate({
      id,
      fields: { name: 'New name' },
    });
    expect(proposal.after.payee).toMatchObject({ id, name: 'New name' });
    expect(await api.getPayees()).toEqual(before);
    const applied = await api.applyPayeeUpdate(proposal);
    expect(applied).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getPayees()).find(row => row.id === id)?.name).toBe(
      'New name',
    );
    expect(await api.applyPayeeUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects malformed, transfer, missing and tampered payee updates', async () => {
    const account = await api.createAccount({ name: 'Checking' }, 0);
    const transfer = (await api.getPayees()).find(
      row => row.transfer_acct === account,
    );
    const id = await api.createPayee({ name: 'Target' });
    for (const request of [
      { id, fields: {} },
      { id, fields: { name: '' } },
      { id, fields: { name: 'x', transfer_acct: account } },
      { id: 'missing', fields: { name: 'x' } },
      { id: transfer?.id, fields: { name: 'x' } },
    ]) {
      await expect(
        api.previewPayeeUpdate(
          request as unknown as Parameters<typeof api.previewPayeeUpdate>[0],
        ),
      ).rejects.toThrow();
    }
    const proposal = await api.previewPayeeUpdate({
      id,
      fields: { name: 'Renamed' },
    });
    expect(
      await api.applyPayeeUpdate({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    expect(
      await api.applyPayeeUpdate({
        ...proposal,
        request: { id, fields: { name: 'Other' } },
      }),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
    expect((await api.getPayees()).find(row => row.id === id)?.name).toBe(
      'Target',
    );
  });
  test('deletes a regular payee and preserves the transfer payee no-op', async () => {
    const id = await api.createPayee({ name: 'Doomed' });
    const proposal = await api.previewPayeeDeletion({ id });
    expect(proposal.after).toEqual({ action: 'tombstone' });
    expect(await api.applyPayeeDeletion(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getPayees()).some(row => row.id === id)).toBe(false);
    await expect(api.previewPayeeDeletion({ id })).rejects.toThrow();
    const account = await api.createAccount({ name: 'Savings' }, 0);
    const transfer = (await api.getPayees()).find(
      row => row.transfer_acct === account,
    );
    if (!transfer) {
      throw new Error('Expected transfer payee');
    }
    const transferProposal = await api.previewPayeeDeletion({
      id: transfer.id,
    });
    expect(transferProposal.after).toEqual({
      action: 'unchanged-transfer-payee',
    });
    expect(await api.applyPayeeDeletion(transferProposal)).toMatchObject({
      status: 'committed-local',
      changed: false,
      affectedIds: [],
    });
    expect((await api.getPayees()).some(row => row.id === transfer.id)).toBe(
      true,
    );
  });
  test('merges payees, remaps mappings and skips transfer sources', async () => {
    const target = await api.createPayee({ name: 'Keep' });
    const first = await api.createPayee({ name: 'Dup 1' });
    const second = await api.createPayee({ name: 'Dup 2' });
    const account = await api.createAccount({ name: 'Wallet' }, 0);
    const transfer = (await api.getPayees()).find(
      row => row.transfer_acct === account,
    );
    if (!transfer) {
      throw new Error('Expected transfer payee');
    }
    const request = {
      targetId: target,
      mergeIds: [first, second, transfer.id],
    };
    const before = await api.getPayees();
    const proposal = await api.previewPayeeMerge(request);
    expect(await api.getPayees()).toEqual(before);
    expect(proposal.after.mergedIds).toEqual([first, second]);
    expect(proposal.after.skippedTransferIds).toEqual([transfer.id]);
    expect(proposal.after.mappings).toEqual(
      expect.arrayContaining([
        { id: first, targetId: target },
        { id: second, targetId: target },
      ]),
    );
    const applied = await api.applyPayeeMerge(proposal);
    expect(applied).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [target, first, second],
      payeeMerge: { targetId: target, mergedIds: [first, second] },
    });
    const after = await api.getPayees();
    expect(after.some(row => row.id === first || row.id === second)).toBe(
      false,
    );
    expect(after.some(row => row.id === target)).toBe(true);
    expect(after.some(row => row.id === transfer.id)).toBe(true);
    expect(await api.applyPayeeMerge(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects merges that include the target, repeat sources or name missing payees', async () => {
    const target = await api.createPayee({ name: 'Keep' });
    const source = await api.createPayee({ name: 'Dup' });
    for (const request of [
      { targetId: target, mergeIds: [] },
      { targetId: target, mergeIds: [target] },
      { targetId: target, mergeIds: [source, target] },
      { targetId: target, mergeIds: [source, source] },
      { targetId: target, mergeIds: ['missing'] },
      { targetId: 'missing', mergeIds: [source] },
      { targetId: target, mergeIds: [source], extra: true },
    ]) {
      await expect(
        api.previewPayeeMerge(
          request as unknown as Parameters<typeof api.previewPayeeMerge>[0],
        ),
      ).rejects.toThrow();
    }
    const before = await api.getPayees();
    const proposal = await api.previewPayeeMerge({
      targetId: target,
      mergeIds: [source],
    });
    await api.updatePayee(source, { name: 'Changed after preview' });
    expect(await api.applyPayeeMerge(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect((await api.getPayees()).length).toBe(before.length);
  });
});

describe('guarded tag creation, updates and deletions', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('creates, updates and deletes tags with raw row acknowledgements', async () => {
    const before = await api.getTags();
    const proposal = await api.previewTagCreation({
      tag: 'groceries',
      color: ' #ff0000 ',
      description: 'Food',
    });
    expect(proposal.after).toEqual({
      action: 'insert',
      tag: {
        tag: 'groceries',
        color: '#ff0000',
        description: 'Food',
        tombstone: 0,
      },
    });
    expect(await api.getTags()).toEqual(before);
    const created = await api.applyTagCreation(proposal);
    if (created.status !== 'committed-local') {
      throw new Error('Expected committed tag creation');
    }
    const id = created.tagCreation.tagId;
    expect(created).toMatchObject({
      changed: true,
      affectedIds: [id],
      tagCreation: { action: 'insert' },
    });
    expect(await api.getTags()).toContainEqual({
      id,
      tag: 'groceries',
      color: '#ff0000',
      description: 'Food',
    });
    expect(await api.applyTagCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(
      api.previewTagCreation({ tag: 'groceries' }),
    ).rejects.toThrow();

    const update = await api.previewTagUpdate({
      id,
      fields: { tag: 'food', description: null },
    });
    expect(await api.applyTagUpdate(update)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getTags()).find(row => row.id === id)).toEqual({
      id,
      tag: 'food',
      color: '#ff0000',
      description: null,
    });

    const deletion = await api.previewTagDeletion({ id });
    expect(await api.applyTagDeletion(deletion)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getTags()).some(row => row.id === id)).toBe(false);
    await expect(api.previewTagDeletion({ id })).rejects.toThrow();

    const revive = await api.previewTagCreation({ tag: 'food' });
    expect(revive.after.action).toBe('revive');
    const revived = await api.applyTagCreation(revive);
    expect(revived).toMatchObject({
      status: 'committed-local',
      tagCreation: { tagId: id, action: 'revive' },
    });
    expect((await api.getTags()).find(row => row.id === id)).toEqual({
      id,
      tag: 'food',
      color: null,
      description: null,
    });
  });
  test('rejects malformed, duplicate and tampered tag requests', async () => {
    const first = await api.createTag({ tag: 'one' });
    await api.createTag({ tag: 'two' });
    for (const request of [
      {},
      { tag: '' },
      { tag: 'has space' },
      { tag: '#hash' },
      { tag: 'ok', color: 1 },
      { tag: 'ok', extra: true },
    ]) {
      await expect(
        api.previewTagCreation(
          request as unknown as Parameters<typeof api.previewTagCreation>[0],
        ),
      ).rejects.toThrow();
    }
    for (const request of [
      { id: first, fields: {} },
      { id: first, fields: { tag: 'two' } },
      { id: first, fields: { hidden: true } },
      { id: 'missing', fields: { color: null } },
    ]) {
      await expect(
        api.previewTagUpdate(
          request as unknown as Parameters<typeof api.previewTagUpdate>[0],
        ),
      ).rejects.toThrow();
    }
    const proposal = await api.previewTagUpdate({
      id: first,
      fields: { color: 'blue' },
    });
    expect(
      await api.applyTagUpdate({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    await api.updateTag(first, { description: 'changed' });
    expect(await api.applyTagUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect((await api.getTags()).find(row => row.id === first)?.color).toBe(
      null,
    );
  });
});

describe('guarded note changes', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('resolves note targets, reads without writing and sets notes with acknowledgements', async () => {
    const accountId = await api.createAccount({
      name: 'Notes',
      offbudget: false,
    });
    const groupId = await api.createCategoryGroup({ name: 'Note group' });
    const categoryId = await api.createCategory({
      name: 'Note cat',
      group_id: groupId,
    });

    expect(await api.getNoteTarget(`account-${accountId}`)).toEqual({
      target: { kind: 'account', id: accountId, name: 'Notes' },
      note: null,
    });
    expect(await api.getNote(`account-${accountId}`)).toBeNull();
    expect((await api.getNoteTarget(groupId)).target.kind).toBe(
      'category-group',
    );
    expect((await api.getNoteTarget('budget-2026-10')).target).toEqual({
      kind: 'month',
      month: '2026-10',
    });
    expect((await api.getNoteTarget(`${categoryId}-2026-10`)).target).toEqual({
      kind: 'category-month',
      id: categoryId,
      name: 'Note cat',
      month: '2026-10',
    });
    for (const id of ['missing', 'account-missing', 'budget-2026-13', '']) {
      await expect(api.getNoteTarget(id)).rejects.toThrow();
    }

    const proposal = await api.previewNoteSet({
      id: categoryId,
      note: 'first',
    });
    expect(proposal.before.note).toBeNull();
    expect(proposal.after).toEqual({
      target: { kind: 'category', id: categoryId, name: 'Note cat' },
      note: { id: categoryId, note: 'first' },
    });
    expect(proposal.sideEffects.join(' ')).toContain('#template');
    expect(await api.getNote(categoryId)).toBeNull();
    expect(await api.applyNoteSet(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [categoryId],
    });
    expect((await api.getNoteTarget(categoryId)).note).toBe('first');
    expect(await api.applyNoteSet(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });

    const same = await api.previewNoteSet({ id: categoryId, note: 'first' });
    expect(await api.applyNoteSet(same)).toMatchObject({ changed: false });
    const cleared = await api.previewNoteSet({ id: categoryId, note: '' });
    expect(await api.applyNoteSet(cleared)).toMatchObject({ changed: true });
    expect((await api.getNoteTarget(categoryId)).note).toBe('');
  });
  test('rejects malformed, orphan and stale note requests', async () => {
    const accountId = await api.createAccount({
      name: 'Stale',
      offbudget: false,
    });
    const id = `account-${accountId}`;
    for (const request of [
      {},
      { id },
      { id, note: 1 },
      { id, note: 'x', extra: true },
      { id: 'missing', note: 'x' },
      { id: 'budget-26-01', note: 'x' },
      { id, note: 'x'.repeat(100_001) },
    ]) {
      await expect(
        api.previewNoteSet(
          request as unknown as Parameters<typeof api.previewNoteSet>[0],
        ),
      ).rejects.toThrow();
    }
    const proposal = await api.previewNoteSet({ id, note: 'planned' });
    expect(
      await api.applyNoteSet({
        ...proposal,
        budget: { ...proposal.budget, id: 'wrong' },
      }),
    ).toMatchObject({ code: 'MISSING_CONTEXT' });
    await api.updateNote(id, 'concurrent');
    expect(await api.applyNoteSet(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect((await api.getNote(id))?.note).toBe('concurrent');
    await api.deleteAccount(accountId);
    await expect(api.previewNoteSet({ id, note: 'late' })).rejects.toThrow();
  });
});

describe('guarded rule creation, updates and deletions', () => {
  const ruleFields = {
    stage: 'pre' as const,
    conditionsOp: 'and' as const,
    conditions: [{ field: 'payee' as const, op: 'is' as const, value: 'p1' }],
    actions: [
      {
        op: 'set' as const,
        field: 'category' as const,
        value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
      },
    ],
  };
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('creates, updates and deletes rules with raw row acknowledgements', async () => {
    const before = await api.getRules();
    const proposal = await api.previewRuleCreation({
      ...ruleFields,
      stage: 'default',
    });
    expect(proposal.after.rule).toMatchObject({
      stage: null,
      conditions_op: 'and',
      tombstone: 0,
    });
    expect(await api.getRules()).toEqual(before);
    const created = await api.applyRuleCreation(proposal);
    if (created.status !== 'committed-local') {
      throw new Error('Expected committed rule creation');
    }
    const id = created.ruleCreation.ruleId;
    expect(created.affectedIds).toEqual([id]);
    expect((await api.getRules()).find(rule => rule.id === id)).toMatchObject({
      stage: null,
      conditions: ruleFields.conditions,
      actions: ruleFields.actions,
    });
    expect(await api.applyRuleCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });

    const update = await api.previewRuleUpdate({
      id,
      fields: { stage: 'post', conditionsOp: 'or' },
    });
    expect(await api.applyRuleUpdate(update)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getRules()).find(rule => rule.id === id)).toMatchObject({
      stage: 'post',
      conditionsOp: 'or',
      conditions: ruleFields.conditions,
    });

    const deletion = await api.previewRuleDeletion({ id });
    expect(await api.applyRuleDeletion(deletion)).toMatchObject({
      status: 'committed-local',
      changed: true,
      affectedIds: [id],
    });
    expect((await api.getRules()).some(rule => rule.id === id)).toBe(false);
    await expect(api.previewRuleDeletion({ id })).rejects.toThrow();
  });
  test('rejects malformed, invalid, schedule-owned and changed rule requests', async () => {
    for (const request of [
      {},
      { ...ruleFields, stage: 'never' },
      { ...ruleFields, conditionsOp: 'xor' },
      { ...ruleFields, conditions: 'nope' },
      { ...ruleFields, actions: [{ op: 'set', field: 'nope', value: 1 }] },
      { ...ruleFields, id: 'chosen' },
      { stage: 'pre', conditionsOp: 'and', conditions: [] },
    ]) {
      await expect(
        api.previewRuleCreation(
          request as unknown as Parameters<typeof api.previewRuleCreation>[0],
        ),
      ).rejects.toThrow();
    }
    const rule = await api.createRule(ruleFields);
    for (const request of [
      { id: rule.id, fields: {} },
      { id: rule.id, fields: { tombstone: true } },
      { id: 'missing', fields: { stage: 'post' } },
    ]) {
      await expect(
        api.previewRuleUpdate(
          request as unknown as Parameters<typeof api.previewRuleUpdate>[0],
        ),
      ).rejects.toThrow();
    }
    const proposal = await api.previewRuleUpdate({
      id: rule.id,
      fields: { stage: 'post' },
    });
    await api.updateRule({ ...rule, conditionsOp: 'or' });
    expect(await api.applyRuleUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    const account = await api.createAccount({ name: 'Bills' }, 0);
    const scheduleId = await api.createSchedule({
      posts_transaction: false,
      date: '2026-10-05',
      amountOp: 'is',
      amount: -1000,
      account,
    });
    const schedule = (await api.getSchedules()).find(
      row => row.id === scheduleId,
    );
    if (!schedule?.rule) {
      throw new Error('Expected schedule');
    }
    await expect(
      api.previewRuleDeletion({ id: schedule.rule }),
    ).rejects.toThrow();
    await expect(
      api.previewRuleUpdate({ id: schedule.rule, fields: { stage: 'post' } }),
    ).rejects.toThrow();
  });
});

describe('guarded schedule creation, updates and deletions', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  async function scheduleRequest() {
    const account = await api.createAccount({ name: 'Bills' }, 0);
    const payee = await api.createPayee({ name: 'Utility' });
    return {
      name: 'Power',
      posts_transaction: false,
      payee,
      account,
      amount: -5000,
      amountOp: 'is' as const,
      date: '2026-11-01',
    };
  }
  test('creates, updates and deletes schedules with linked rule acknowledgements', async () => {
    const request = await scheduleRequest();
    const before = await api.getSchedules();
    const proposal = await api.previewScheduleCreation(request);
    expect(await api.getSchedules()).toEqual(before);
    const created = await api.applyScheduleCreation(proposal);
    if (created.status !== 'committed-local') {
      throw new Error('Expected committed schedule creation');
    }
    const id = created.scheduleCreation.scheduleId;
    expect(created.affectedIds).toEqual([id]);
    expect((await api.getSchedules()).find(row => row.id === id)).toMatchObject(
      {
        name: 'Power',
        rule: created.scheduleCreation.ruleId,
        payee: request.payee,
        account: request.account,
        amount: -5000,
      },
    );
    expect(await api.applyScheduleCreation(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    await expect(api.previewScheduleCreation(request)).rejects.toThrow();

    const update = await api.previewScheduleUpdate({
      id,
      fields: { name: 'Electric', amount: -6000 },
    });
    expect(await api.applyScheduleUpdate(update)).toMatchObject({
      status: 'committed-local',
      affectedIds: [id],
    });
    expect((await api.getSchedules()).find(row => row.id === id)).toMatchObject(
      { name: 'Electric', amount: -6000 },
    );

    const deletion = await api.previewScheduleDeletion({ id });
    expect(await api.applyScheduleDeletion(deletion)).toMatchObject({
      status: 'committed-local',
      affectedIds: [id, created.scheduleCreation.ruleId],
    });
    expect((await api.getSchedules()).some(row => row.id === id)).toBe(false);
    expect(
      (await api.getRules()).some(
        rule => rule.id === created.scheduleCreation.ruleId,
      ),
    ).toBe(false);
  });
  test('rejects malformed, unknown-reference and changed schedule requests', async () => {
    const request = await scheduleRequest();
    for (const bad of [
      {},
      { ...request, payee: undefined },
      { ...request, account: 'missing' },
      { ...request, amountOp: 'nope' },
      { ...request, extra: true },
      { ...request, date: null },
    ]) {
      await expect(
        api.previewScheduleCreation(
          bad as unknown as Parameters<typeof api.previewScheduleCreation>[0],
        ),
      ).rejects.toThrow();
    }
    const id = await api.createSchedule(request);
    for (const bad of [
      { id, fields: {} },
      { id, fields: { completed: true } },
      { id, fields: { payee: 'missing' } },
      { id: 'missing', fields: { name: 'x' } },
    ]) {
      await expect(
        api.previewScheduleUpdate(
          bad as unknown as Parameters<typeof api.previewScheduleUpdate>[0],
        ),
      ).rejects.toThrow();
    }
    const proposal = await api.previewScheduleUpdate({
      id,
      fields: { name: 'Renamed' },
    });
    await api.updateSchedule(id, { amount: -1 });
    expect(await api.applyScheduleUpdate(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect((await api.getSchedules()).find(row => row.id === id)?.name).toBe(
      'Power',
    );
  });
});

describe('query metadata', () => {
  test('exposes core schema metadata and validates without executing', () => {
    const metadata = api.getQuerySchema();
    const transactions = metadata.tables.find(
      table => table.name === 'transactions',
    );
    expect(transactions?.fields).toContainEqual({
      name: 'payee',
      type: 'id',
      ref: 'payees',
      required: false,
    });
    expect(metadata.filterOperators).toContain('$oneof');
    expect(api.validateQuery(api.q('transactions').select(['amount']))).toEqual(
      { valid: true, table: 'transactions', aggregate: false },
    );
    expect(
      api.validateQuery(api.q('transactions').select(['missing_field'])),
    ).toMatchObject({ valid: false, table: 'transactions' });
  });
});

describe('query snapshot marker', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('changes after a write and stays equal across reads', async () => {
    const first = await api.getQuerySnapshot();
    expect(await api.getQuerySnapshot()).toEqual(first);
    await api.createAccount({ name: 'Marker' }, 0);
    expect((await api.getQuerySnapshot()).marker).not.toBe(first.marker);
  });
});

describe('guarded transaction addition', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews planned rows and applies them with acknowledged ids', async () => {
    const account = await api.createAccount({ name: 'Adds' }, 0);
    const request = {
      accountId: account,
      transactions: [
        { date: '2026-10-01', amount: -100, notes: 'one' },
        {
          date: '2026-10-02',
          amount: -300,
          notes: 'split',
          subtransactions: [{ amount: -100 }, { amount: -200 }],
        },
      ],
    };
    const proposal = await api.previewTransactionAddition(request);
    expect(proposal.after.rows).toHaveLength(4);
    expect(
      await api.getTransactions(account, '2026-10-01', '2026-10-31'),
    ).toEqual([]);
    const outcome = await api.applyTransactionAddition(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local' });
    if (!('transactionAddition' in outcome)) {
      throw new Error('Expected addition outcome');
    }
    expect(outcome.transactionAddition.transactionIds).toHaveLength(4);
    const rows = await api.getTransactions(account, '2026-10-01', '2026-10-31');
    expect(
      rows
        .map(row => row.notes)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['one', 'split']);
    expect(await api.applyTransactionAddition(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects malformed requests and closed accounts', async () => {
    const account = await api.createAccount({ name: 'Closing' }, 0);
    await expect(
      api.previewTransactionAddition({ accountId: account, transactions: [] }),
    ).rejects.toThrow();
    await expect(
      api.previewTransactionAddition({
        accountId: 'missing',
        transactions: [{ date: '2026-10-01', amount: 1 }],
      }),
    ).rejects.toThrow();
    await api.closeAccount(account);
    await expect(
      api.previewTransactionAddition({
        accountId: account,
        transactions: [{ date: '2026-10-01', amount: 1 }],
      }),
    ).rejects.toThrow();
  });
});

describe('guarded transaction import', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('previews matched updates and new rows, then applies them exactly', async () => {
    const account = await api.createAccount({ name: 'Imports' }, 0);
    await api.addTransactions(account, [
      { date: '2026-10-01', amount: -100, imported_id: 'bank-1' },
    ]);
    const request = {
      accountId: account,
      transactions: [
        {
          date: '2026-10-01',
          amount: -100,
          imported_id: 'bank-1',
          notes: 'matched',
        },
        {
          date: '2026-10-03',
          amount: -250,
          imported_id: 'bank-2',
          payee_name: 'brand new shop',
        },
      ],
    };
    const proposal = await api.previewTransactionImport(request);
    expect(proposal.after.updated).toHaveLength(1);
    expect(proposal.after.updated[0]).toMatchObject({ notes: 'matched' });
    expect(proposal.after.added).toHaveLength(1);
    expect(proposal.after.added[0]).toMatchObject({
      payee: { newPayee: 'Brand New Shop' },
      amount: -250,
    });
    expect(
      await api.getTransactions(account, '2026-10-01', '2026-10-31'),
    ).toHaveLength(1);
    const outcome = await api.applyTransactionImport(proposal);
    expect(outcome).toMatchObject({ status: 'committed-local' });
    if (!('transactionImport' in outcome)) {
      throw new Error('Expected import outcome');
    }
    expect(outcome.transactionImport.addedIds).toHaveLength(1);
    expect(outcome.transactionImport.updatedIds).toHaveLength(1);
    const rows = await api.getTransactions(account, '2026-10-01', '2026-10-31');
    expect(
      rows
        .map(row => row.notes ?? null)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['matched', null]);
    expect(await api.applyTransactionImport(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects malformed options and closed accounts', async () => {
    const account = await api.createAccount({ name: 'Import closing' }, 0);
    const transactions = [{ date: '2026-10-01', amount: 1 }];
    await expect(
      api.previewTransactionImport({
        accountId: account,
        transactions,
        opts: { payeeNameNormalization: 'upper' as 'original' },
      }),
    ).rejects.toThrow();
    await expect(
      api.previewTransactionImport({ accountId: account, transactions: [] }),
    ).rejects.toThrow();
    await api.closeAccount(account);
    await expect(
      api.previewTransactionImport({ accountId: account, transactions }),
    ).rejects.toThrow();
  });
});

describe('guarded transaction deletion', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('deletes plain, split and transfer transactions with exact cascades', async () => {
    const checking = await api.createAccount({ name: 'Checking' }, 0);
    const savings = await api.createAccount({ name: 'Savings' }, 0);
    const transferPayee = (await api.getPayees()).find(
      row => row.transfer_acct === savings,
    );
    if (!transferPayee) {
      throw new Error('Expected transfer payee');
    }
    await api.addTransactions(
      checking,
      [
        { date: '2026-10-01', amount: -100, notes: 'plain' },
        {
          date: '2026-10-02',
          amount: -300,
          notes: 'split',
          subtransactions: [{ amount: -100 }, { amount: -200 }],
        },
        {
          date: '2026-10-03',
          amount: -500,
          notes: 'transfer',
          payee: transferPayee.id,
        },
      ],
      { runTransfers: true },
    );
    const rows = await api.getTransactions(
      checking,
      '2026-10-01',
      '2026-10-31',
    );
    const byNotes = (notes: string) => {
      const row = rows.find(r => r.notes === notes);
      if (!row) {
        throw new Error('Missing ' + notes);
      }
      return row;
    };
    const plain = byNotes('plain');
    const split = byNotes('split');
    const transfer = byNotes('transfer');
    if (!transfer.transfer_id) {
      throw new Error('Expected linked transfer');
    }

    const plainProposal = await api.previewTransactionDeletion({
      id: plain.id,
    });
    expect(plainProposal.after).toEqual({
      deletedIds: [plain.id],
      transferDeletedIds: [],
      transferUnlinkedIds: [],
    });
    expect(await api.applyTransactionDeletion(plainProposal)).toMatchObject({
      status: 'committed-local',
      affectedIds: [plain.id],
    });

    const children = (split.subtransactions ?? []).map(child => child.id);
    expect(children).toHaveLength(2);
    await expect(
      api.previewTransactionDeletion({ id: children[0] }),
    ).rejects.toThrow();
    const splitProposal = await api.previewTransactionDeletion({
      id: split.id,
    });
    expect(splitProposal.after.deletedIds).toEqual(
      [split.id, ...children].sort(),
    );
    expect(await api.applyTransactionDeletion(splitProposal)).toMatchObject({
      status: 'committed-local',
    });

    const transferProposal = await api.previewTransactionDeletion({
      id: transfer.id,
    });
    expect(transferProposal.after.transferDeletedIds).toEqual([
      transfer.transfer_id,
    ]);
    expect(await api.applyTransactionDeletion(transferProposal)).toMatchObject({
      status: 'committed-local',
    });
    expect(
      await api.getTransactions(checking, '2026-10-01', '2026-10-31'),
    ).toEqual([]);
    expect(
      await api.getTransactions(savings, '2026-10-01', '2026-10-31'),
    ).toEqual([]);
    expect(await api.applyTransactionDeletion(plainProposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
  });
  test('rejects malformed, missing and changed deletions', async () => {
    const account = await api.createAccount({ name: 'Cash' }, 0);
    await api.addTransactions(account, [
      { date: '2026-10-01', amount: -100, notes: 'keep' },
    ]);
    const [row] = await api.getTransactions(
      account,
      '2026-10-01',
      '2026-10-31',
    );
    for (const bad of [
      {},
      { id: '' },
      { id: 'missing' },
      { id: row.id, x: 1 },
    ]) {
      await expect(
        api.previewTransactionDeletion(
          bad as unknown as Parameters<
            typeof api.previewTransactionDeletion
          >[0],
        ),
      ).rejects.toThrow();
    }
    const proposal = await api.previewTransactionDeletion({ id: row.id });
    await api.updateTransaction(row.id, { notes: 'edited' });
    expect(await api.applyTransactionDeletion(proposal)).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect(
      await api.getTransactions(account, '2026-10-01', '2026-10-31'),
    ).toHaveLength(1);
  });
});

describe('guarded transaction classification updates', () => {
  beforeEach(async () => {
    await api.loadBudget(budgetName);
  });
  test('updates category and payee and rejects transfer-changing edits', async () => {
    const checking = await api.createAccount({ name: 'Checking' }, 0);
    const savings = await api.createAccount({ name: 'Savings' }, 0);
    const offbudget = await api.createAccount(
      { name: 'Loan', offbudget: true },
      0,
    );
    const payee = await api.createPayee({ name: 'Grocer' });
    const transferPayee = (await api.getPayees()).find(
      row => row.transfer_acct === savings,
    );
    const groups = await api.getCategoryGroups();
    const category = groups
      .flatMap(group => group.categories ?? [])
      .find(row => !row.is_income);
    if (!transferPayee || !category) {
      throw new Error('Expected fixtures');
    }
    await api.addTransactions(checking, [
      { date: '2026-10-01', amount: -100, notes: 'plain' },
    ]);
    await api.addTransactions(offbudget, [
      { date: '2026-10-01', amount: -100, notes: 'off' },
    ]);
    const [plain] = await api.getTransactions(
      checking,
      '2026-10-01',
      '2026-10-31',
    );
    const [off] = await api.getTransactions(
      offbudget,
      '2026-10-01',
      '2026-10-31',
    );
    const proposal = await api.previewTransactionUpdate({
      id: plain.id,
      fields: { category: category.id, payee },
    });
    expect(await api.applyTransactionUpdate(proposal)).toMatchObject({
      status: 'committed-local',
      changed: true,
    });
    const [updated] = await api.getTransactions(
      checking,
      '2026-10-01',
      '2026-10-31',
    );
    expect(updated).toMatchObject({ category: category.id, payee });
    for (const fields of [
      { payee: transferPayee.id },
      { payee: 'missing' },
      { category: 'missing' },
      { account: savings },
    ]) {
      await expect(
        api.previewTransactionUpdate({
          id: plain.id,
          fields,
        } as unknown as Parameters<typeof api.previewTransactionUpdate>[0]),
      ).rejects.toThrow();
    }
    await expect(
      api.previewTransactionUpdate({
        id: off.id,
        fields: { category: category.id },
      }),
    ).rejects.toThrow();
  });
});
