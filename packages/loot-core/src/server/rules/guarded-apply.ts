// Guarded historical application of one rule's actions to a frozen list of
// transactions, the operation behind the rule editor's "apply actions".
// Prepare plans the exact rows the editor's applyActions would write
// (including split children and deletions) without writing, after checking
// that every frozen transaction still matches the rule. Apply prepares
// again, commits the planned rows and verifies them.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { batchUpdateTransactions } from '#server/transactions';
import {
  conditionsToAQL,
  getRules,
  planRuleActions,
} from '#server/transactions/transaction-rules';
import { canonicalJson } from '#shared/canonical-json';
import { q } from '#shared/query';
import type {
  RuleApplyProposal,
  RuleApplyRequest,
} from '#types/change-proposals';
import type { TransactionEntity } from '#types/models';

export const RULE_APPLY_LIMIT = 500;
const PLACEHOLDER = 'dry-run-payee:';
const FIELDS = [
  'account',
  'date',
  'amount',
  'payee',
  'notes',
  'category',
  'cleared',
  'reconciled',
  'tombstone',
  'is_parent',
  'is_child',
  'imported_payee',
  'schedule',
] as const;

type Row = Record<string, unknown>;

// Planned rows, kept for the commit of the proposal prepared in apply.
const prepared = new WeakMap<RuleApplyProposal, TransactionEntity[]>();

function invalid(message: string): never {
  throw APIError(`Invalid rule application request: ${message}`);
}

function payeeRef(value: unknown, created: Map<string, string>) {
  if (typeof value === 'string' && value.startsWith(PLACEHOLDER)) {
    return { newPayee: value.slice(PLACEHOLDER.length) };
  }
  if (typeof value === 'string' && created.has(value)) {
    return { newPayee: created.get(value) };
  }
  return value ?? null;
}

// Frozen rows keep their id; split children created by the rule are
// identified by their parent and position, since their ids are generated.
function project(
  rows: Row[],
  frozen: Set<string>,
  created: Map<string, string> = new Map(),
) {
  const childIndex = new Map<string, number>();
  return rows.map(row => {
    const out: Row = {};
    if (frozen.has(String(row.id))) {
      out.id = row.id;
    } else {
      const parent = String(row.parent_id ?? '');
      const index = childIndex.get(parent) ?? 0;
      childIndex.set(parent, index + 1);
      out.newChildOf = parent || null;
      out.childIndex = index;
    }
    for (const key of FIELDS) {
      const value = row[key];
      out[key] =
        key === 'payee'
          ? payeeRef(value, created)
          : [
                'cleared',
                'reconciled',
                'tombstone',
                'is_parent',
                'is_child',
              ].includes(key)
            ? Boolean(value)
            : (value ?? null);
    }
    return out;
  });
}

async function readRows(ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const id of ids) {
    const row = await db.first<Row>(
      'SELECT * FROM v_transactions_internal WHERE id = ?',
      [id],
    );
    if (row) {
      rows.push({
        ...row,
        date:
          typeof row.date === 'number' ? db.fromDateRepr(row.date) : row.date,
      });
    }
  }
  return rows;
}

