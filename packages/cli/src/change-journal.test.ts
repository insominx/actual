import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import type {
  AccountCloseProposal,
  AccountCreationProposal,
  AccountDeletionProposal,
  BudgetCloneProposal,
  BudgetCreationProposal,
  BudgetMetadataProposal,
  BudgetPublicationProposal,
  BudgetRestoreProposal,
  CategoryCreationProposal,
  CategoryDeletionProposal,
  CategoryGroupCreationProposal,
  TransactionUpdateProposal,
} from '@actual-app/api';

import { withChangeJournal } from './change-journal';
import { stableJson } from './utils';

const proposal: TransactionUpdateProposal = {
  schemaVersion: 1,
  operation: 'transactions.update',
  budget: { id: 'test-budget', syncId: null, cloudFileId: null },
  request: { id: 'transaction', fields: { notes: 'after' } },
  before: [
    {
      id: 'transaction',
      account: 'cash',
      date: '2026-08-01',
      amount: -100,
      notes: 'before',
    },
  ],
  after: [
    {
      id: 'transaction',
      account: 'cash',
      date: '2026-08-01',
      amount: -100,
      notes: 'after',
    },
  ],
  references: {},
  sideEffects: ['transaction update'],
};

it('retains deletion receipts with uncertain provider removal after the retention period', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  const deletion: AccountDeletionProposal = {
    schemaVersion: 1,
    operation: 'accounts.delete',
    budget: proposal.budget,
    request: { id: 'account' },
    before: {
      sourceHash: 'a'.repeat(64),
      account: {},
      transactions: [],
      counterparts: [],
    },
    after: {
      action: 'deleted',
      deletedTransactionIds: [],
      updatedTransactionIds: [],
      deletedPayeeIds: [],
      unlink: {
        clearFields: ['bank'],
        hasToken: true,
        remoteRemoval: {
          url: 'http://synthetic.invalid/remove',
          requisitionId: 'synthetic',
        },
      },
    },
    references: {},
    sideEffects: ['delete'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      for (const id of [
        'confirmed',
        'remote-uncertain',
        'missing-outcome',
        'incomplete-outcome',
      ]) {
        const receipt = await journal.prepare(id, deletion);
        receipt.state = 'synced';
        receipt.updatedAt = '2000-01-01T00:00:00.000Z';
        if (id !== 'missing-outcome') {
          receipt.outcome = {
            status: 'committed-local',
            changed: true,
            checkpoint: 'observed',
            affectedIds: ['account'],
            accountClosure: {
              action: 'deleted',
              accountId: 'account',
              addedTransactionIds: [],
              deletedTransactionIds: [],
              updatedTransactionIds: [],
              deletedPayeeIds: [],
              unlink: {
                localChanged: true,
                remoteStatus: id === 'confirmed' ? 'acknowledged' : 'uncertain',
              },
            },
          };
        }
        if (
          id === 'incomplete-outcome' &&
          receipt.outcome?.status === 'committed-local' &&
          'accountClosure' in receipt.outcome
        ) {
          Object.defineProperty(
            receipt.outcome.accountClosure.unlink,
            'remoteStatus',
            { value: undefined },
          );
        }
        await journal.write(receipt);
      }
      await journal.prepare('next', proposal);
      expect(await journal.read('confirmed')).toBeNull();
      expect((await journal.read('remote-uncertain'))?.state).toBe('synced');
      expect((await journal.read('missing-outcome'))?.state).toBe('synced');
      expect((await journal.read('incomplete-outcome'))?.state).toBe('synced');
    });
  } finally {
    await removeFixture(root);
  }
});

