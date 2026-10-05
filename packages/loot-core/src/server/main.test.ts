// @ts-strict-ignore
import { deserializeClock, getClock } from '@actual-app/crdt';
import { v4 as uuidv4 } from 'uuid';

import { expectSnapshotWithDiffer } from '#mocks/util';
import * as asyncStorage from '#platform/server/asyncStorage';
import * as connection from '#platform/server/connection';
import * as fs from '#platform/server/fs';
import * as monthUtils from '#shared/months';

import {
  inspectAccountClosure,
  inspectAccountUnlink,
  performAccountClosure,
} from './accounts/app';
import * as budgetActions from './budget/actions';
import {
  inspectCategoryDeletion,
  inspectCategoryGroupDeletion,
} from './budget/app';
import * as budget from './budget/base';
import * as db from './db';
import { handlers } from './main';
import {
  disableGlobalMutations,
  enableGlobalMutations,
  runHandler,
  runMutator,
} from './mutators';
import * as postModule from './post';
import * as prefs from './prefs';
import { getServer, setServer } from './server-config';
import * as sheet from './sheet';

vi.mock('./post');

beforeEach(async () => {
  await global.emptyDatabase()();
  disableGlobalMutations();
});

afterEach(async () => {
  await runHandler(handlers['close-budget']);
  connection.resetEvents();
  enableGlobalMutations();
  global.currentMonth = null;
});

async function createTestBudget(name) {
  const templatePath = fs.join(__dirname, '/../mocks/files', name);
  const budgetPath = fs.join(__dirname, '/../mocks/files/budgets/test-budget');
  fs._setDocumentDir(fs.join(budgetPath, '..'));

  await fs.mkdir(budgetPath);
  await fs.copyFile(
    fs.join(templatePath, 'metadata.json'),
    fs.join(budgetPath, 'metadata.json'),
  );
  await fs.copyFile(
    fs.join(templatePath, 'db.sqlite'),
    fs.join(budgetPath, 'db.sqlite'),
  );
}

describe('Budgets', () => {
  afterEach(async () => {
    // Nested teardown runs before the outer hook. Close SQLite before deleting
    // the disposable fixture so Windows can release its database file.
    await runHandler(handlers['close-budget']);
    fs._setDocumentDir(null);
    const budgetPath = fs.join(
      __dirname,
      '/../mocks/files/budgets/test-budget',
    );

    if (await fs.exists(budgetPath)) {
      await fs.removeDirRecursively(budgetPath);
    }
  });

  test('budget is successfully loaded', async () => {
    await createTestBudget('default-budget-template');

    // Grab the clock to compare later
    await db.openDatabase('test-budget');
    const row = await db.first<db.DbClockMessage>(
      'SELECT * FROM messages_clock',
    );

    const { error } = await runHandler(handlers['load-budget'], {
      id: 'test-budget',
    });
    expect(error).toBe(undefined);

    // Make sure the prefs were loaded
    expect(prefs.getPrefs().id).toBe('test-budget');

    // Make sure the clock has been loaded
    expect(getClock()).toEqual(deserializeClock(row.clock));
  });

  test('budget detects out of sync migrations', async () => {
    await createTestBudget('default-budget-template');

    await db.openDatabase('test-budget');
    db.runQuery('INSERT INTO __migrations__ (id) VALUES (1000)');

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => null);

    const { error } = await runHandler(handlers['load-budget'], {
      id: 'test-budget',
    });
    // There should be an error and the budget should be unloaded
    expect(error).toBe('out-of-sync-migrations');
    expect(db.getDatabase()).toBe(null);
    expect(prefs.getPrefs()).toBe(null);

    spy.mockRestore();
  });
});

