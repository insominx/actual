import { createHash } from 'node:crypto';

import * as api from '@actual-app/api';

import { isRecord, stableJson } from './utils';

export type BudgetSnapshot = {
  schemaVersion: 1;
  tables: Record<string, { rows: number; sha256: string }>;
  accountBalances: Array<{ id: string; balance: number }>;
};

// Read normalized domain rows through the supported public query API.
export async function captureBudgetSnapshot(): Promise<BudgetSnapshot> {
  const tables: BudgetSnapshot['tables'] = {};
  for (const table of [
    'accounts',
    'account_groups',
    'transactions',
    'payees',
    'categories',
    'category_groups',
    'schedules',
    'rules',
    'notes',
    'preferences',
    'zero_budgets',
    'reflect_budgets',
    'transaction_filters',
    'custom_reports',
    'dashboard_pages',
    'dashboard',
    'payee_locations',
  ]) {
    const hash = createHash('sha256');
    let rows = 0;
    while (true) {
      let query = api
        .q(table)
        .select('*')
        .raw()
        .withDead()
        .orderBy('id')
        .limit(1000)
        .offset(rows);
      if (table === 'transactions') query = query.options({ splits: 'all' });
      const result = await api.aqlQuery(query);
      if (!isRecord(result) || !Array.isArray(result.data)) {
        throw new Error('Unreadable budget table.');
      }
      for (const row of result.data) hash.update(stableJson(row) + '\n');
      rows += result.data.length;
      if (result.data.length < 1000) break;
    }
    tables[table] = { rows, sha256: hash.digest('hex') };
  }
  const tags = await api.getTags();
  tables.tags = {
    rows: tags.length,
    sha256: createHash('sha256')
      .update(stableJson([...tags].sort((a, b) => a.id.localeCompare(b.id))))
      .digest('hex'),
  };
  const accountBalances: BudgetSnapshot['accountBalances'] = [];
  for (const account of (await api.getAccounts()).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    accountBalances.push({
      id: account.id,
      balance: await api.getAccountBalance(account.id),
    });
  }
  return { schemaVersion: 1, tables, accountBalances };
}
