import { AgentError } from './agent-output';
import { isRecord } from './utils';

export type JsonSchema = {
  type?:
    | 'object'
    | 'array'
    | 'string'
    | 'integer'
    | 'number'
    | 'boolean'
    | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  enum?: unknown[];
  format?: 'date';
  pattern?: string;
};

const string: JsonSchema = { type: 'string' };
const money: JsonSchema = { type: 'integer' };
const boolean: JsonSchema = { type: 'boolean' };
const date: JsonSchema = { type: 'string', format: 'date' };
const nullableId: JsonSchema = { anyOf: [string, { type: 'null' }] };
const object = (
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const split = object(
  { amount: money, category: string, payee: nullableId, notes: string },
  ['amount'],
);
const importProperties = {
  account: string,
  date,
  amount: money,
  payee: nullableId,
  payee_name: string,
  imported_payee: string,
  category: string,
  notes: string,
  imported_id: string,
  transfer_id: string,
  cleared: boolean,
  subtransactions: { type: 'array', items: split } satisfies JsonSchema,
};
const transactionUpdate = object({
  ...importProperties,
  id: string,
  is_parent: boolean,
  is_child: boolean,
  parent_id: string,
  starting_balance_flag: boolean,
  sort_order: { type: 'number' },
  reconciled: boolean,
  tombstone: boolean,
  forceUpcoming: boolean,
  schedule: string,
});
delete transactionUpdate.properties?.payee_name;
const ruleFields = {
  stage: { enum: ['pre', 'post', 'default', null] },
  conditionsOp: { enum: ['and', 'or'] },
  conditions: { type: 'array', items: { type: 'object' } },
  actions: { type: 'array', items: { type: 'object' } },
} satisfies Record<string, JsonSchema>;
const rule = object(
  {
    id: string,
    stage: { enum: ['pre', 'post', 'default', null] },
    conditionsOp: { enum: ['and', 'or'] },
    conditions: { type: 'array', items: { type: 'object' } },
    actions: { type: 'array', items: { type: 'object' } },
    tombstone: boolean,
  },
  ['stage', 'conditionsOp', 'conditions', 'actions'],
);
const schedule = object({
  id: string,
  name: string,
  posts_transaction: boolean,
  rule: string,
  next_date: date,
  completed: boolean,
  payee: nullableId,
  account: nullableId,
  amount: {
    anyOf: [money, object({ num1: money, num2: money }, ['num1', 'num2'])],
  },
  amountOp: { enum: ['is', 'isapprox', 'isbetween'] },
  date: { anyOf: [date, { type: 'object' }] },
});

export function operationPayloadSchema(name: string): JsonSchema | undefined {
  switch (name) {
    case 'changes.preview':
      return {
        anyOf: [
          object({
            notes: string,
            amount: money,
            date,
            cleared: boolean,
            category: nullableId,
            payee: string,
          }),
          { type: 'array', items: object(importProperties, ['date']) },
          object({ note: string }, ['note']),
          object({ value: nullableId }, ['value']),
          object({ transferAccount: string, transferCategory: string }),
          object({ transferCategoryId: string }),
          object(
            {
              name: string,
              is_income: boolean,
              hidden: boolean,
              categories: {
                type: 'array',
                items: object(
                  {
                    id: string,
                    name: string,
                    group_id: string,
                    is_income: boolean,
                    hidden: boolean,
                  },
                  ['id', 'name', 'group_id'],
                ),
              },
            },
            ['name'],
          ),
          object({
            id: string,
            name: string,
            is_income: boolean,
            hidden: boolean,
            categories: {
              type: 'array',
              items: object(
                {
                  id: string,
                  name: string,
                  group_id: string,
                  is_income: boolean,
                  hidden: boolean,
                },
                ['id', 'name', 'group_id'],
              ),
            },
          }),
          object({
            id: string,
            name: string,
            group_id: string,
            hidden: boolean,
            is_income: boolean,
          }),
          object(
            {
              name: string,
              group_id: string,
              is_income: boolean,
              hidden: boolean,
            },
            ['name', 'group_id'],
          ),
          object({ month: { type: 'string' }, amount: money }, [
            'month',
            'amount',
          ]),
          {
            ...object({
              name: string,
              offbudget: boolean,
              closed: boolean,
              balance_current: { anyOf: [money, { type: 'null' }] },
              account_group_id: nullableId,
            }),
          },
          object({ name: string }, ['name']),
          object({ name: string, transfer_acct: string }, ['name']),
          object({ mergeIds: { type: 'array', items: string } }, ['mergeIds']),
          object(
            {
              ids: { type: 'array', items: string },
              category: nullableId,
              allowReconciled: boolean,
            },
            ['ids', 'category'],
          ),
          object(
            {
              ids: { type: 'array', items: string },
              allowReconciled: boolean,
            },
            ['ids'],
          ),
          object(
            {
              ids: { type: 'array', items: string },
              cleared: boolean,
              unlock: boolean,
            },
            ['ids', 'cleared'],
          ),
          object({ id: string, allowReconciled: boolean }, ['id']),
          object(
            {
              subtransactions: {
                type: 'array',
                items: object(
                  {
                    amount: money,
                    category: nullableId,
                    notes: { anyOf: [string, { type: 'null' }] },
                    payee: nullableId,
                  },
                  ['amount'],
                ),
              },
              allowReconciled: boolean,
            },
            ['subtransactions'],
          ),
          object(
            { config: { anyOf: [{ type: 'object' }, { type: 'null' }] } },
            ['config'],
          ),
          object(ruleFields, [
            'stage',
            'conditionsOp',
            'conditions',
            'actions',
          ]),
          object(ruleFields),
          object({ fields: { type: 'object' }, resetNextDate: boolean }, [
            'fields',
          ]),
          { ...schedule, required: ['date', 'amountOp', 'posts_transaction'] },
          object(
            {
              tag: string,
              color: { anyOf: [string, { type: 'null' }] },
              description: { anyOf: [string, { type: 'null' }] },
            },
            ['tag'],
          ),
          object({
            tag: string,
            color: { anyOf: [string, { type: 'null' }] },
            description: { anyOf: [string, { type: 'null' }] },
          }),
          object({ name: string, path: string, timeout: money }, [
            'name',
            'path',
          ]),
          object({ archived: boolean }, ['archived']),
          object({ encrypted: boolean }, ['encrypted']),
          object({ month: { type: 'string' } }, ['month']),
          object(
            {
              name: string,
              offbudget: boolean,
              initialBalance: money,
              closed: boolean,
            },
            ['name', 'offbudget', 'initialBalance'],
          ),
          object({ month: { type: 'string' }, flag: boolean }, [
            'month',
            'flag',
          ]),
          object(
            {
              name: string,
              currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            },
            ['name'],
          ),
        ],
      };
    case 'profiles.set':
      return object({
        serverUrl: string,
        syncId: string,
        budgetId: string,
        dataDir: string,
        offline: boolean,
        passwordFile: string,
        sessionTokenFile: string,
        encryptionPasswordFile: string,
      });
    case 'transactions.add':
    case 'transactions.import':
      return { type: 'array', items: object(importProperties, ['date']) };
    case 'transactions.update':
      return transactionUpdate;
    case 'rules.create':
      return rule;
    case 'rules.update':
      return { ...rule, required: [...(rule.required ?? []), 'id'] };
    case 'schedules.create':
      return {
        ...schedule,
        required: ['date', 'amountOp', 'posts_transaction'],
      };
    case 'schedules.update':
      return schedule;
    case 'query.run':
      return object({
        table: string,
        select: { type: 'array' },
        filter: { type: 'object' },
        orderBy: { anyOf: [{ type: 'array' }, string, { type: 'object' }] },
        groupBy: { type: 'array' },
        limit: money,
        offset: money,
        options: { type: 'object' },
        calculate: {},
        withDead: boolean,
      });
    default:
      return undefined;
  }
}

export function validateJson(
  value: unknown,
  schema: JsonSchema,
  path = 'data',
) {
  function fail() {
    throw new AgentError(
      'INVALID_INPUT',
      'JSON input does not match the operation schema.',
      false,
      { field: path },
    );
  }
  if (schema.anyOf) {
    for (const alternative of schema.anyOf) {
      try {
        validateJson(value, alternative, path);
        return;
      } catch (error) {
        if (!(error instanceof AgentError)) throw error;
      }
    }
    fail();
  }
  if (schema.enum && !schema.enum.includes(value)) fail();
  switch (schema.type) {
    case 'object':
      if (!isRecord(value)) return fail();
      for (const field of schema.required ?? []) if (!(field in value)) fail();
      for (const [key, child] of Object.entries(value)) {
        const property = schema.properties?.[key];
        if (property) {
          validateJson(child, property, `${path}.${key}`);
        } else if (schema.additionalProperties === false) {
          throw new AgentError('INVALID_INPUT', 'Unknown JSON field.', false, {
            field: `${path}.${key}`,
          });
        }
      }
      break;
    case 'array':
      if (!Array.isArray(value)) return fail();
      if (schema.items) {
        value.forEach((child, index) =>
          validateJson(child, schema.items ?? {}, `${path}[${index}]`),
        );
      }
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail();
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail();
      break;
    case 'string':
      if (typeof value !== 'string') return fail();
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail();
      if (
        schema.format === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      ) {
        fail();
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail();
      break;
    case 'null':
      if (value !== null) fail();
      break;
    default:
      break;
  }
}