describe('Accounts', () => {
  test('forced closure rejects a missing transfer counterpart before unlinking', async () => {
    const id = await runHandler(handlers['account-create'], {
      name: 'Deleting',
    });
    await runMutator(() =>
      db.insertTransaction({
        id: 'broken-transfer',
        account: id,
        amount: -900,
        date: '2026-10-01',
        transfer_id: 'missing-counterpart',
      }),
    );
    db.runQuery(
      "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-account', account_sync_source = 'simpleFin' WHERE id = ?",
      [id],
    );
    const capture = async () => ({
      accounts: await db.all('SELECT * FROM accounts ORDER BY id'),
      payees: await db.all('SELECT * FROM payees ORDER BY id'),
      transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
      messages: await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
    });
    const before = await capture();
    await expect(
      runMutator(() => performAccountClosure({ id, forced: true })),
    ).rejects.toThrow('Transfer counterpart');
    expect(await capture()).toEqual(before);
  });

  test.each(['acknowledged', 'uncertain'])(
    'closure outcome discloses provider removal: %s',
    async status => {
      const previousServer = getServer();
      const originalGetItem = asyncStorage.getItem;
      const tokenReader = vi
        .spyOn(asyncStorage, 'getItem')
        .mockImplementation(async key =>
          key === 'user-token' ? 'synthetic-token' : originalGetItem(key),
        );
      const removal = vi.spyOn(postModule, 'post');
      if (status === 'acknowledged') {
        removal.mockResolvedValue({ status: 'ok' });
      } else {
        removal.mockRejectedValue(
          new Error('Synthetic lost provider response'),
        );
      }
      try {
        setServer('http://synthetic.invalid');
        await runMutator(() =>
          db.insertAccount({ id: 'closing', name: 'Closing' }),
        );
        db.runQuery(
          "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-account', account_sync_source = 'goCardless' WHERE id = 'closing'",
        );
        db.runQuery(
          "INSERT INTO banks (id, bank_id) VALUES ('synthetic-bank', 'synthetic-requisition')",
        );
        const outcome = await runMutator(() =>
          performAccountClosure({ id: 'closing' }),
        );
        expect(outcome).toMatchObject({
          action: 'deleted',
          accountId: 'closing',
          unlink: { localChanged: true, remoteStatus: status },
          addedTransactionIds: [],
          deletedTransactionIds: [],
          updatedTransactionIds: [],
        });
        expect(JSON.stringify(outcome)).not.toContain('synthetic-token');
        expect((await db.getAccount('closing')).tombstone).toBe(1);
        expect((await db.getAccount('closing')).bank).toBeNull();
        expect(removal).toHaveBeenCalledTimes(1);
      } finally {
        removal.mockRestore();
        tokenReader.mockRestore();
        setServer(previousServer?.BASE_SERVER ?? null);
      }
    },
  );

  test('closure acknowledges exact generated transfers and its bound date', async () => {
    const id = await runHandler(handlers['account-create'], {
      name: 'Closing',
      balance: -12.34,
    });
    const destination = await runHandler(handlers['account-create'], {
      name: 'Destination',
    });
    const outcome = await runMutator(() =>
      performAccountClosure({
        id,
        transferAccountId: destination,
        closingDate: '2026-10-04',
      }),
    );
    expect(outcome.action).toBe('closed');
    expect(outcome.addedTransactionIds).toHaveLength(2);
    const [source, counterpart] = await Promise.all(
      outcome.addedTransactionIds.map(transactionId =>
        db.getTransaction(transactionId),
      ),
    );
    expect(source).toMatchObject({
      account: id,
      amount: 1234,
      date: '2026-10-04',
      transfer_id: counterpart.id,
    });
    expect(counterpart).toMatchObject({
      account: destination,
      amount: -1234,
      date: '2026-10-04',
      transfer_id: source.id,
    });
    expect(outcome.unlink).toEqual({
      localChanged: false,
      remoteStatus: 'not-required',
    });
    expect(await runHandler(handlers['account-close'], { id })).toBeUndefined();
    const repeated = await runMutator(() =>
      performAccountClosure({ id, forced: true }),
    );
    expect(repeated.action).toBe('unchanged');
    expect(repeated.addedTransactionIds).toEqual([]);
    expect((await db.getAccount(id)).tombstone).toBe(0);
  });

  test('forced closure acknowledges deleted rows and preserves transfer counterpart amount', async () => {
    const id = await runHandler(handlers['account-create'], {
      name: 'Deleting',
    });
    const destination = await runHandler(handlers['account-create'], {
      name: 'Destination',
    });
    const payees = await db.all<db.DbPayee>('SELECT * FROM payees');
    const sourcePayee = payees.find(payee => payee.transfer_acct === id);
    const targetPayee = payees.find(
      payee => payee.transfer_acct === destination,
    );
    await runHandler(handlers['transaction-add'], {
      id: 'transfer',
      account: id,
      payee: targetPayee.id,
      amount: -900,
      date: '2026-10-01',
    });
    await runMutator(async () => {
      await db.insertTransaction({
        id: 'split-parent',
        account: id,
        amount: -300,
        date: '2026-10-01',
        is_parent: true,
      });
      await db.insertTransaction({
        id: 'split-a',
        account: id,
        amount: -500,
        date: '2026-10-01',
        is_child: true,
        parent_id: 'split-parent',
      });
      await db.insertTransaction({
        id: 'split-b',
        account: id,
        amount: 200,
        date: '2026-10-01',
        is_child: true,
        parent_id: 'split-parent',
      });
    });
    const source = await db.getTransaction('transfer');
    const beforeCounterpart = await db.getTransaction(source.transfer_id);
    const outcome = await runMutator(() =>
      performAccountClosure({ id, forced: true }),
    );
    expect(outcome.action).toBe('deleted');
    expect(outcome.deletedTransactionIds).toEqual([
      'split-a',
      'split-b',
      'split-parent',
      'transfer',
    ]);
    for (const transactionId of outcome.deletedTransactionIds) {
      expect(await db.getTransaction(transactionId)).toBeUndefined();
    }
    expect(outcome.updatedTransactionIds).toEqual([beforeCounterpart.id]);
    expect(outcome.deletedPayeeIds).toEqual([sourcePayee.id]);
    expect((await db.getAccount(id)).tombstone).toBe(1);
    expect((await db.getPayee(sourcePayee.id)).tombstone).toBe(1);
    expect(await db.getTransaction('transfer')).toBeUndefined();
    expect(await db.getTransaction(beforeCounterpart.id)).toEqual({
      ...beforeCounterpart,
      payee: null,
      transfer_id: null,
    });
  });

  test.each(['last linked account', 'other linked account', 'no token'])(
    'remote unlink keeps provider removal scope: %s',
    async scenario => {
      const previousServer = getServer();
      const originalGetItem = asyncStorage.getItem;
      const tokenReader = vi
        .spyOn(asyncStorage, 'getItem')
        .mockImplementation(async key =>
          key === 'user-token'
            ? scenario === 'no token'
              ? null
              : 'synthetic-token'
            : originalGetItem(key),
        );
      const removal = vi
        .spyOn(postModule, 'post')
        .mockResolvedValue({ status: 'ok' });
      try {
        setServer('http://synthetic.invalid');
        await runMutator(async () => {
          await db.insertAccount({ id: 'closing', name: 'Closing' });
          if (scenario === 'other linked account') {
            await db.insertAccount({ id: 'other', name: 'Other' });
          }
        });
        db.runQuery(
          "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-account', account_sync_source = 'goCardless' WHERE id = 'closing'",
        );
        db.runQuery(
          "INSERT INTO banks (id, bank_id) VALUES ('synthetic-bank', 'synthetic-requisition')",
        );
        if (scenario === 'other linked account') {
          // Preserve the existing provider scope, including closed/deleted rows.
          db.runQuery(
            "UPDATE accounts SET bank = 'synthetic-bank', closed = 1, tombstone = 1 WHERE id = 'other'",
          );
        }
        const beforeInspection = {
          accounts: await db.all('SELECT * FROM accounts ORDER BY id'),
          banks: await db.all('SELECT * FROM banks ORDER BY id'),
          messages: await db.all(
            'SELECT * FROM messages_crdt ORDER BY timestamp',
          ),
        };
        const inspection = await inspectAccountUnlink({ id: 'closing' });
        expect(inspection.hasToken).toBe(scenario !== 'no token');
        expect(inspection.otherAccounts.map(account => account.id)).toEqual(
          scenario === 'other linked account' ? ['other'] : [],
        );
        expect(inspection.remoteRemoval).toEqual(
          scenario === 'last linked account'
            ? {
                url: getServer().GOCARDLESS_SERVER + '/remove-account',
                requisitionId: 'synthetic-requisition',
              }
            : null,
        );
        expect(JSON.stringify(inspection)).not.toContain('synthetic-token');
        expect(removal).not.toHaveBeenCalled();
        expect({
          accounts: await db.all('SELECT * FROM accounts ORDER BY id'),
          banks: await db.all('SELECT * FROM banks ORDER BY id'),
          messages: await db.all(
            'SELECT * FROM messages_crdt ORDER BY timestamp',
          ),
        }).toEqual(beforeInspection);
        await runHandler(handlers['account-unlink'], { id: 'closing' });
        expect((await db.getAccount('closing')).bank).toBeNull();
        expect(removal).toHaveBeenCalledTimes(
          scenario === 'last linked account' ? 1 : 0,
        );
        if (scenario === 'last linked account') {
          expect(removal).toHaveBeenCalledWith(
            getServer().GOCARDLESS_SERVER + '/remove-account',
            { requisitionId: 'synthetic-requisition' },
            { 'X-ACTUAL-TOKEN': 'synthetic-token' },
          );
        }
      } finally {
        removal.mockRestore();
        tokenReader.mockRestore();
        setServer(previousServer?.BASE_SERVER ?? null);
      }
    },
  );

  test.each(['missing bank', 'missing server'])(
    'invalid remote unlink preserves account: %s',
    async failure => {
      const originalGetItem = asyncStorage.getItem;
      const tokenReader = vi
        .spyOn(asyncStorage, 'getItem')
        .mockImplementation(async key =>
          key === 'user-token' ? 'synthetic-token' : originalGetItem(key),
        );
      const previousServer = getServer();
      try {
        setServer(null);
        await runMutator(() =>
          db.insertAccount({ id: 'closing', name: 'Closing' }),
        );
        db.runQuery(
          "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-account', account_sync_source = 'goCardless', balance_current = 6789 WHERE id = 'closing'",
        );
        if (failure === 'missing server') {
          db.runQuery(
            "INSERT INTO banks (id, bank_id) VALUES ('synthetic-bank', 'synthetic-requisition')",
          );
        }
        expect(await asyncStorage.getItem('user-token')).toBe(
          'synthetic-token',
        );
        const before = await db.getAccount('closing');
        expect(before.account_sync_source).toBe('goCardless');
        const messages = await db.all(
          'SELECT * FROM messages_crdt ORDER BY timestamp',
        );
        await expect(
          runHandler(handlers['account-close'], { id: 'closing' }),
        ).rejects.toThrow(
          failure === 'missing bank'
            ? 'Bank with ID'
            : 'Failed to get server config',
        );
        expect(await db.getAccount('closing')).toEqual(before);
        expect(
          await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
        ).toEqual(messages);
      } finally {
        tokenReader.mockRestore();
        setServer(previousServer?.BASE_SERVER ?? null);
      }
    },
  );

  test('account closure inspection is read-only and includes future split balances', async () => {
    await runMutator(async () => {
      await db.insertAccount({ id: 'closing', name: 'Closing' });
      await db.insertAccount({ id: 'destination', name: 'Destination' });
      await db.insertPayee({
        id: 'transfer-closing',
        name: '',
        transfer_acct: 'closing',
      });
      await db.insertPayee({
        id: 'transfer-destination',
        name: '',
        transfer_acct: 'destination',
      });
      await db.insertTransaction({
        id: 'future',
        account: 'closing',
        amount: -1234,
        date: '2099-01-01',
      });
      await db.insertTransaction({
        id: 'parent',
        account: 'closing',
        amount: 300,
        date: '2099-01-01',
        is_parent: true,
      });
      await db.insertTransaction({
        id: 'child-a',
        account: 'closing',
        amount: 500,
        date: '2099-01-01',
        is_child: true,
        parent_id: 'parent',
      });
      await db.insertTransaction({
        id: 'child-b',
        account: 'closing',
        amount: -200,
        date: '2099-01-01',
        is_child: true,
        parent_id: 'parent',
      });
    });
    const capture = async () => ({
      accounts: await db.all('SELECT * FROM accounts ORDER BY id'),
      transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
      payees: await db.all('SELECT * FROM payees ORDER BY id'),
      messages: await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
    });
    const before = await capture();
    const inspection = await inspectAccountClosure({
      id: 'closing',
      transferAccountId: 'destination',
    });
    expect(inspection.balance).toBe(-934);
    expect(inspection.numTransactions).toBe(4);
    expect(inspection.sourceTransferPayee?.id).toBe('transfer-closing');
    expect(inspection.destinationTransferPayee?.id).toBe(
      'transfer-destination',
    );
    expect(await capture()).toEqual(before);
    await runHandler(handlers['account-close'], {
      id: 'closing',
      transferAccountId: 'destination',
    });
    expect((await db.getAccount('closing')).closed).toBe(1);
    expect(
      await runHandler(handlers['account-properties'], { id: 'closing' }),
    ).toMatchObject({ balance: 0 });
    const closing = await db.first<db.DbViewTransaction>(
      "SELECT * FROM v_transactions WHERE notes = 'Closing account' AND account = 'closing'",
    );
    expect(closing.amount).toBe(934);
    const counterpart = await db.getTransaction(closing.transfer_id);
    expect(counterpart.account).toBe('destination');
    expect(counterpart.amount).toBe(-934);
  });

  test.each([
    { label: 'missing required destination' },
    { label: 'self transfer', transferAccountId: 'closing' },
    { label: 'missing destination', transferAccountId: 'missing' },
    {
      label: 'deleted destination',
      transferAccountId: 'destination',
      deletedDestination: true,
    },
    {
      label: 'missing destination payee',
      transferAccountId: 'destination',
      missingDestinationPayee: true,
    },
    {
      label: 'missing closing category',
      transferAccountId: 'destination',
      categoryId: 'missing',
    },
    { label: 'missing deletion payee', forced: true, missingSourcePayee: true },
    {
      label: 'missing closing payee',
      transferAccountId: 'destination',
      missingSourcePayee: true,
    },
  ])(
    'invalid account closure preserves provider and ledger: $label',
    async options => {
      await runMutator(async () => {
        await db.insertAccount({ id: 'closing', name: 'Closing' });
        await db.insertAccount({ id: 'destination', name: 'Destination' });
        if (!options.missingSourcePayee) {
          await db.insertPayee({
            id: 'transfer-closing',
            name: '',
            transfer_acct: 'closing',
          });
        }
        if (!options.missingDestinationPayee) {
          await db.insertPayee({
            id: 'transfer-destination',
            name: '',
            transfer_acct: 'destination',
          });
        }
        await db.insertTransaction({
          id: 'future-balance',
          account: 'closing',
          amount: -1234,
          date: '2099-01-01',
        });
      });
      db.runQuery(
        "UPDATE accounts SET bank = 'synthetic-bank', account_id = 'synthetic-account', account_sync_source = 'simpleFin', balance_current = 6789 WHERE id = 'closing'",
      );
      if (options.deletedDestination) {
        db.runQuery(
          "UPDATE accounts SET tombstone = 1 WHERE id = 'destination'",
        );
      }
      const capture = async () => ({
        accounts: await db.all('SELECT * FROM accounts ORDER BY id'),
        transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
        payees: await db.all('SELECT * FROM payees ORDER BY id'),
        messages: await db.all(
          'SELECT * FROM messages_crdt ORDER BY timestamp',
        ),
      });
      const before = await capture();
      await expect(
        runHandler(handlers['account-close'], {
          id: 'closing',
          transferAccountId: options.transferAccountId,
          categoryId: options.categoryId,
          forced: options.forced,
        }),
      ).rejects.toThrow();
      expect(await capture()).toEqual(before);
    },
  );

  test('Transfers are properly updated', async () => {
    await runMutator(async () => {
      await db.insertAccount({ id: 'one', name: 'one' });
      await db.insertAccount({ id: 'two', name: 'two' });
      await db.insertAccount({ id: 'three', name: 'three' });
      await db.insertPayee({
        id: 'transfer-one',
        name: '',
        transfer_acct: 'one',
      });
      await db.insertPayee({
        id: 'transfer-two',
        name: '',
        transfer_acct: 'two',
      });
      await db.insertPayee({
        id: 'transfer-three',
        name: '',
        transfer_acct: 'three',
      });
    });

    const id = 'test-transfer';
    await runHandler(handlers['transaction-add'], {
      id,
      account: 'one',
      amount: 5000,
      payee: 'transfer-two',
      date: '2017-01-01',
    });
    const differ = expectSnapshotWithDiffer(
      await db.all<db.DbTransaction>('SELECT * FROM transactions'),
    );

    await runHandler(handlers['transaction-update'], {
      ...(await db.getTransaction(id)),
      payee: 'transfer-three',
      date: '2017-01-03',
    });
    differ.expectToMatchDiff(
      await db.all<db.DbTransaction>('SELECT * FROM transactions'),
    );

    const transaction = await db.getTransaction(id);
    await runHandler(handlers['transaction-delete'], transaction);
    differ.expectToMatchDiff(
      await db.all<db.DbTransaction>('SELECT * FROM transactions'),
    );
  });
});