it('expires account creation only with acknowledged generated identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  const creation: AccountCreationProposal = {
    schemaVersion: 1,
    operation: 'accounts.create',
    budget: proposal.budget,
    request: { name: 'Cash', offbudget: false, initialBalance: 100 },
    before: { sourceHash: 'a'.repeat(64) },
    after: {
      account: { name: 'Cash', offbudget: false, closed: false },
      transferPayee: { creates: true },
      openingTransaction: {
        amount: 100,
        date: '2026-08-01',
        cleared: true,
        categoryId: null,
        payeeId: null,
        createsPayee: true,
      },
    },
    references: null,
    sideEffects: ['creation'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      for (const id of ['ack', 'missing-ack', 'incomplete-ack', 'uncertain']) {
        const receipt = await journal.prepare(id, creation);
        receipt.state = id === 'uncertain' ? 'uncertain' : 'synced';
        receipt.updatedAt = '2000-01-01T00:00:00.000Z';
        if (id === 'ack' || id === 'incomplete-ack') {
          receipt.outcome = {
            status: 'committed-local',
            changed: true,
            checkpoint: 'observed',
            affectedIds: ['account'],
            accountCreation: {
              accountId: 'account',
              transferPayeeId: 'transfer-payee',
              openingTransactionId: id === 'ack' ? 'opening' : null,
              startingBalancePayeeId: id === 'ack' ? 'starting-payee' : null,
            },
          };
        }
        await journal.write(receipt);
      }
      await journal.prepare('next', proposal);
      expect(await journal.read('ack')).toBeNull();
      expect((await journal.read('missing-ack'))?.state).toBe('synced');
      expect((await journal.read('incomplete-ack'))?.state).toBe('synced');
      expect((await journal.read('uncertain'))?.state).toBe('uncertain');
    });
  } finally {
    await removeFixture(root);
  }
});

it('expires only acknowledged synchronized publication receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  const publication: BudgetPublicationProposal = {
    schemaVersion: 1,
    operation: 'budgets.publish',
    delivery: 'publication',
    budget: proposal.budget,
    request: { id: proposal.budget.id, encrypted: false },
    before: {
      sourceHash: 'a'.repeat(64),
      name: 'Source',
      currency: 'CAD',
      publication: null,
    },
    after: { published: true, encrypted: false },
    references: {
      serverUrl: 'http://localhost:5006',
      encryptedInitialSupported: false,
    },
    sideEffects: ['publication'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      for (const id of ['ack', 'missing-ack', 'uncertain']) {
        const receipt = await journal.prepare(id, publication);
        receipt.state = id === 'uncertain' ? 'uncertain' : 'synced';
        receipt.updatedAt = '2000-01-01T00:00:00.000Z';
        if (id === 'ack') {
          receipt.outcome = {
            status: 'committed-local',
            changed: true,
            checkpoint: 'observed',
            affectedIds: ['source'],
            publication: {
              serverUrl: publication.references.serverUrl,
              syncId: 'remote-group',
              cloudFileId: 'remote-file',
              encrypted: false,
            },
          };
        }
        await journal.write(receipt);
      }
      await journal.prepare('next', proposal);
      expect(await journal.read('ack')).toBeNull();
      expect((await journal.read('missing-ack'))?.state).toBe('synced');
      expect((await journal.read('uncertain'))?.state).toBe('uncertain');
    });
  } finally {
    await removeFixture(root);
  }
});