export async function prepareRuleApply(
  request: RuleApplyRequest,
): Promise<RuleApplyProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['ruleId', 'ids', 'allowReconciled'].includes(key),
    )
  ) {
    invalid('provide ruleId, ids and optional allowReconciled');
  }
  const { ruleId, ids, allowReconciled = false } = request;
  if (typeof ruleId !== 'string' || !ruleId) invalid('ruleId is required');
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    !ids.every(id => typeof id === 'string' && id.length > 0)
  ) {
    invalid('ids must be a non-empty array of transaction IDs');
  }
  if (ids.length > RULE_APPLY_LIMIT) {
    invalid(`at most ${RULE_APPLY_LIMIT} transactions per application`);
  }
  if (new Set(ids).size !== ids.length) invalid('ids must not repeat');
  if (typeof allowReconciled !== 'boolean') {
    invalid('allowReconciled must be a boolean');
  }
  const rule = getRules().find(candidate => candidate.getId() === ruleId);
  if (!rule) throw APIError(`Rule does not exist: ${ruleId}`);
  const serialized = rule.serialize();
  const splitRule = serialized.actions.some(
    (action: { options?: { splitIndex?: number } }) =>
      (action.options?.splitIndex ?? 0) > 0,
  );

  const sorted = [...ids].sort();
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: sorted } })
      .select('*'),
  );
  const found = new Map(
    (data as TransactionEntity[]).map(row => [row.id, row]),
  );
  const reconciledIds: string[] = [];
  for (const id of sorted) {
    const row = found.get(id);
    if (!row) {
      throw APIError(
        `Transaction ${id} does not exist or is a split parent (rules apply to split children)`,
      );
    }
    if (splitRule && row.is_child) {
      throw APIError(
        `Transaction ${id} is a split child; a rule that splits applies only to unsplit transactions`,
      );
    }
    if (row.reconciled) {
      if (!allowReconciled) {
        throw APIError(
          `Transaction ${id} is reconciled; pass allowReconciled to apply the rule to it`,
        );
      }
      reconciledIds.push(id);
    }
  }
  const { filters, errors } = conditionsToAQL(serialized.conditions);
  if (errors.length || !filters.length) {
    throw APIError(
      'The rule conditions cannot select transactions; it cannot be applied to existing transactions',
    );
  }
  const op = serialized.conditionsOp === 'or' ? '$or' : '$and';
  const { data: matching } = await aqlQuery(
    q('transactions')
      .filter({ [op]: filters, id: { $oneof: sorted } })
      .select('id'),
  );
  const matched = new Set((matching as Array<{ id: string }>).map(r => r.id));
  const unmatched = sorted.filter(id => !matched.has(id));
  if (unmatched.length) {
    throw APIError(
      `Transactions no longer match the rule conditions: ${unmatched.slice(0, 5).join(', ')}`,
    );
  }

  const transactions = sorted.map(id => found.get(id)!);
  const dryRun = { newPayeeNames: [] as string[] };
  let planned: TransactionEntity[] | null;
  try {
    planned = await planRuleActions(
      structuredClone(transactions),
      serialized.actions,
      dryRun,
    );
  } catch (error) {
    throw APIError(
      `Rule actions could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!planned) throw APIError('Rule actions could not be parsed');
  const frozen = new Set(sorted);
  const ruleErrors = planned.flatMap(row =>
    Array.isArray((row as Row)._ruleErrors)
      ? ((row as Row)._ruleErrors as unknown[]).map(String)
      : [],
  );
  const proposal: RuleApplyProposal = {
    schemaVersion: 1,
    operation: 'rules.apply',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      // JSON round trip drops undefined option keys so the proposal is
      // stable once stored in a receipt.
      rule: JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>,
      rows: project(await readRows(sorted), frozen),
    },
    after: {
      rows: project(planned as unknown as Row[], frozen),
      reconciledIds,
      newPayees: [...new Set(dryRun.newPayeeNames)].sort(),
      errors: ruleErrors,
    },
    references: {},
    sideEffects: [
      "apply the rule's actions to every listed transaction as the rule editor's apply does: fields are set, splits create child transactions, a delete action deletes the transaction, and payee names that match no payee create one",
      'rule learning and other rules are not run',
    ],
  };
  prepared.set(proposal, planned);
  return proposal;
}

export async function performRuleApply(current: RuleApplyProposal) {
  const planned = prepared.get(current);
  if (!planned) throw new Error('Rule application was not prepared');
  const created = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const name of current.after.newPayees) {
    const existing = (await db.getPayeeByName(name))?.id;
    const id = existing ?? (await db.insertPayee({ name }));
    ids.set(name, id);
    if (!existing) created.set(id, name);
  }
  const rows = planned.map(row => {
    const payee = row.payee as unknown;
    return typeof payee === 'string' && payee.startsWith(PLACEHOLDER)
      ? { ...row, payee: ids.get(payee.slice(PLACEHOLDER.length)) ?? null }
      : row;
  });
  // Placeholder payees that already existed by now behave as existing ones.
  for (const [name, id] of ids) {
    if (!created.has(id)) created.set(id, name);
  }
  await batchUpdateTransactions({ updated: rows });
  const frozen = new Set(current.request.ids);
  const written = await readRows(rows.map(row => row.id));
  const actual = project(written, frozen, created);
  if (
    written.length !== rows.length ||
    canonicalJson(actual) !== canonicalJson(current.after.rows)
  ) {
    throw new Error('Rule application acknowledgement does not match');
  }
  const createdIds = rows.map(row => row.id).filter(id => !frozen.has(id));
  return {
    changed: true,
    affectedIds: rows.map(row => row.id),
    ruleApplication: {
      updatedIds: rows.map(row => row.id).filter(id => frozen.has(id)),
      createdIds,
    },
  };
}