describe('Budget', () => {
  test('new budgets should be created', async () => {
    const spreadsheet = await sheet.loadSpreadsheet(db);

    await runMutator(async () => {
      await db.insertCategoryGroup({
        id: 'incomeGroup',
        name: 'incomeGroup',
        is_income: 1,
      });
      await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
      await db.insertCategory({ name: 'foo', cat_group: 'group1' });
      await db.insertCategory({ name: 'bar', cat_group: 'group1' });
    });

    let bounds = await runHandler(handlers['get-budget-bounds']);
    expect(bounds.start).toBe('2016-10');
    expect(bounds.end).toBe('2018-01');
    expect(spreadsheet.meta().createdMonths).toMatchSnapshot();

    // Add a transaction (which needs an account) earlier then the
    // current earliest budget to test if it creates the necessary
    // budgets for the earlier months
    db.runQuery("INSERT INTO accounts (id, name) VALUES ('one', 'boa')");
    await runHandler(handlers['transaction-add'], {
      id: uuidv4(),
      date: '2016-05-06',
      amount: 50,
      account: 'one',
    });

    // Fast-forward in time to a future month and make sure it creates
    // budgets for the months in the future
    global.currentMonth = '2017-02';

    bounds = await runHandler(handlers['get-budget-bounds']);
    expect(bounds.start).toBe('2016-02');
    expect(bounds.end).toBe('2018-02');
    expect(spreadsheet.meta().createdMonths).toMatchSnapshot();

    await new Promise(resolve => spreadsheet.onFinish(resolve));
  });

  test('budget updates when changing a category', async () => {
    const spreadsheet = await sheet.loadSpreadsheet(db);
    function captureChangedCells(func) {
      return new Promise<unknown[]>(resolve => {
        let changed = [];
        const remove = spreadsheet.addEventListener('change', ({ names }) => {
          changed = changed.concat(names);
        });
        func().then(() => {
          remove();
          spreadsheet.onFinish(() => {
            resolve(changed);
          });
        });
      });
    }

    // Force the system to start tracking these months so budgets are
    // automatically updated when adding/deleting categories
    db.runQuery('INSERT INTO created_budgets (month) VALUES (?)', ['2017-01']);
    db.runQuery('INSERT INTO created_budgets (month) VALUES (?)', ['2017-02']);
    db.runQuery('INSERT INTO created_budgets (month) VALUES (?)', ['2017-03']);
    db.runQuery('INSERT INTO created_budgets (month) VALUES (?)', ['2017-04']);

    let categories;
    await captureChangedCells(async () => {
      await runMutator(() =>
        db.insertCategoryGroup({ id: 'group1', name: 'group1' }),
      );
      categories = [
        await runHandler(handlers['category-create'], {
          name: 'foo',
          groupId: 'group1',
        }),
        await runHandler(handlers['category-create'], {
          name: 'bar',
          groupId: 'group1',
        }),
        await runHandler(handlers['category-create'], {
          name: 'baz',
          groupId: 'group1',
        }),
        await runHandler(handlers['category-create'], {
          name: 'biz',
          groupId: 'group1',
        }),
      ];
    });

    db.runQuery("INSERT INTO accounts (id, name) VALUES ('boa', 'boa')");
    const trans = {
      id: 'boa-transaction',
      date: '2017-02-06',
      amount: 5000,
      account: 'boa',
      category: categories[0],
    };
    // Test insertions
    let changed = await captureChangedCells(() =>
      runHandler(handlers['transaction-add'], trans),
    );
    expect(
      changed.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0)),
    ).toMatchSnapshot();
    // Test updates
    changed = await captureChangedCells(async () => {
      await runHandler(handlers['transaction-update'], {
        ...(await db.getTransaction(trans.id)),
        amount: 7000,
      });
    });
    expect(
      changed.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0)),
    ).toMatchSnapshot();
    // Test deletions
    changed = await captureChangedCells(async () => {
      await runHandler(handlers['transaction-delete'], { id: trans.id });
    });
    expect(
      changed.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0)),
    ).toMatchSnapshot();
  });
});

