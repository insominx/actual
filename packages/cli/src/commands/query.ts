import { createHash } from 'node:crypto';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { addAgentWarning, AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { readJsonInput } from '#input';
import { printOutput } from '#output';
import { isRecord, parseIntFlag } from '#utils';

/**
 * Parse order-by strings like "date:desc,amount:asc,id" into
 * AQL orderBy format: [{ date: 'desc' }, { amount: 'asc' }, 'id']
 */
export function parseOrderBy(
  input: string,
): Array<string | Record<string, string>> {
  return input.split(',').map(part => {
    const trimmed = part.trim();
    if (!trimmed) {
      throw new Error('--order-by contains an empty field');
    }
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      return trimmed;
    }
    const field = trimmed.slice(0, colonIndex).trim();
    if (!field) {
      throw new Error(
        `Invalid order field in "${trimmed}". Field name cannot be empty.`,
      );
    }
    const direction = trimmed.slice(colonIndex + 1);
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(
        `Invalid order direction "${direction}" for field "${field}". Expected "asc" or "desc".`,
      );
    }
    return { [field]: direction };
  });
}

// Version 1 `query tables` and `query fields` keep this exact legacy output.
// Version 2 output and table validation use core schema metadata instead.
const LEGACY_TABLE_SCHEMA: Record<
  string,
  Record<string, { type: string; ref?: string }>
> = {
  transactions: {
    id: { type: 'id' },
    account: { type: 'id', ref: 'accounts' },
    date: { type: 'date' },
    amount: { type: 'integer' },
    payee: { type: 'id', ref: 'payees' },
    category: { type: 'id', ref: 'categories' },
    notes: { type: 'string' },
    imported_id: { type: 'string' },
    transfer_id: { type: 'id' },
    cleared: { type: 'boolean' },
    reconciled: { type: 'boolean' },
    starting_balance_flag: { type: 'boolean' },
    imported_payee: { type: 'string' },
    is_parent: { type: 'boolean' },
    is_child: { type: 'boolean' },
    parent_id: { type: 'id' },
    sort_order: { type: 'float' },
    schedule: { type: 'id', ref: 'schedules' },
    'account.name': { type: 'string', ref: 'accounts' },
    'payee.name': { type: 'string', ref: 'payees' },
    'category.name': { type: 'string', ref: 'categories' },
    'category.group.name': { type: 'string', ref: 'category_groups' },
  },
  accounts: {
    id: { type: 'id' },
    name: { type: 'string' },
    offbudget: { type: 'boolean' },
    closed: { type: 'boolean' },
    sort_order: { type: 'float' },
  },
  categories: {
    id: { type: 'id' },
    name: { type: 'string' },
    is_income: { type: 'boolean' },
    group_id: { type: 'id', ref: 'category_groups' },
    sort_order: { type: 'float' },
    hidden: { type: 'boolean' },
    'group.name': { type: 'string', ref: 'category_groups' },
  },
  payees: {
    id: { type: 'id' },
    name: { type: 'string' },
    transfer_acct: { type: 'id', ref: 'accounts' },
  },
  rules: {
    id: { type: 'id' },
    stage: { type: 'string' },
    conditions_op: { type: 'string' },
    conditions: { type: 'json' },
    actions: { type: 'json' },
  },
  schedules: {
    id: { type: 'id' },
    name: { type: 'string' },
    rule: { type: 'id', ref: 'rules' },
    next_date: { type: 'date' },
    completed: { type: 'boolean' },
  },
};

function coreTableNames() {
  return api.getQuerySchema().tables.map(table => table.name);
}

function unknownTable(table: string) {
  return new AgentError(
    'INVALID_INPUT',
    `Unknown table "${table}". Available tables: ${coreTableNames().join(', ')}`,
    false,
    { field: 'table' },
  );
}

function isVersion2(program: Command) {
  return program.opts().outputVersion === '2';
}

function parseFilter(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    throw new AgentError('INVALID_INPUT', 'Filter must be valid JSON.', false, {
      field: 'filter',
    });
  }
}

// Version 2 paging. Results are bounded, non-aggregate rows get a final id
// tie-breaker, and a cursor binds the next offset to the query and to the
// budget's change marker so a concurrent change is disclosed.
export const DEFAULT_PAGE_LIMIT = 1000;
export const MAX_PAGE_LIMIT = 10000;

