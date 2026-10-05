// @ts-strict-ignore
import * as db from './index';

beforeEach(global.emptyDatabase());

async function insertTransactions(transactions) {
  await db.insertAccount({ id: 'foo', name: 'bar' });
  return Promise.all(
    transactions.map(transaction => db.insertTransaction(transaction)),
  );
}

async function getTransactions(latestDate) {
  const rows = await db.getTransactions('foo');
  return rows
    .filter(t => t.date <= latestDate)
    .map(row => ({
      id: row.id,
      date: row.date,
      payee: row.payee,
      is_child: row.is_child,
      is_parent: row.is_parent,
      amount: row.amount,
      starting_balance_flag: row.starting_balance_flag,
      sort_order: row.sort_order,
    }));
}

// TODO: test that `insertTransaction` is done sync (or is at least
// validated in the same event loop and it's same to not await)

describe('Database', () => {
  test('all and first accept null params', async () => {
    await db.insertAccount({ id: 'foo', name: 'bar' });

    const rows = await db.all<{ id: string }>(
      'SELECT id FROM accounts WHERE official_name IS ?',
      [null],
    );
    expect(rows).toEqual([{ id: 'foo' }]);

    const row = await db.first<{ id: string }>(
      'SELECT id FROM accounts WHERE official_name IS ?',
      [null],
    );
    expect(row).toEqual({ id: 'foo' });
  });

  test('inserting a category works', async () => {
    await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
    await db.insertCategory({
      name: 'foo',
      cat_group: 'group1',
    });
    expect((await db.getCategories()).length).toBe(1);
  });

  test('using a deleted category name works', async () => {
    await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
    const id = await db.insertCategory({
      name: 'foo',
      cat_group: 'group1',
    });
    await db.deleteCategory({ id });
    expect((await db.getCategories()).length).toBe(0);
    await db.insertCategory({
      name: 'foo',
      cat_group: 'group1',
    });
    expect((await db.getCategories()).length).toBe(1);
  });

  test('transactions are sorted by date', async () => {
    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23 },
      { date: '2018-01-02', account: 'foo', amount: -24 },
      { date: '2018-01-04', account: 'foo', amount: 12 },
      { date: '2018-01-01', account: 'foo', amount: 2 },
      { date: '2018-01-03', account: 'foo', amount: -5 },
    ]);
    expect(await getTransactions('2018-01-05')).toMatchSnapshot();
  });

  test('transactions are sorted by starting balance flag', async () => {
    // The transaction with a starting balance flag should always be
    // at the end of any transactions of the same day (it sorts by
    // date first, so any earlier transactions will be before it)
    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23 },
      {
        date: '2018-01-03',
        account: 'foo',
        amount: 12,
        starting_balance_flag: 1,
      },
      { date: '2018-01-03', account: 'foo', amount: -25 },
      { date: '2018-01-03', account: 'foo', amount: -5 },
    ]);
    expect(await getTransactions('2018-01-05')).toMatchSnapshot();
  });

  test('transactions are sorted by sort order', async () => {
    // Transactions on the same day should sort by sort order descending
    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23, sort_order: 5 },
      { date: '2018-01-03', account: 'foo', amount: -24, sort_order: 8 },
      { date: '2018-01-03', account: 'foo', amount: 12, sort_order: 2 },
      { date: '2018-01-03', account: 'foo', amount: 2, sort_order: 4 },
      { date: '2018-01-03', account: 'foo', amount: -5, sort_order: 1 },
    ]);
    expect(await getTransactions('2018-01-05')).toMatchSnapshot();
  });

  test('transactions are sorted by id as a last resort', async () => {
    // Transactions on the same day should sort by sort order descending
    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23, sort_order: 5 },
      {
        id: 'foo3',
        date: '2018-01-03',
        account: 'foo',
        amount: -24,
        sort_order: 4,
      },
      {
        id: 'foo1',
        date: '2018-01-03',
        account: 'foo',
        amount: 12,
        sort_order: 4,
      },
      {
        id: 'foo2',
        date: '2018-01-03',
        account: 'foo',
        amount: 2,
        sort_order: 4,
      },
    ]);
    expect(await getTransactions('2018-01-05')).toMatchSnapshot();
  });

  test('schedules can be reordered', async () => {
    await db.insertWithUUID('schedules', { id: 'sched1', sort_order: 30 });
    await db.insertWithUUID('schedules', { id: 'sched2', sort_order: 20 });
    await db.insertWithUUID('schedules', { id: 'sched3', sort_order: 10 });

    // Move sched3 (currently last) to be right after sched1 (currently first)
    await db.moveSchedule('sched3', 'sched1');

    const rows = await db.all<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM schedules ORDER BY sort_order DESC, id',
    );
    expect(rows.map(r => r.id)).toEqual(['sched1', 'sched3', 'sched2']);
  });

  test('moving a schedule to the top uses a null targetId', async () => {
    await db.insertWithUUID('schedules', { id: 'sched1', sort_order: 30 });
    await db.insertWithUUID('schedules', { id: 'sched2', sort_order: 20 });

    await db.moveSchedule('sched2', null);

    const rows = await db.all<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM schedules ORDER BY sort_order DESC, id',
    );
    expect(rows.map(r => r.id)).toEqual(['sched2', 'sched1']);
  });

  test('moving a non-existent schedule throws', async () => {
    await expect(db.moveSchedule('missing', null)).rejects.toThrow(
      'Schedule not found: missing',
    );
  });

  test('transactions get child transactions in the right order', async () => {
    // Transactions on the same day should sort by sort order descending
    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23, sort_order: 5 },
      {
        id: 'foo',
        date: '2018-01-03',
        account: 'foo',
        amount: -24,
        sort_order: 8,
        is_parent: true,
      },
      {
        id: 'child3',
        date: '2018-01-03',
        account: 'foo',
        amount: -5,
        sort_order: 7.97,
        is_child: true,
        parent_id: 'foo',
      },
      {
        id: 'child1',
        date: '2018-01-03',
        account: 'foo',
        amount: 12,
        sort_order: 7.99,
        is_child: true,
        parent_id: 'foo',
      },
      {
        id: 'child2',
        date: '2018-01-03',
        account: 'foo',
        amount: 2,
        sort_order: 7.98,
        is_child: true,
        parent_id: 'foo',
      },
    ]);
    expect(await getTransactions('2018-01-05')).toMatchSnapshot();
  });

  test("transactions don't show orphaned child transactions", async () => {
    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23, sort_order: 5 },
      {
        id: 'foo/child3',
        date: '2018-01-03',
        account: 'foo',
        amount: -5,
        sort_order: 7.97,
        is_child: true,
      },
      {
        id: 'foo/child1',
        date: '2018-01-03',
        account: 'foo',
        amount: 12,
        sort_order: 7.99,
        is_child: true,
      },
      {
        id: 'foo/child2',
        date: '2018-01-03',
        account: 'foo',
        amount: 2,
        sort_order: 7.98,
        is_child: true,
      },
    ]);
    expect(await getTransactions('2018-01-05')).toMatchSnapshot();
  });

  test('parent transactions never have a category', async () => {
    await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
    await db.insertCategory({
      id: 'cat1',
      name: 'cat1',
      cat_group: 'group1',
    });
    await db.insertCategory({
      id: 'cat2',
      name: 'cat2',
      cat_group: 'group1',
    });

    await insertTransactions([
      { date: '2018-01-05', account: 'foo', amount: -23, sort_order: 5 },
      {
        id: 'parent1',
        date: '2018-01-03',
        account: 'foo',
        category: 'cat1',
        amount: -24,
        sort_order: 8,
        is_parent: true,
      },
      {
        id: 'child3',
        date: '2018-01-03',
        account: 'foo',
        category: 'cat1',
        amount: -5,
        sort_order: 7.97,
        is_child: true,
        parent_id: 'parent1',
      },
      {
        id: 'child2',
        date: '2018-01-03',
        account: 'foo',
        category: 'cat2',
        amount: 2,
        sort_order: 7.98,
        is_child: true,
        parent_id: 'parent1',
      },
    ]);

    const rows = await db.getTransactions('foo');

    expect(rows.find(t => t.id === 'parent1').category).toBe(null);
    expect(rows.find(t => t.id === 'child3').category).toBe('cat1');
    expect(rows.find(t => t.id === 'child2').category).toBe('cat2');
  });

  test('child transactions never appear if parent is deleted', async () => {
    await insertTransactions([
      {
        id: 'trans1',
        date: '2018-01-05',
        account: 'foo',
        amount: -23,
        sort_order: 5,
      },
      {
        id: 'parent1',
        date: '2018-01-03',
        account: 'foo',
        category: 'cat1',
        amount: -24,
        sort_order: 8,
        is_parent: true,
      },
      {
        id: 'child3',
        date: '2018-01-03',
        account: 'foo',
        category: 'cat1',
        amount: -5,
        sort_order: 7.97,
        is_child: true,
        parent_id: 'parent1',
      },
      {
        id: 'child2',
        date: '2018-01-03',
        account: 'foo',
        category: 'cat2',
        amount: 2,
        sort_order: 7.98,
        is_child: true,
        parent_id: 'parent1',
      },
    ]);

    await db.deleteTransaction({ id: 'parent1' });

    const rows = await db.getTransactions('foo');
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('trans1');
  });
});