describe('Categories', () => {
  test('can be deleted', async () => {
    await sheet.loadSpreadsheet(db);

    await runMutator(async () => {
      await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
      await db.insertCategory({ id: 'foo', name: 'foo', cat_group: 'group1' });
      await db.insertCategory({ id: 'bar', name: 'bar', cat_group: 'group1' });
    });

    let categories = await db.getCategories();
    expect(categories.length).toBe(2);
    expect(categories.find(cat => cat.name === 'foo')).not.toBeNull();
    expect(categories.find(cat => cat.name === 'bar')).not.toBeNull();
    await runHandler(handlers['category-delete'], { id: 'foo' });

    categories = await db.getCategories();
    expect(categories.length).toBe(1);
    expect(categories.find(cat => cat.name === 'bar')).not.toBeNull();
  });

  test('transfers properly when deleted', async () => {
    await sheet.loadSpreadsheet(db);

    const transId = await runMutator(async () => {
      await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
      await db.insertCategoryGroup({ id: 'group1b', name: 'group1b' });
      await db.insertCategoryGroup({
        id: 'group2',
        name: 'group2',
        is_income: 1,
      });
      await db.insertCategory({ id: 'foo', name: 'foo', cat_group: 'group1' });
      await db.insertCategory({ id: 'bar', name: 'bar', cat_group: 'group1b' });
      await db.insertCategory({
        id: 'income1',
        name: 'income1',
        is_income: 1,
        cat_group: 'group2',
      });
      await db.insertCategory({
        id: 'income2',
        name: 'income2',
        is_income: 1,
        cat_group: 'group2',
      });

      return await db.insertTransaction({
        date: '2017-01-01',
        account: 'acct',
        amount: 4500,
        category: 'foo',
      });
    });

    await budget.createAllBudgets();

    // Set a budget value for the category `foo` of 1000
    const sheetName = monthUtils.sheetForMonth('2018-01');
    await budgetActions.setBudget({
      category: 'foo',
      month: '2018-01',
      amount: 1000,
    });
    expect(sheet.getCellValue(sheetName, 'group-budget-group1')).toBe(1000);
    expect(sheet.getCellValue(sheetName, 'group-budget-group1b')).toBe(0);

    // Make sure the transaction has a category of `foo`
    let trans = await db.getTransaction(transId);
    expect(trans.category).toBe('foo');

    await runHandler(handlers['category-delete'], {
      id: 'foo',
      transferId: 'bar',
    });

    // Make sure the transaction has been updated
    trans = await db.getTransaction(transId);
    expect(trans.category).toBe('bar');

    // Make sure the budget value was transferred
    expect(sheet.getCellValue(sheetName, 'group-budget-group1')).toBe(0);
    expect(sheet.getCellValue(sheetName, 'group-budget-group1b')).toBe(1000);

    // Transfering an income category to an expense just doesn't make
    // sense. Make sure this doesn't do anything.
    await expect(
      runHandler(handlers['category-delete'], {
        id: 'income1',
        transferId: 'bar',
      }),
    ).rejects.toThrow('Cannot transfer between income and expense categories.');

    let categories = await db.getCategories();
    expect(categories.find(cat => cat.id === 'income1')).toBeDefined();

    // Make sure you can delete income categories
    await runHandler(handlers['category-delete'], {
      id: 'income1',
      transferId: 'income2',
    });

    categories = await db.getCategories();
    expect(categories.find(cat => cat.id === 'income1')).not.toBeDefined();
  });

  test('do not count as overspent when deleted', async () => {
    await sheet.loadSpreadsheet(db);

    await runMutator(async () => {
      await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
      await db.insertCategoryGroup({
        id: 'group2',
        name: 'income',
        is_income: 1,
      });
      await db.insertCategory({ id: 'foo', name: 'foo', cat_group: 'group1' });
      await db.insertCategory({ id: 'bar', name: 'bar', cat_group: 'group1' });
      await db.insertAccount({ id: 'acct', name: 'acct' });

      // A deposit straight into the category, like a refund
      await db.insertTransaction({
        date: '2017-01-01',
        account: 'acct',
        amount: 10000,
        category: 'foo',
      });
    });

    await budget.createAllBudgets();

    // Move 1000 from `foo` to `bar`, which leaves `foo` with a negative
    // budgeted amount
    await budgetActions.setBudget({
      category: 'foo',
      month: '2017-01',
      amount: -1000,
    });
    await budgetActions.setBudget({
      category: 'bar',
      month: '2017-01',
      amount: 1000,
    });
    await sheet.waitOnSpreadsheet();

    const nextSheetName = monthUtils.sheetForMonth('2017-02');
    expect(sheet.getCellValue(nextSheetName, 'last-month-overspent')).toBe(0);
    const toBudget = sheet.getCellValue(nextSheetName, 'to-budget');

    await runHandler(handlers['category-delete'], {
      id: 'foo',
      transferId: 'bar',
    });
    await sheet.waitOnSpreadsheet();

    // The deleted category should not leave any overspending behind
    expect(sheet.getCellValue(nextSheetName, 'last-month-overspent')).toBe(0);
    expect(sheet.getCellValue(nextSheetName, 'to-budget')).toBe(toBudget);
  });
});