type QueryObj = ReturnType<typeof api.q>;
type PageCursor = { v: 1; q: string; o: number; s: string };

function queryHash(queryObj: QueryObj) {
  const { limit: _limit, offset: _offset, ...rest } = queryObj.serialize();
  return createHash('sha256')
    .update(JSON.stringify(rest))
    .digest('hex')
    .slice(0, 16);
}

export function encodeCursor(cursor: PageCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(token: string): PageCursor {
  try {
    const value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      value?.v === 1 &&
      typeof value.q === 'string' &&
      Number.isSafeInteger(value.o) &&
      value.o >= 0 &&
      typeof value.s === 'string'
    ) {
      return value;
    }
  } catch {
    // Reported below.
  }
  throw new AgentError('INVALID_INPUT', 'The cursor is not valid.', false, {
    field: 'cursor',
  });
}

function referencesId(expr: unknown) {
  return typeof expr === 'string'
    ? expr === 'id'
    : isRecord(expr) && Object.keys(expr).includes('id');
}

export function planPage(
  queryObj: QueryObj,
  options: { aggregate: boolean; cursor?: string; hasIdField: boolean },
) {
  const state = queryObj.serialize();
  const hash = queryHash(queryObj);
  let offset = state.offset ?? 0;
  let cursor: PageCursor | undefined;
  if (options.cursor) {
    if (state.offset != null) {
      throw new AgentError(
        'INVALID_INPUT',
        '--cursor cannot be combined with an offset.',
        false,
        { field: 'cursor' },
      );
    }
    cursor = decodeCursor(options.cursor);
    if (cursor.q !== hash) {
      throw new AgentError(
        'INVALID_INPUT',
        'The cursor belongs to a different query; repeat the original query options with --cursor.',
        false,
        { field: 'cursor' },
      );
    }
    offset = cursor.o;
  }
  const limit = state.limit ?? DEFAULT_PAGE_LIMIT;
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new AgentError(
      'INVALID_INPUT',
      `The page limit must be between 1 and ${MAX_PAGE_LIMIT}.`,
      false,
      { field: 'limit' },
    );
  }
  let ordered = queryObj;
  let tieBreaker: 'id' | null = null;
  if (
    !options.aggregate &&
    options.hasIdField &&
    !state.orderExpressions.some(referencesId)
  ) {
    ordered = ordered.orderBy({ id: 'asc' });
    tieBreaker = 'id';
  }
  return {
    // One extra row detects truncation without a second count query.
    query: ordered.limit(limit + 1).offset(offset),
    orderBy: ordered.serialize().orderExpressions,
    tieBreaker,
    limit,
    offset,
    hash,
    cursor,
  };
}

// Entity lookup for agents. Matching is by exact id, then case-insensitive
// exact name, then case-insensitive substring; several matches are reported
// as ambiguous instead of guessing.
export const RESOLVE_TABLES: Record<
  string,
  { nameField: string; select: string[] }
> = {
  accounts: {
    nameField: 'name',
    select: ['id', 'name', 'closed', 'offbudget'],
  },
  payees: { nameField: 'name', select: ['id', 'name', 'transfer_acct'] },
  categories: {
    nameField: 'name',
    select: ['id', 'name', 'is_income', 'hidden', 'group.name'],
  },
  category_groups: {
    nameField: 'name',
    select: ['id', 'name', 'is_income', 'hidden'],
  },
  schedules: {
    nameField: 'name',
    select: ['id', 'name', 'completed', 'next_date'],
  },
  tags: { nameField: 'tag', select: ['id', 'tag'] },
};
export const RESOLVE_MATCH_LIMIT = 50;

export function resolveMatches(
  rows: Array<Record<string, unknown>>,
  text: string,
  nameField: string,
) {
  const needle = text.trim().toLowerCase();
  const name = (row: Record<string, unknown>) =>
    typeof row[nameField] === 'string'
      ? (row[nameField] as string).trim().toLowerCase()
      : '';
  let matchedBy: 'id' | 'exact-name' | 'partial-name' | null = null;
  let matches = rows.filter(row => row.id === text.trim());
  if (matches.length) matchedBy = 'id';
  if (!matches.length && needle) {
    matches = rows.filter(row => name(row) === needle);
    if (matches.length) matchedBy = 'exact-name';
  }
  if (!matches.length && needle) {
    matches = rows.filter(row => name(row).includes(needle));
    if (matches.length) matchedBy = 'partial-name';
  }
  matches.sort((a, b) =>
    name(a) === name(b)
      ? String(a.id).localeCompare(String(b.id))
      : name(a).localeCompare(name(b)),
  );
  return {
    status:
      matches.length === 0
        ? 'none'
        : matches.length === 1
          ? 'unique'
          : 'ambiguous',
    matchedBy,
    total: matches.length,
    truncated: matches.length > RESOLVE_MATCH_LIMIT,
    matches: matches.slice(0, RESOLVE_MATCH_LIMIT),
  };
}