describe('read-only category insertion planning', () => {
  test.each([
    {
      name: 'ordinary group ordering',
      compact: false,
      atEnd: false,
      order: 8192,
      updates: 0,
    },
    {
      name: 'compact sibling shoves',
      compact: true,
      atEnd: false,
      order: 0.5,
      updates: 2,
    },
    {
      name: 'global append ordering',
      compact: false,
      atEnd: true,
      order: 106384,
      updates: 0,
    },
  ])(
    '$name matches the canonical writer without preview writes',
    async ({ compact, atEnd, order, updates }) => {
      await db.insertCategoryGroup({
        id: 'planned-group',
        name: 'Planned group',
      });
      await db.insertCategoryGroup({ id: 'other-group', name: 'Other group' });
      const fixtureRows: Array<[string, string, number]> = [
        ['first', 'planned-group', compact ? 1 : 16384],
        ['second', 'planned-group', compact ? 2 : 32768],
        ['unrelated', 'other-group', 90000],
      ];
      for (const [id, group] of fixtureRows) {
        await db.insertCategory({
          id,
          name: id,
          cat_group: group,
          is_income: 0,
          hidden: 0,
        });
      }
      // Fixture insertion can itself shove earlier siblings. Set the intended
      // compact orders only after every fixture row exists.
      for (const [id, , value] of fixtureRows) {
        await db.update('categories', { id, sort_order: value });
      }
      const input = {
        name: 'Planned category',
        cat_group: 'planned-group',
        is_income: 0,
        hidden: 0,
      } satisfies Partial<db.DbCategory>;
      const before = await db.all<db.DbCategory>(
        'SELECT * FROM categories ORDER BY id',
      );
      const mappings = await db.all(
        'SELECT * FROM category_mapping ORDER BY id',
      );
      const messages = await db.all(
        'SELECT * FROM messages_crdt ORDER BY timestamp',
      );
      const plan = await db.inspectCategoryInsertion(input, { atEnd });
      expect(plan.category.sort_order).toBe(order);
      expect(plan.updates).toHaveLength(updates);
      expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(
        before,
      );
      expect(
        await db.all('SELECT * FROM category_mapping ORDER BY id'),
      ).toEqual(mappings);
      expect(
        await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
      ).toEqual(messages);
      const id = await db.insertCategory(input, { atEnd });
      expect(await db.getCategory(id)).toMatchObject(plan.category);
      expect(
        await db.all('SELECT * FROM categories WHERE id != ? ORDER BY id', [
          id,
        ]),
      ).toEqual(
        before.map(row => ({
          ...row,
          ...plan.updates.find(update => update.id === row.id),
        })),
      );
      expect(
        await db.all(
          'SELECT * FROM category_mapping WHERE id != ? ORDER BY id',
          [id],
        ),
      ).toEqual(mappings);
      expect(
        await db.first('SELECT * FROM category_mapping WHERE id = ?', [id]),
      ).toEqual({ id, transferId: id });
    },
  );
  test('duplicate-name rejection does not change category rows or synchronization messages', async () => {
    const group = await db.insertCategoryGroup({ name: 'Duplicate group' });
    await db.insertCategory({ name: 'Existing name', cat_group: group });
    const before = await db.all('SELECT * FROM categories ORDER BY id');
    const messages = await db.all(
      'SELECT * FROM messages_crdt ORDER BY timestamp',
    );
    await expect(
      db.inspectCategoryInsertion({ name: 'EXISTING NAME', cat_group: group }),
    ).rejects.toThrow('already exists');
    expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(
      before,
    );
    expect(
      await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
    ).toEqual(messages);
  });
});