it('preserves uncertain receipts across reopening and rejects collisions and altered proposal bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  try {
    await withChangeJournal(root, 1, async journal => {
      const prepared = await journal.prepare('uncertain-id', proposal);
      prepared.state = 'uncertain';
      await journal.write(prepared);
      await expect(
        journal.prepare('uncertain-id', {
          ...proposal,
          request: { ...proposal.request, fields: { notes: 'different' } },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(journal.read('../outside')).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
      expect(
        (await readdir(journal.directory)).filter(name =>
          name.endsWith('.pending'),
        ),
      ).toEqual([]);
    });
    await withChangeJournal(root, 1, async journal => {
      expect((await journal.read('uncertain-id'))?.state).toBe('uncertain');
      const path = join(journal.directory, 'uncertain-id.json');
      const edited = JSON.parse(await readFile(path, 'utf8'));
      edited.proposal.request.fields.notes = 'tampered';
      await writeFile(path, JSON.stringify(edited));
      await expect(journal.read('uncertain-id')).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });
  } finally {
    await removeFixture(root);
  }
});

it('binds the restore artifact locator and preserves existing receipt fingerprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  const restore: BudgetRestoreProposal = {
    schemaVersion: 1,
    operation: 'backups.restore',
    delivery: 'local-only',
    budget: null,
    request: { name: 'Restored' },
    before: { sha256: 'a'.repeat(64), bytes: 123, sourceId: 'source' },
    after: { name: 'Restored', published: false },
    references: { nameAvailable: true },
    sideEffects: ['restore'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      const legacy = await journal.prepare('legacy-token', proposal);
      expect(legacy.token).toBe(
        createHash('sha256')
          .update(stableJson({ operationId: legacy.operationId, proposal }))
          .digest('hex'),
      );
      const artifact = { path: join(root, 'source.actualbackup'), timeout: 60 };
      const receipt = await journal.prepare('restore-token', restore, artifact);
      expect(await journal.read('restore-token')).toEqual(receipt);
      expect(receipt.artifact).toEqual(artifact);
      await expect(
        journal.prepare('restore-token', restore, {
          ...artifact,
          path: join(root, 'other.actualbackup'),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      const path = join(journal.directory, 'restore-token.json');
      const edited = JSON.parse(await readFile(path, 'utf8'));
      edited.artifact.path = join(root, 'other.actualbackup');
      await writeFile(path, JSON.stringify(edited));
      await expect(journal.read('restore-token')).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });
  } finally {
    await removeFixture(root);
  }
});

it('expires acknowledged local archive receipts while preserving uncertainty and pending sync', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  const archive: BudgetMetadataProposal = {
    schemaVersion: 1,
    operation: 'budgets.archive',
    delivery: 'local-only',
    budget: proposal.budget,
    request: {
      operation: 'budgets.archive',
      id: proposal.budget.id,
      archived: true,
    },
    before: { name: 'Test', archived: false },
    after: { name: 'Test', archived: true },
    references: { nameAvailable: true },
    sideEffects: ['device-local archive marker update'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      const ack = await journal.prepare('local-ack', archive);
      ack.state = 'committed-local';
      ack.updatedAt = '2000-01-01T00:00:00.000Z';
      ack.outcome = {
        status: 'committed-local',
        changed: true,
        checkpoint: 'observed',
        affectedIds: [archive.budget.id],
      };
      await journal.write(ack);
      const uncertain = await journal.prepare('local-uncertain', archive);
      uncertain.state = 'uncertain';
      uncertain.updatedAt = ack.updatedAt;
      await journal.write(uncertain);
      const pending = await journal.prepare('pending-sync', proposal);
      pending.state = 'committed-local';
      pending.updatedAt = ack.updatedAt;
      await journal.write(pending);
      await journal.prepare('next', proposal);
      expect(await journal.read('local-ack')).toBeNull();
      expect((await journal.read('local-uncertain'))?.state).toBe('uncertain');
      expect((await journal.read('pending-sync'))?.state).toBe(
        'committed-local',
      );
    });
  } finally {
    await removeFixture(root);
  }
});

it.each(['creation', 'clone', 'restore'])(
  'expires acknowledged %s receipts while retaining ambiguous destination evidence',
  async kind => {
    const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
    const creation:
      | BudgetCreationProposal
      | BudgetCloneProposal
      | BudgetRestoreProposal =
      kind === 'creation'
        ? {
            schemaVersion: 1,
            operation: 'budgets.create',
            delivery: 'local-only',
            budget: null,
            request: { name: 'New local budget' },
            before: { exists: false },
            after: {
              name: 'New local budget',
              currency: null,
              published: false,
            },
            references: { nameAvailable: true },
            sideEffects: ['new local identity'],
          }
        : kind === 'restore'
          ? {
              schemaVersion: 1,
              operation: 'backups.restore',
              delivery: 'local-only',
              budget: null,
              request: { name: 'New local budget' },
              before: {
                sha256: 'a'.repeat(64),
                bytes: 123,
                sourceId: 'source',
              },
              after: { name: 'New local budget', published: false },
              references: { nameAvailable: true },
              sideEffects: ['new local restored identity'],
            }
          : {
              schemaVersion: 1,
              operation: 'budgets.clone',
              delivery: 'local-only',
              budget: proposal.budget,
              request: { id: proposal.budget.id, name: 'New local budget' },
              before: {
                sourceHash: 'a'.repeat(64),
                name: 'Source',
                currency: null,
                archived: false,
              },
              after: { name: 'New local budget', published: false },
              references: {
                nameAvailable: true,
                ignoredTables: ['kvcache', 'kvcache_key', 'messages_clock'],
              },
              sideEffects: ['new local copy and identity'],
            };
    const artifact =
      kind === 'restore'
        ? { path: join(root, 'source.actualbackup'), timeout: 60 }
        : undefined;
    try {
      await withChangeJournal(root, 1, async journal => {
        const ack = await journal.prepare('creation-ack', creation, artifact);
        ack.state = 'committed-local';
        ack.updatedAt = '2000-01-01T00:00:00.000Z';
        ack.outcome = {
          status: 'committed-local',
          changed: true,
          checkpoint: 'observed',
          affectedIds: ['new-actual-id'],
        };
        await journal.write(ack);
        const uncertain = await journal.prepare(
          'creation-uncertain',
          creation,
          artifact,
        );
        uncertain.state = 'uncertain';
        uncertain.updatedAt = ack.updatedAt;
        await journal.write(uncertain);
        const missingAck = await journal.prepare(
          'creation-missing-ack',
          creation,
          artifact,
        );
        missingAck.state = 'committed-local';
        missingAck.updatedAt = ack.updatedAt;
        await journal.write(missingAck);
        await journal.prepare('next', proposal);
        expect((await journal.read('creation-missing-ack'))?.state).toBe(
          'committed-local',
        );
        expect(await journal.read('creation-ack')).toBeNull();
        expect((await journal.read('creation-uncertain'))?.state).toBe(
          'uncertain',
        );
      });
    } finally {
      await removeFixture(root);
    }
  },
);