const LAST_DEFAULT_SELECT = [
  'date',
  'account.name',
  'payee.name',
  'category.name',
  'amount',
  'notes',
];

function buildQueryFromFile(
  parsed: Record<string, unknown>,
  fallbackTable: string | undefined,
) {
  const table = typeof parsed.table === 'string' ? parsed.table : fallbackTable;
  if (!table) {
    throw new Error(
      '--table is required when the input file lacks a "table" field',
    );
  }
  let queryObj = api.q(table);
  if (Array.isArray(parsed.select)) queryObj = queryObj.select(parsed.select);
  if (isRecord(parsed.filter)) queryObj = queryObj.filter(parsed.filter);
  if (Array.isArray(parsed.orderBy)) {
    queryObj = queryObj.orderBy(parsed.orderBy);
  }
  if (typeof parsed.limit === 'number') queryObj = queryObj.limit(parsed.limit);
  if (typeof parsed.offset === 'number') {
    queryObj = queryObj.offset(parsed.offset);
  }
  if (Array.isArray(parsed.groupBy)) {
    queryObj = queryObj.groupBy(parsed.groupBy);
  }
  return queryObj;
}

function buildQueryFromFlags(cmdOpts: Record<string, string | undefined>) {
  const last = cmdOpts.last ? parseIntFlag(cmdOpts.last, '--last') : undefined;

  if (last !== undefined) {
    if (cmdOpts.table && cmdOpts.table !== 'transactions') {
      throw new Error(
        '--last implies --table transactions. Cannot use with --table ' +
          cmdOpts.table,
      );
    }
    if (cmdOpts.limit) {
      throw new Error('--last and --limit are mutually exclusive');
    }
  }

  const table =
    cmdOpts.table ?? (last !== undefined ? 'transactions' : undefined);
  if (!table) {
    throw new Error('--table is required (or use --file or --last)');
  }

  if (!coreTableNames().includes(table)) {
    throw unknownTable(table);
  }

  if (cmdOpts.where && cmdOpts.filter) {
    throw new Error('--where and --filter are mutually exclusive');
  }

  if (cmdOpts.count && cmdOpts.select) {
    throw new Error('--count and --select are mutually exclusive');
  }

  let queryObj = api.q(table);

  if (cmdOpts.count) {
    queryObj = queryObj.calculate({ $count: '*' });
  } else if (cmdOpts.select) {
    queryObj = queryObj.select(cmdOpts.select.split(','));
  } else if (last !== undefined) {
    queryObj = queryObj.select(LAST_DEFAULT_SELECT);
  }

  const filterStr = cmdOpts.filter ?? cmdOpts.where;
  if (filterStr) {
    queryObj = queryObj.filter(parseFilter(filterStr));
  }

  const orderByStr =
    cmdOpts.orderBy ??
    (last !== undefined && !cmdOpts.count ? 'date:desc' : undefined);
  if (orderByStr) {
    queryObj = queryObj.orderBy(parseOrderBy(orderByStr));
  }

  const limitVal =
    last ??
    (cmdOpts.limit ? parseIntFlag(cmdOpts.limit, '--limit') : undefined);
  if (limitVal !== undefined) {
    queryObj = queryObj.limit(limitVal);
  }

  if (cmdOpts.offset) {
    queryObj = queryObj.offset(parseIntFlag(cmdOpts.offset, '--offset'));
  }

  if (cmdOpts.groupBy) {
    queryObj = queryObj.groupBy(cmdOpts.groupBy.split(','));
  }

  return queryObj;
}

