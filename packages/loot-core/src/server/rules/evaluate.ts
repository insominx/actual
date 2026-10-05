// Read-only rule evaluation for one sample transaction. The sample goes
// through the same steps as an imported row (payee name normalization and
// resolution, then runRules), so the result is what an import would store.
// Nothing is written: payees an import would create are reported by name,
// and rule learning is not involved.
import { normalizeTransactions } from '#server/accounts/sync';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  conditionsToAQL,
  getRules,
  runRules,
} from '#server/transactions/transaction-rules';
import { q } from '#shared/query';

export type RuleTestRequest = {
  transaction: {
    account: string;
    date: string;
    amount: number;
    payee_name?: string;
    payee?: string;
    imported_payee?: string;
    notes?: string;
    category?: string;
    cleared?: boolean;
  };
  payeeNameNormalization?: 'original' | 'title-case';
};

export type RuleTestResult = {
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  appliedRules: Array<{
    id: string;
    stage: string | null;
    conditionsOp: string;
    conditions: unknown[];
    actions: unknown[];
  }>;
  newPayees: string[];
  subtransactions: Array<Record<string, unknown>> | null;
  errors: string[];
};

const SAMPLE_KEYS = [
  'account',
  'date',
  'amount',
  'payee_name',
  'payee',
  'imported_payee',
  'notes',
  'category',
  'cleared',
];
const FIELDS = [
  'account',
  'date',
  'amount',
  'payee',
  'imported_payee',
  'notes',
  'category',
  'cleared',
] as const;

function invalid(message: string): never {
  throw APIError(`Invalid rule test request: ${message}`);
}

function project(
  row: Record<string, unknown>,
  newPayees: Map<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FIELDS) {
    const value = row[key];
    out[key] =
      key === 'payee' && typeof value === 'string' && newPayees.has(value)
        ? { newPayee: newPayees.get(value) }
        : key === 'cleared'
          ? Boolean(value)
          : (value ?? null);
  }
  return out;
}