it('does not evict unresolved operations when they fill the bounded journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  try {
    await withChangeJournal(root, 1, async journal => {
      // Prepare a real valid token for each entry. Seed the valid persisted format
      // inside this one held journal lock; no engine mutation is involved.
      const template = await journal.prepare('pending-0', proposal);
      for (let n = 1; n < 500; n++) {
        const operationId = 'pending-' + n;
        await journal.write({
          ...template,
          operationId,
          token: createHash('sha256')
            .update(stableJson({ operationId, proposal }))
            .digest('hex'),
        });
      }
      await expect(journal.prepare('overflow', proposal)).rejects.toMatchObject(
        { code: 'INVALID_INPUT' },
      );
      const inventory = await journal.list(1);
      expect(inventory.total).toBe(500);
      expect(inventory.truncated).toBe(true);
      expect(inventory.items[0].state).toBe('prepared');
      expect(await journal.read('overflow')).toBeNull();
    });
  } finally {
    await removeFixture(root);
  }
}, 30000);

it('removes only matching redundant staging copies without promoting an uncertain receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  try {
    let directory = '';
    let token = '';
    const pending = [];
    await withChangeJournal(root, 1, async journal => {
      directory = journal.directory;
      const receipt = await journal.prepare('crash-commit', proposal);
      token = receipt.token;
      receipt.state = 'uncertain';
      await journal.write(receipt);
      for (const state of ['prepared', 'committed-local', 'synced']) {
        const path = join(
          directory,
          'crash-commit.' + randomUUID() + '.pending',
        );
        await writeFile(path, JSON.stringify({ ...receipt, state }));
        pending.push(path);
      }
      await writeFile(join(directory, 'unrelated.txt'), 'preserve me');
    });
    await withChangeJournal(root, 1, async journal => {
      expect(await journal.read('crash-commit')).toMatchObject({
        state: 'uncertain',
        token,
      });
      const inventory = await journal.list(100);
      expect(inventory.staging.total).toBe(0);
      expect(
        (await readdir(directory)).filter(name => name.endsWith('.pending')),
      ).toEqual([]);
      expect(await readFile(join(directory, 'unrelated.txt'), 'utf8')).toBe(
        'preserve me',
      );
    });
  } finally {
    await removeFixture(root);
  }
});

