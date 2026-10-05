import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { printOutput } from '#output';
import { isRecord } from '#utils';

// Split-aware transaction totals by category. Sums and counts come from the
// engine's AQL aggregates; this module only labels and combines engine rows.
// Transfers and starting balances are reported as their own groups so they
// are never silently mixed into category spending.

export type AggregateGroup = {
  kind: 'category' | 'uncategorized' | 'starting-balance' | 'transfer';
  categoryId: string | null;
  name: string | null;
  deleted: boolean;
  unavailable: boolean;
  total: number;
  inflow: number;
  outflow: number;
  count: number;
};

type EngineRow = {
  category?: string | null;
  starting_balance_flag?: unknown;
  total?: number | null;
  count?: number | null;
};

type CategoryInfo = { name: string; deleted: boolean };

function amount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function combineAggregate(input: {
  regular: EngineRow[];
  regularInflow: EngineRow[];
  transfer: { total: number; inflow: number; count: number };
  categories: Map<string, CategoryInfo>;
  engineTotal: number;
  engineCount: number;
}) {
  const groups = new Map<string, AggregateGroup>();
  function group(
    key: string,
    init: () => Omit<AggregateGroup, 'total' | 'inflow' | 'outflow' | 'count'>,
  ) {
    let found = groups.get(key);
    if (!found) {
      found = { ...init(), total: 0, inflow: 0, outflow: 0, count: 0 };
      groups.set(key, found);
    }
    return found;
  }
  function keyFor(row: EngineRow) {
    if (row.starting_balance_flag) return 'starting-balance';
    return row.category ? `category:${row.category}` : 'uncategorized';
  }
  function initFor(row: EngineRow) {
    return () => {
      if (row.starting_balance_flag) {
        return {
          kind: 'starting-balance' as const,
          categoryId: null,
          name: null,
          deleted: false,
          unavailable: false,
        };
      }
      if (!row.category) {
        return {
          kind: 'uncategorized' as const,
          categoryId: null,
          name: null,
          deleted: false,
          unavailable: false,
        };
      }
      const info = input.categories.get(row.category);
      return {
        kind: 'category' as const,
        categoryId: row.category,
        name: info?.name ?? null,
        deleted: info?.deleted ?? false,
        unavailable: !info,
      };
    };
  }
  for (const row of input.regular) {
    const target = group(keyFor(row), initFor(row));
    target.total += amount(row.total);
    target.count += amount(row.count);
  }
  for (const row of input.regularInflow) {
    group(keyFor(row), initFor(row)).inflow += amount(row.total);
  }
  if (input.transfer.count > 0) {
    const transfer = group('transfer', () => ({
      kind: 'transfer',
      categoryId: null,
      name: null,
      deleted: false,
      unavailable: false,
    }));
    transfer.total = input.transfer.total;
    transfer.inflow = input.transfer.inflow;
    transfer.count = input.transfer.count;
  }
  const order = {
    category: 0,
    uncategorized: 1,
    'starting-balance': 2,
    transfer: 3,
  };
  const list = [...groups.values()]
    .map(entry => ({ ...entry, outflow: entry.total - entry.inflow }))
    .sort((a, b) =>
      order[a.kind] !== order[b.kind]
        ? order[a.kind] - order[b.kind]
        : (a.name ?? '').localeCompare(b.name ?? '') ||
          String(a.categoryId).localeCompare(String(b.categoryId)),
    );
  const total = list.reduce((sum, entry) => sum + entry.total, 0);
  const count = list.reduce((sum, entry) => sum + entry.count, 0);
  if (total !== input.engineTotal || count !== input.engineCount) {
    throw new AgentError(
      'ENGINE_FAILURE',
      'Grouped totals do not match the engine total; no result was returned.',
      false,
      {
        total,
        engineTotal: input.engineTotal,
        count,
        engineCount: input.engineCount,
      },
    );
  }
  return { groups: list, total, count };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateOption(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  if (!DATE.test(value)) {
    throw new AgentError(
      'INVALID_INPUT',
      `--${field} must be YYYY-MM-DD.`,
      false,
      {
        field,
      },
    );
  }
  return value;
}

async function rowsOf(query: ReturnType<typeof api.q>): Promise<EngineRow[]> {
  const result = await api.aqlQuery(query);
  if (!isRecord(result)) throw new Error('Query result missing data');
  const data = result.data;
  if (Array.isArray(data)) return data as EngineRow[];
  return [{ total: amount(data), count: 0 }];
}

async function calculate(
  query: ReturnType<typeof api.q>,
  expr: Record<string, unknown>,
) {
  const result = await api.aqlQuery(query.calculate(expr));
  if (!isRecord(result)) throw new Error('Query result missing data');
  return amount(result.data);
}

export function registerQueryAggregate(query: Command, program: Command) {
  query
    .command('aggregate')
    .description(
      'Split-aware transaction totals by category with transfers, starting balances and uncategorized rows reported separately',
    )
    .option('--start <date>', 'First date (YYYY-MM-DD), inclusive')
    .option('--end <date>', 'Last date (YYYY-MM-DD), inclusive')
    .option('--account <id>', 'Limit to one account')
    .option(
      '--splits <mode>',
      'leaves counts split children (default); parents counts split parents',
      'leaves',
    )
    .action(async cmdOpts => {
      const opts = program.opts();
      const start = dateOption(cmdOpts.start, 'start');
      const end = dateOption(cmdOpts.end, 'end');
      if (cmdOpts.splits !== 'leaves' && cmdOpts.splits !== 'parents') {
        throw new AgentError(
          'INVALID_INPUT',
          '--splits must be leaves or parents.',
          false,
          { field: 'splits' },
        );
      }
      const filter: Record<string, unknown> = {};
      if (start || end) {
        filter.date = {
          ...(start ? { $gte: start } : {}),
          ...(end ? { $lte: end } : {}),
        };
      }
      if (cmdOpts.account) filter.account = cmdOpts.account;
      await withConnection(
        opts,
        async () => {
          const base = api
            .q('transactions')
            .options({
              splits: cmdOpts.splits === 'leaves' ? 'inline' : 'none',
            })
            .filter(filter);
          const regularBase = base.filter({ transfer_id: null });
          const transferBase = base.filter({ transfer_id: { $ne: null } });
          const grouped = (source: ReturnType<typeof api.q>) =>
            source
              .groupBy(['category', 'starting_balance_flag'])
              .select([
                'category',
                'starting_balance_flag',
                { total: { $sum: '$amount' } },
                { count: { $count: '$id' } },
              ]);
          const regular = await rowsOf(grouped(regularBase));
          const regularInflow = await rowsOf(
            grouped(regularBase.filter({ amount: { $gt: 0 } })),
          );
          const transfer = {
            total: await calculate(transferBase, { $sum: '$amount' }),
            inflow: await calculate(
              transferBase.filter({ amount: { $gt: 0 } }),
              {
                $sum: '$amount',
              },
            ),
            count: await calculate(transferBase, { $count: '$id' }),
          };
          const categoryRows = await rowsOf(
            api.q('categories').withDead().select(['id', 'name', 'tombstone']),
          );
          const categories = new Map<string, CategoryInfo>();
          for (const row of categoryRows as Array<Record<string, unknown>>) {
            if (typeof row.id === 'string') {
              categories.set(row.id, {
                name: String(row.name ?? ''),
                deleted: Boolean(row.tombstone),
              });
            }
          }
          const combined = combineAggregate({
            regular,
            regularInflow,
            transfer,
            categories,
            engineTotal: await calculate(base, { $sum: '$amount' }),
            engineCount: await calculate(base, { $count: '$id' }),
          });
          printOutput(
            {
              recipe: {
                splits: cmdOpts.splits,
                transfers: 'separate-group',
                startingBalances: 'separate-group',
                uncategorized: 'separate-group',
                range: { start: start ?? null, end: end ?? null },
                account: cmdOpts.account ?? null,
                amounts:
                  'signed integer cents; inflow is the sum of positive amounts and outflow the sum of negative amounts',
              },
              ...combined,
            },
            opts.format,
          );
        },
        { mutates: false },
      );
    });
}