export async function testRules(
  request: RuleTestRequest,
): Promise<RuleTestResult> {
  if (typeof request !== 'object' || request === null) {
    invalid('provide a transaction');
  }
  for (const key of Object.keys(request)) {
    if (!['transaction', 'payeeNameNormalization'].includes(key)) {
      invalid(`unknown field ${key}`);
    }
  }
  const sample = request.transaction;
  if (typeof sample !== 'object' || sample === null || Array.isArray(sample)) {
    invalid('transaction must be an object');
  }
  for (const key of Object.keys(sample)) {
    if (!SAMPLE_KEYS.includes(key)) invalid(`unknown transaction field ${key}`);
  }
  if (typeof sample.account !== 'string') invalid('account is required');
  if (
    typeof sample.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(sample.date)
  ) {
    invalid('date must be YYYY-MM-DD');
  }
  if (!Number.isSafeInteger(sample.amount)) {
    invalid('amount must be integer cents');
  }
  for (const key of [
    'payee_name',
    'payee',
    'imported_payee',
    'notes',
    'category',
  ] as const) {
    if (sample[key] !== undefined && typeof sample[key] !== 'string') {
      invalid(`${key} must be a string`);
    }
  }
  if (sample.cleared !== undefined && typeof sample.cleared !== 'boolean') {
    invalid('cleared must be a boolean');
  }
  if (sample.payee !== undefined && sample.payee_name !== undefined) {
    invalid('give payee or payee_name, not both');
  }
  if (
    request.payeeNameNormalization !== undefined &&
    !['original', 'title-case'].includes(request.payeeNameNormalization)
  ) {
    invalid('payeeNameNormalization must be original or title-case');
  }
  const account = await db.first<{ id: string }>(
    'SELECT id FROM accounts WHERE id = ? AND tombstone = 0',
    [sample.account],
  );
  if (!account) throw APIError(`Account does not exist: ${sample.account}`);
  if (sample.payee !== undefined) {
    const payee = await db.first<{ id: string }>(
      'SELECT id FROM payees WHERE id = ? AND tombstone = 0',
      [sample.payee],
    );
    if (!payee) throw APIError(`Payee does not exist: ${sample.payee}`);
  }
  if (sample.category !== undefined) {
    const category = await db.first<{ id: string }>(
      'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
      [sample.category],
    );
    if (!category) {
      throw APIError(`Category does not exist: ${sample.category}`);
    }
  }

  const { account: accountId, ...fields } = sample;
  const { normalized, payeesToCreate } = await normalizeTransactions(
    [structuredClone(fields)],
    accountId,
    { payeeNameNormalization: request.payeeNameNormalization },
  );
  const newPayees = new Map<string, string>();
  for (const payee of payeesToCreate.values()) {
    newPayees.set(payee.id, payee.name);
  }
  const input = normalized[0].trans as Record<string, unknown>;
  const trace: string[] = [];
  const dryRun = { newPayeeNames: [] as string[] };
  let ruled: Record<string, unknown>;
  try {
    ruled = (await runRules({ ...input }, null, {
      trace,
      dryRun,
    })) as unknown as Record<string, unknown>;
  } catch (error) {
    throw APIError(
      `Rules could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const name of dryRun.newPayeeNames) {
    newPayees.set(`dry-run-payee:${name}`, name);
  }
  const before = project(input, newPayees);
  const result = project(ruled, newPayees);
  const changes = FIELDS.filter(
    key => JSON.stringify(before[key]) !== JSON.stringify(result[key]),
  ).map(field => ({ field, before: before[field], after: result[field] }));
  const rules = new Map(getRules().map(rule => [rule.getId(), rule]));
  const subtransactions = Array.isArray(ruled.subtransactions)
    ? (ruled.subtransactions as Array<Record<string, unknown>>).map(sub =>
        project(sub, newPayees),
      )
    : null;
  const used = new Set<string>();
  for (const value of [
    result.payee,
    ...(subtransactions ?? []).map(s => s.payee),
  ]) {
    if (value && typeof value === 'object' && 'newPayee' in value) {
      used.add(String((value as { newPayee: string }).newPayee));
    }
  }
  for (const name of dryRun.newPayeeNames) used.add(name);
  return {
    input: before,
    result,
    changes,
    appliedRules: trace.map(id => {
      const rule = rules.get(id)?.serialize();
      return {
        id,
        stage: rule?.stage ?? null,
        conditionsOp: rule?.conditionsOp ?? 'and',
        conditions: rule?.conditions ?? [],
        actions: rule?.actions ?? [],
      };
    }),
    newPayees: [...used].sort(),
    subtransactions,
    errors: Array.isArray(ruled._ruleErrors)
      ? (ruled._ruleErrors as unknown[]).map(String)
      : [],
  };
}

export type RuleMatches = {
  ruleId: string;
  ids: string[];
  total: number;
  truncated: boolean;
  splitRule: boolean;
};

// Transactions an existing rule's conditions select now, as the rule editor
// lists them before "apply actions". Read-only.
export async function findRuleMatches(request: {
  ruleId: string;
  limit?: number;
}): Promise<RuleMatches> {
  if (typeof request !== 'object' || request === null) {
    throw APIError('Invalid rule matches request: provide ruleId');
  }
  const limit = request.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw APIError('Invalid rule matches request: limit must be 1-500');
  }
  const rule = getRules().find(
    candidate => candidate.getId() === request.ruleId,
  );
  if (!rule) throw APIError(`Rule does not exist: ${request.ruleId}`);
  const serialized = rule.serialize();
  const { filters, errors } = conditionsToAQL(serialized.conditions);
  if (errors.length || !filters.length) {
    throw APIError(
      'The rule conditions cannot select transactions; it cannot be applied to existing transactions',
    );
  }
  const splitRule = serialized.actions.some(
    action => (action.options?.splitIndex ?? 0) > 0,
  );
  const op = serialized.conditionsOp === 'or' ? '$or' : '$and';
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ [op]: filters, ...(splitRule ? { is_child: false } : {}) })
      .select('id')
      .orderBy({ date: 'desc' }),
  );
  const ids = (data as Array<{ id: string }>).map(row => row.id);
  return {
    ruleId: request.ruleId,
    ids: ids.slice(0, limit),
    total: ids.length,
    truncated: ids.length > limit,
    splitRule,
  };
}