it('preserves orphan and malformed staging files and blocks a new apply intent before budget work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  try {
    const { orphan, malformed, receipt } = await withChangeJournal(
      root,
      1,
      async journal => {
        const receipt = await journal.prepare('prepared-apply', proposal);
        const operationId = 'orphan';
        const staged = {
          ...receipt,
          operationId,
          token: createHash('sha256')
            .update(stableJson({ operationId, proposal }))
            .digest('hex'),
          state: 'uncertain',
        };
        const orphan = join(
          journal.directory,
          operationId + '.' + randomUUID() + '.pending',
        );
        const malformed = join(
          journal.directory,
          'prepared-apply.' + randomUUID() + '.pending',
        );
        await writeFile(orphan, JSON.stringify(staged));
        await writeFile(malformed, 'incomplete JSON');
        return { orphan, malformed, receipt };
      },
    );
    const before = await readFile(orphan);
    await withChangeJournal(root, 1, async journal => {
      const inventory = await journal.list(1);
      expect(inventory.staging).toMatchObject({
        total: 2,
        truncated: true,
        blocksMutations: true,
      });
      await expect(
        journal.prepare('new-operation', proposal),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(
        journal.write({ ...receipt, state: 'uncertain' }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect((await journal.read('prepared-apply'))?.state).toBe('prepared');
      expect(await journal.read('new-operation')).toBeNull();
      expect(await readFile(orphan)).toEqual(before);
      expect(await readFile(malformed, 'utf8')).toBe('incomplete JSON');
    });
  } finally {
    await removeFixture(root);
  }
});

it('preserves linked, mismatched, and unmanaged staging files and outside data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-change-journal-'));
  try {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'private.txt'), 'outside data');
    await withChangeJournal(root, 1, async journal => {
      const receipt = await journal.prepare('protected', proposal);
      const linked = join(
        journal.directory,
        'protected.' + randomUUID() + '.pending',
      );
      await symlink(outside, linked, 'junction');
      const other = {
        ...proposal,
        request: { ...proposal.request, fields: { notes: 'different' } },
      };
      const token = createHash('sha256')
        .update(
          stableJson({ operationId: receipt.operationId, proposal: other }),
        )
        .digest('hex');
      const mismatch = join(
        journal.directory,
        'protected.' + randomUUID() + '.pending',
      );
      await writeFile(
        mismatch,
        JSON.stringify({ ...receipt, proposal: other, token }),
      );
      await writeFile(join(journal.directory, 'manual.pending'), 'unmanaged');
      const inventory = await journal.list(100);
      expect(inventory.staging.total).toBe(3);
      expect(inventory.staging.blocksMutations).toBe(true);
      expect(await readFile(join(linked, 'private.txt'), 'utf8')).toBe(
        'outside data',
      );
      expect(await readFile(mismatch, 'utf8')).toContain('different');
      expect(
        await readFile(join(journal.directory, 'manual.pending'), 'utf8'),
      ).toBe('unmanaged');
      expect((await journal.read('protected'))?.token).toBe(receipt.token);
    });
  } finally {
    await removeFixture(root);
  }
});

async function removeFixture(root: string) {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('actual-change-journal-')
  ) {
    throw new Error('Unexpected fixture path');
  }
  await rm(root, { recursive: true, force: true });
}