test('partial category owner updates preserve template settings and other raw columns', async () => {
  const group = await db.insertCategoryGroup({ name: 'Partial owner group' });
  const id = await db.insertCategory({
    name: 'Owner category',
    cat_group: group,
    is_income: 0,
    hidden: 0,
  });
  await db.update('categories', {
    id,
    template_settings: JSON.stringify({ source: 'ui' }),
    goal_def: 'custom goal',
    cleanup_def: 'custom cleanup',
  });
  const before = await db.first<db.DbCategory>(
    'SELECT * FROM categories WHERE id = ?',
    [id],
  );
  const otherId = await db.insertCategory({
    name: 'Other category',
    cat_group: group,
    is_income: 0,
  });
  const other = await db.first<db.DbCategory>(
    'SELECT * FROM categories WHERE id = ?',
    [otherId],
  );
  await runHandler(handlers['category-update'], { id, hidden: true });
  expect(await db.first('SELECT * FROM categories WHERE id = ?', [id])).toEqual(
    { ...before, hidden: 1 },
  );
  expect(
    await db.first('SELECT * FROM categories WHERE id = ?', [otherId]),
  ).toEqual(other);
});

test.each([0, 1] as const)(
  'category deletion inspection preserves income=%s canonical effects without writes',
  async is_income => {
    await sheet.loadSpreadsheet(db);
    sheet.get().meta().createdMonths = new Set(['2024-01']);
    await db.insertCategoryGroup({
      id: 'deletion-owner-group',
      name: 'Deletion owner group',
      is_income,
    });
    for (const id of ['deletion-source', 'deletion-target']) {
      await db.insertCategory({
        id,
        name: id,
        cat_group: 'deletion-owner-group',
        is_income,
      });
    }
    await budgetActions.setBudget({
      month: '2024-01',
      category: 'deletion-source',
      amount: 700,
    });
    await budgetActions.setBudget({
      month: '2024-01',
      category: 'deletion-target',
      amount: 200,
    });
    const snapshot = async () => ({
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
      mappings: await db.all('SELECT * FROM category_mapping ORDER BY id'),
      budgets: await db.all('SELECT * FROM zero_budgets ORDER BY id'),
      messages: await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
    });
    const before = await snapshot();
    const plan = await inspectCategoryDeletion({
      id: 'deletion-source',
      transferId: 'deletion-target',
    });
    expect(plan.category).toEqual(await db.getCategory('deletion-source'));
    expect(plan.transfer).toEqual(await db.getCategory('deletion-target'));
    expect(plan.budgetTransfers.map(row => row.amount)).toEqual(
      is_income ? [] : [900],
    );
    expect(plan.deletion).toEqual(
      await db.inspectCategoryDeletion(
        { id: 'deletion-source' },
        'deletion-target',
      ),
    );
    expect(await snapshot()).toEqual(before);
    await expect(inspectCategoryDeletion({ id: 'missing' })).rejects.toThrow(
      'Category with id missing not found.',
    );
    await expect(
      inspectCategoryDeletion({ id: 'deletion-source', transferId: 'missing' }),
    ).rejects.toThrow('Transfer category with id missing not found.');
    expect(await snapshot()).toEqual(before);
    await runHandler(handlers['category-delete'], {
      id: 'deletion-source',
      transferId: 'deletion-target',
    });
    expect((await db.getCategory('deletion-source')).tombstone).toBe(1);
    expect(
      budgetActions.getBudget({
        month: '2024-01',
        category: 'deletion-target',
      }),
    ).toBe(is_income ? 200 : 900);
  },
);