const RUN_EXAMPLES = `
Examples:
  # Show last 5 transactions (shortcut)
  actual query run --last 5

  # Transactions ordered by date descending
  actual query run --table transactions --select "date,amount,payee.name" --order-by "date:desc" --limit 10

  # Filter with JSON (negative amounts = expenses)
  actual query run --table transactions --filter '{"amount":{"$lt":0}}' --limit 5

  # Count transactions
  actual query run --table transactions --count

  # Group by category (use --file for aggregate expressions)
  echo '{"table":"transactions","groupBy":["category.name"],"select":["category.name",{"amount":{"$sum":"$amount"}}]}' | actual query run --file -

  # Pagination
  actual query run --table transactions --order-by "date:desc" --limit 10 --offset 20

  # Use --where (alias for --filter)
  actual query run --table transactions --where '{"payee.name":"Grocery Store"}' --limit 5

  # Read query from a JSON file
  actual query run --file query.json

  # Pipe query from stdin
  echo '{"table":"transactions","limit":5}' | actual query run --file -

Use "actual query tables" and "actual query fields <table>" for schema info.

Common filter operators: $eq, $ne, $lt, $lte, $gt, $gte, $like, $and, $or
See ActualQL docs for full reference: https://actualbudget.org/docs/api/actual-ql/

Tips:
  - Amounts are stored as integer cents (e.g. 166500 = 1665.00).
    Table and CSV output auto-formats these as decimals; JSON keeps raw cents.
  - Filter "is_parent": false to avoid double-counting split transactions.
  - Fetch all data in a single query with a date range instead of running
    one query per month — rapid sequential requests may cause auth failures.
  - date.month, date.year etc. are not supported as fields in AQL.
    To group by month, fetch raw transactions with a date range filter
    and aggregate locally (e.g. in a script).`;