it('retains uncertain or incomplete closing-transfer acknowledgements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-close-journal-'));
  const closing: AccountCloseProposal = {
    schemaVersion: 1,
    operation: 'accounts.close',
    budget: proposal.budget,
    request: { id: 'source', transferAccountId: 'destination' },
    seed: { id: 'closing-source', date: '2026-10-04', sortOrder: 10 },
    before: { sourceHash: 'a'.repeat(64) },
    after: {
      action: 'closed',
      source: {
        id: 'closing-source',
        account: 'source',
        category: null,
        date: '2026-10-04',
        amount: -500,
      },
      counterpart: { account: 'destination', amount: 500 },
      unlink: { clearFields: [], remoteRemoval: null, hasToken: false },
    },
    references: {},
    sideEffects: ['close'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      for (const id of [
        'confirmed-close',
        'uncertain-close',
        'incomplete-close',
      ]) {
        const receipt = await journal.prepare(id, closing);
        receipt.state = 'synced';
        receipt.updatedAt = '2000-01-01T00:00:00.000Z';
        receipt.outcome = {
          status: 'committed-local',
          changed: true,
          checkpoint: 'observed',
          affectedIds: ['source', 'closing-source', 'counterpart'],
          accountClosure: {
            accountId: 'source',
            action: 'closed',
            addedTransactionIds:
              id === 'incomplete-close'
                ? ['closing-source']
                : ['closing-source', 'counterpart'],
            deletedTransactionIds: [],
            updatedTransactionIds: [],
            deletedPayeeIds: [],
            unlink: {
              localChanged: false,
              remoteStatus:
                id === 'uncertain-close' ? 'uncertain' : 'not-required',
            },
          },
        };
        await journal.write(receipt);
      }
      await journal.prepare('next-close', proposal);
      expect(await journal.read('confirmed-close')).toBeNull();
      expect((await journal.read('uncertain-close'))?.state).toBe('synced');
      expect((await journal.read('incomplete-close'))?.state).toBe('synced');
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('expires category creation only with complete generated category and mapping acknowledgements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-category-journal-'));
  const creation: CategoryCreationProposal = {
    schemaVersion: 1,
    operation: 'categories.create',
    budget: proposal.budget,
    request: { name: 'New category', group_id: 'group' },
    before: { sourceHash: 'a'.repeat(64) },
    after: {
      category: { name: 'New category', cat_group: 'group', sort_order: 10 },
      updatedCategories: [{ id: 'sibling', sort_order: 20 }],
      mapping: { creates: true },
    },
    references: {},
    sideEffects: ['create'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      for (const id of [
        'category-ack',
        'category-missing',
        'category-incomplete',
        'category-uncertain',
      ]) {
        const receipt = await journal.prepare(id, creation);
        receipt.state = id === 'category-uncertain' ? 'uncertain' : 'synced';
        receipt.updatedAt = '2000-01-01T00:00:00.000Z';
        if (id === 'category-ack' || id === 'category-incomplete') {
          receipt.outcome = {
            status: 'committed-local',
            changed: true,
            checkpoint: 'observed',
            affectedIds: ['created', 'sibling'],
            categoryCreation: {
              categoryId: 'created',
              mappingId: id === 'category-ack' ? 'created' : 'wrong-mapping',
              updatedCategoryIds: ['sibling'],
            },
          };
        }
        await journal.write(receipt);
      }
      await journal.prepare('category-next', proposal);
      expect(await journal.read('category-ack')).toBeNull();
      expect((await journal.read('category-missing'))?.state).toBe('synced');
      expect((await journal.read('category-incomplete'))?.state).toBe('synced');
      expect((await journal.read('category-uncertain'))?.state).toBe(
        'uncertain',
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('decodes category deletion receipts and retains uncertain outcomes', async () => {
  const root = await mkdtemp(
    join(tmpdir(), 'actual-category-deletion-journal-'),
  );
  const deletion: CategoryDeletionProposal = {
    schemaVersion: 1,
    operation: 'categories.delete',
    budget: proposal.budget,
    request: { id: 'category' },
    before: {
      sourceHash: 'a'.repeat(64),
      category: { id: 'category', tombstone: 0 },
    },
    after: {
      category: { id: 'category', tombstone: 1 },
      mappings: [],
      budgetTransfers: [],
    },
    references: {},
    sideEffects: ['delete'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      const receipt = await journal.prepare(
        'uncertain-category-delete',
        deletion,
      );
      receipt.state = 'uncertain';
      receipt.updatedAt = '2000-01-01T00:00:00.000Z';
      await journal.write(receipt);
      expect((await journal.read(receipt.operationId))?.proposal).toEqual(
        deletion,
      );
      await journal.prepare('next', proposal);
      expect((await journal.read(receipt.operationId))?.state).toBe(
        'uncertain',
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('expires group creation only with a complete generated identity acknowledgement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actual-group-creation-journal-'));
  const creation: CategoryGroupCreationProposal = {
    schemaVersion: 1,
    operation: 'category-groups.create',
    budget: proposal.budget,
    request: { name: 'Group' },
    before: { sourceHash: 'a'.repeat(64) },
    after: { group: { name: 'Group', sort_order: 1 } },
    references: {},
    sideEffects: ['create'],
  };
  try {
    await withChangeJournal(root, 1, async journal => {
      for (const id of [
        'group-ack',
        'group-missing',
        'group-incomplete',
        'group-uncertain',
      ]) {
        const receipt = await journal.prepare(id, creation);
        receipt.state = id === 'group-uncertain' ? 'uncertain' : 'synced';
        receipt.updatedAt = '2000-01-01T00:00:00.000Z';
        if (id === 'group-ack' || id === 'group-incomplete') {
          receipt.outcome = {
            status: 'committed-local',
            changed: true,
            checkpoint: 'observed',
            affectedIds: ['created-group'],
            groupCreation: {
              groupId: id === 'group-ack' ? 'created-group' : '',
            },
          };
        }
        await journal.write(receipt);
      }
      await journal.prepare('group-next', proposal);
      expect(await journal.read('group-ack')).toBeNull();
      expect((await journal.read('group-missing'))?.state).toBe('synced');
      expect((await journal.read('group-incomplete'))?.state).toBe('synced');
      expect((await journal.read('group-uncertain'))?.state).toBe('uncertain');
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