describe('read-only category deletion mapping planning', () => {
  test.each([false, true])(
    'matches canonical forwarding effects with transfer=%s without preview writes',
    async transfer => {
      await db.insertCategoryGroup({
        id: 'deletion-group',
        name: 'Deletion group',
      });
      for (const id of [
        'deleted-before',
        'source',
        'destination',
        'unrelated',
      ]) {
        await db.insertCategory({ id, name: id, cat_group: 'deletion-group' });
      }
      await db.deleteCategory({ id: 'deleted-before' }, 'source');
      const categories = await db.all<db.DbCategory>(
        'SELECT * FROM categories ORDER BY id',
      );
      const mappings = await db.all<db.DbCategoryMapping>(
        'SELECT * FROM category_mapping ORDER BY id',
      );
      const messages = await db.all(
        'SELECT * FROM messages_crdt ORDER BY timestamp',
      );
      const transferId = transfer ? 'destination' : undefined;
      const plan = await db.inspectCategoryDeletion(
        { id: 'source' },
        transferId,
      );
      expect(plan.category).toEqual({ id: 'source', tombstone: 1 });
      expect(plan.mappings).toEqual(
        transfer
          ? [
              { id: 'deleted-before', transferId: 'destination' },
              { id: 'source', transferId: 'destination' },
              { id: 'source', transferId: 'destination' },
            ]
          : [],
      );
      expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(
        categories,
      );
      expect(
        await db.all('SELECT * FROM category_mapping ORDER BY id'),
      ).toEqual(mappings);
      expect(
        await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
      ).toEqual(messages);
      await db.deleteCategory({ id: 'source' }, transferId);
      expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(
        categories.map(row =>
          row.id === 'source' ? { ...row, tombstone: 1 } : row,
        ),
      );
      expect(
        await db.all('SELECT * FROM category_mapping ORDER BY id'),
      ).toEqual(
        mappings.map(row => {
          const update = plan.mappings.find(mapping => mapping.id === row.id);
          return update ? { ...row, ...update } : row;
        }),
      );
    },
  );
});