export function registerQueryCommand(program: Command) {
  const query = program
    .command('query')
    .description('Run AQL (Actual Query Language) queries');

  query
    .command('run')
    .description('Execute an AQL query')
    .option(
      '--table <table>',
      'Table to query (use "actual query tables" to list available tables)',
    )
    .option('--select <fields>', 'Comma-separated fields to select')
    .option('--filter <json>', 'Filter as JSON (e.g. \'{"amount":{"$lt":0}}\')')
    .option(
      '--where <json>',
      'Alias for --filter (cannot be used together with --filter)',
    )
    .option(
      '--order-by <fields>',
      'Fields with optional direction: field1:desc,field2 (default: asc)',
    )
    .option('--limit <n>', 'Limit number of results')
    .option('--offset <n>', 'Skip first N results (for pagination)')
    .option(
      '--cursor <token>',
      'Version 2: continue from the nextCursor of a previous page of the same query',
    )
    .option(
      '--last <n>',
      'Show last N transactions (implies --table transactions, --order-by date:desc)',
    )
    .option('--count', 'Count matching rows instead of returning them')
    .option(
      '--group-by <fields>',
      'Comma-separated fields to group by (use with aggregate selects)',
    )
    .option(
      '--file <path>',
      'Read full query object from JSON file (use - for stdin)',
    )
    .addHelpText('after', RUN_EXAMPLES)
    .action(async cmdOpts => {
      const opts = program.opts();
      const parsed = cmdOpts.file ? readJsonInput(cmdOpts) : undefined;
      if (parsed !== undefined && !isRecord(parsed)) {
        throw new Error('Query file must contain a JSON object');
      }
      const queryObj = parsed
        ? buildQueryFromFile(parsed, cmdOpts.table)
        : buildQueryFromFlags(cmdOpts);
      if (isVersion2(program)) {
        // Compile against the core schema before connecting.
        const check = api.validateQuery(queryObj);
        if (!check.valid) {
          throw new AgentError('INVALID_INPUT', check.message, false, {
            field: 'query',
            table: check.table,
          });
        }
        const state = queryObj.serialize();
        if (!state.calculation) {
          const table = api
            .getQuerySchema()
            .tables.find(candidate => candidate.name === state.table);
          const page = planPage(queryObj, {
            aggregate: check.aggregate,
            cursor: cmdOpts.cursor,
            hasIdField: Boolean(
              table?.fields.some(field => field.name === 'id'),
            ),
          });
          await withConnection(
            opts,
            async () => {
              const { marker } = await api.getQuerySnapshot();
              const result = await api.aqlQuery(page.query);
              if (!isRecord(result) || !Array.isArray(result.data)) {
                throw new Error('Query result missing data');
              }
              const truncated = result.data.length > page.limit;
              const rows = result.data.slice(0, page.limit);
              const nextOffset = truncated ? page.offset + rows.length : null;
              const changed = page.cursor ? page.cursor.s !== marker : null;
              if (changed) {
                addAgentWarning(
                  'The budget changed since the previous page; rows may be repeated or skipped. Restart without --cursor for a consistent read.',
                );
              }
              printOutput(
                {
                  rows,
                  page: {
                    limit: page.limit,
                    offset: page.offset,
                    returned: rows.length,
                    truncated,
                    nextOffset,
                    nextCursor:
                      nextOffset === null
                        ? null
                        : encodeCursor({
                            v: 1,
                            q: page.hash,
                            o: nextOffset,
                            s: marker,
                          }),
                    orderBy: page.orderBy,
                    tieBreaker: page.tieBreaker,
                  },
                  snapshot: {
                    marker,
                    changedSinceCursor: changed,
                  },
                },
                opts.format,
              );
            },
            { mutates: false },
          );
          return;
        }
      } else if (cmdOpts.cursor) {
        throw new AgentError(
          'INVALID_INPUT',
          '--cursor requires output version 2.',
          false,
          { field: 'cursor' },
        );
      }
      await withConnection(
        opts,
        async () => {
          const result = await api.aqlQuery(queryObj);

          if (!isRecord(result) || !('data' in result)) {
            throw new Error('Query result missing data');
          }

          if (cmdOpts.count) {
            printOutput({ count: result.data }, opts.format);
          } else {
            printOutput(result.data, opts.format);
          }
        },
        { mutates: false },
      );
    });

  query
    .command('tables')
    .description('List available tables for querying')
    .action(() => {
      const opts = program.opts();
      if (isVersion2(program)) {
        const metadata = api.getQuerySchema();
        printOutput(
          {
            source: 'core-schema',
            tables: metadata.tables.map(table => ({
              name: table.name,
              fieldCount: table.fields.length,
            })),
            filterOperators: metadata.filterOperators,
            logicalOperators: metadata.logicalOperators,
            functions: metadata.functions,
          },
          opts.format,
        );
        return;
      }
      const tables = Object.keys(LEGACY_TABLE_SCHEMA).map(name => ({ name }));
      printOutput(tables, opts.format);
    });

  query
    .command('fields <table>')
    .description('List fields for a given table')
    .action((table: string) => {
      const opts = program.opts();
      if (isVersion2(program)) {
        const found = api
          .getQuerySchema()
          .tables.find(candidate => candidate.name === table);
        if (!found) throw unknownTable(table);
        printOutput(
          {
            source: 'core-schema',
            table: found.name,
            fields: found.fields,
            paths:
              'Fields with a ref can be followed with dot paths, for example payee.name.',
          },
          opts.format,
        );
        return;
      }
      const schema = LEGACY_TABLE_SCHEMA[table];
      if (!schema) {
        throw new Error(
          `Unknown table "${table}". Available tables: ${Object.keys(LEGACY_TABLE_SCHEMA).join(', ')}`,
        );
      }
      const fields = Object.entries(schema).map(([name, info]) => ({
        name,
        type: info.type,
        ...(info.ref ? { ref: info.ref } : {}),
      }));
      printOutput(fields, opts.format);
    });

  query
    .command('resolve <table> <text>')
    .description(
      'Find entities by id or name; reports ambiguous matches instead of guessing',
    )
    .action(async (table: string, text: string) => {
      const opts = program.opts();
      const config = RESOLVE_TABLES[table];
      if (!config) {
        throw new AgentError(
          'INVALID_INPUT',
          `Entity lookup supports: ${Object.keys(RESOLVE_TABLES).join(', ')}.`,
          false,
          { field: 'table' },
        );
      }
      if (!text.trim()) {
        throw new AgentError('INVALID_INPUT', 'Lookup text is empty.', false, {
          field: 'text',
        });
      }
      await withConnection(
        opts,
        async () => {
          const result = await api.aqlQuery(api.q(table).select(config.select));
          if (!isRecord(result) || !Array.isArray(result.data)) {
            throw new Error('Query result missing data');
          }
          printOutput(
            {
              table,
              text,
              ...resolveMatches(
                result.data as Array<Record<string, unknown>>,
                text,
                config.nameField,
              ),
            },
            opts.format,
          );
        },
        { mutates: false },
      );
    });
}