test('partial category group updates preserve raw fields and child categories', async () => {
  const id = await db.insertCategoryGroup({
    name: 'Partial group owner',
    is_income: 1,
    hidden: 0,
  });
  const child = await db.insertCategory({
    name: 'Preserved group child',
    cat_group: id,
    is_income: 1,
  });
  const before = await db.first<db.DbCategoryGroup>(
    'SELECT * FROM category_groups WHERE id = ?',
    [id],
  );
  const categories = await db.all('SELECT * FROM categories ORDER BY id');
  await runHandler(handlers['category-group-update'], { id, hidden: true });
  expect(
    await db.first('SELECT * FROM category_groups WHERE id = ?', [id]),
  ).toEqual({ ...before, hidden: 1 });
  expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(
    categories,
  );
  expect((await db.getCategory(child)).cat_group).toBe(id);
  await runHandler(handlers['category-group-update'], {
    id,
    name: 'Updated group owner',
  });
  expect(
    await db.first('SELECT * FROM category_groups WHERE id = ?', [id]),
  ).toEqual({ ...before, hidden: 1, name: 'Updated group owner' });
  expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(
    categories,
  );
});

test.each([0, 1] as const)(
  'group deletion inspection transfers live child allocations for income=%s and deletes all children without preview writes',
  async is_income => {
    await sheet.loadSpreadsheet(db);
    sheet.get().meta().createdMonths = new Set(['2024-01']);
    await db.insertCategoryGroup({
      id: 'group-delete-source',
      name: 'Deleted group',
      is_income,
    });
    await db.insertCategoryGroup({
      id: 'group-delete-target',
      name: 'Target group',
      is_income,
    });
    for (const id of ['child-a', 'child-b', 'child-dead']) {
      await db.insertCategory({
        id,
        name: id,
        cat_group: 'group-delete-source',
        is_income,
      });
    }
    await db.insertCategory({
      id: 'target-category',
      name: 'Target category',
      cat_group: 'group-delete-target',
      is_income,
    });
    await db.deleteCategory({ id: 'child-dead' });
    await db.insertCategory({
      id: 'forwarded-child',
      name: 'Forwarded child',
      cat_group: 'group-delete-target',
      is_income,
    });
    await db.deleteCategory({ id: 'forwarded-child' }, 'child-dead');
    for (const [category, amount] of [
      ['child-a', 700],
      ['child-b', -100],
      ['child-dead', 999],
      ['target-category', 200],
    ] as const) {
      await budgetActions.setBudget({ month: '2024-01', category, amount });
    }
    const snapshot = async () => ({
      groups: await db.all<db.DbCategoryGroup>(
        'SELECT * FROM category_groups ORDER BY id',
      ),
      categories: await db.all<db.DbCategory>(
        'SELECT * FROM categories ORDER BY id',
      ),
      mappings: await db.all('SELECT * FROM category_mapping ORDER BY id'),
      budgets: await db.all<{ id: string; category: string; amount: number }>(
        'SELECT * FROM zero_budgets ORDER BY id',
      ),
      messages: await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
    });
    const before = await snapshot();
    const plan = await inspectCategoryGroupDeletion({
      id: 'group-delete-source',
      transferId: 'target-category',
    });
    expect(plan.group).toEqual(
      await db.first('SELECT * FROM category_groups WHERE id = ?', [
        'group-delete-source',
      ]),
    );
    expect(plan.budgetTransfers.map(row => row.amount)).toEqual([800]);
    expect(plan.budgetTransfers[0].sources.map(row => row.category)).toEqual([
      'child-a',
      'child-b',
    ]);
    expect(plan.deletion.categories.map(row => row.category.id)).toEqual([
      'child-a',
      'child-b',
      'child-dead',
    ]);
    expect(plan.deletion).toEqual(
      await db.inspectCategoryGroupDeletion(
        { id: 'group-delete-source' },
        'target-category',
      ),
    );
    expect(await snapshot()).toEqual(before);
    await expect(
      inspectCategoryGroupDeletion({ id: 'missing' }),
    ).rejects.toThrow('not found');
    await expect(
      inspectCategoryGroupDeletion({
        id: 'group-delete-source',
        transferId: 'missing',
      }),
    ).rejects.toThrow('not found');
    expect(await snapshot()).toEqual(before);
    await runHandler(handlers['category-group-delete'], {
      id: 'group-delete-source',
      transferId: 'target-category',
    });
    expect(
      (
        await db.first<db.DbCategoryGroup>(
          'SELECT * FROM category_groups WHERE id = ?',
          ['group-delete-source'],
        )
      ).tombstone,
    ).toBe(1);
    for (const id of ['child-a', 'child-b', 'child-dead']) {
      expect((await db.getCategory(id)).tombstone).toBe(1);
      expect(
        await db.first('SELECT transferId FROM category_mapping WHERE id = ?', [
          id,
        ]),
      ).toEqual({ transferId: 'target-category' });
    }
    expect(
      await db.first('SELECT transferId FROM category_mapping WHERE id = ?', [
        'forwarded-child',
      ]),
    ).toEqual({ transferId: 'target-category' });
    expect(
      budgetActions.getBudget({
        month: '2024-01',
        category: 'target-category',
      }),
    ).toBe(800);
    const after = await snapshot();
    expect(after.categories).toEqual(
      before.categories.map(row =>
        row.cat_group === 'group-delete-source'
          ? { ...row, tombstone: 1 }
          : row,
      ),
    );
    expect(after.groups).toEqual(
      before.groups.map(row =>
        row.id === 'group-delete-source' ? { ...row, tombstone: 1 } : row,
      ),
    );
    expect(after.budgets).toEqual(
      before.budgets.map(row =>
        row.category === 'target-category' ? { ...row, amount: 800 } : row,
      ),
    );
  },
);