test('category group insertion inspection preserves rows and matches canonical global order', async () => {
  await db.insertCategoryGroup({
    id: 'existing-group',
    name: 'Existing group',
    is_income: 0,
  });
  await db.update('category_groups', {
    id: 'existing-group',
    sort_order: 90000,
  });
  const before = await db.all('SELECT * FROM category_groups ORDER BY id');
  const messages = await db.all(
    'SELECT * FROM messages_crdt ORDER BY timestamp',
  );
  const input = {
    name: 'Planned income group',
    is_income: 1,
    hidden: 1,
  } satisfies Partial<db.DbCategoryGroup>;
  const plan = await db.inspectCategoryGroupInsertion(input);
  expect(plan).toEqual({ ...input, sort_order: 106384 });
  expect(await db.all('SELECT * FROM category_groups ORDER BY id')).toEqual(
    before,
  );
  expect(
    await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
  ).toEqual(messages);
  await expect(
    db.inspectCategoryGroupInsertion({ name: 'EXISTING GROUP' }),
  ).rejects.toThrow('already exists');
  expect(await db.all('SELECT * FROM category_groups ORDER BY id')).toEqual(
    before,
  );
  const id = await db.insertCategoryGroup(input);
  expect(
    await db.first('SELECT * FROM category_groups WHERE id = ?', [id]),
  ).toEqual({ id, tombstone: 0, ...plan });
});

test('category group update inspection validates duplicates without writes and matches partial writer', async () => {
  const id = await db.insertCategoryGroup({
    name: 'Inspection update group',
    is_income: 1,
    hidden: 1,
  });
  await db.insertCategoryGroup({ name: 'Duplicate group' });
  const before = await db.all<db.DbCategoryGroup>(
    'SELECT * FROM category_groups ORDER BY id',
  );
  const messages = await db.all(
    'SELECT * FROM messages_crdt ORDER BY timestamp',
  );
  const plan = await db.inspectCategoryGroupUpdate({ id, hidden: 0 });
  expect(plan).toEqual({ id, hidden: 0 });
  await expect(
    db.inspectCategoryGroupUpdate({ id, name: 'DUPLICATE GROUP' }),
  ).rejects.toThrow('already exists');
  expect(await db.all('SELECT * FROM category_groups ORDER BY id')).toEqual(
    before,
  );
  expect(
    await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
  ).toEqual(messages);
  await db.updateCategoryGroup(plan);
  expect(await db.all('SELECT * FROM category_groups ORDER BY id')).toEqual(
    before.map(row => (row.id === id ? { ...row, hidden: 0 } : row)),
  );
});

test('payee insertion inspection preserves exact names and duplicate behavior without writes and matches mapping owner', async () => {
  const before = {
    payees: await db.all('SELECT * FROM payees ORDER BY id'),
    mappings: await db.all('SELECT * FROM payee_mapping ORDER BY id'),
    messages: await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
  };
  const plan = db.inspectPayeeInsertion({ name: '  Exact payee  ' });
  expect(plan).toEqual({ name: '  Exact payee  ' });
  expect({
    payees: await db.all('SELECT * FROM payees ORDER BY id'),
    mappings: await db.all('SELECT * FROM payee_mapping ORDER BY id'),
    messages: await db.all('SELECT * FROM messages_crdt ORDER BY timestamp'),
  }).toEqual(before);
  const first = await db.insertPayee(plan);
  const second = await db.insertPayee(
    db.inspectPayeeInsertion({ name: plan.name }),
  );
  expect(second).not.toBe(first);
  for (const id of [first, second]) {
    expect(await db.first('SELECT * FROM payees WHERE id = ?', [id])).toEqual({
      id,
      name: plan.name,
      category: null,
      tombstone: 0,
      transfer_acct: null,
      favorite: 0,
      learn_categories: 1,
    });
    expect(
      await db.first('SELECT * FROM payee_mapping WHERE id = ?', [id]),
    ).toEqual({ id, targetId: id });
  }
  expect(() =>
    db.inspectPayeeInsertion({ name: undefined as unknown as string }),
  ).toThrow('missing field name');
});
