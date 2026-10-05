// Read-only plans and canonical writers for guarded rule creation, updates and
// deletions. Plans validate with the same owner checks the legacy handlers use
// and bind the exact serialized rule row the writer must produce.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import { ruleModel } from '#server/transactions/transaction-rules';
import type {
  RuleCreationProposal,
  RuleCreationRequest,
  RuleDeletionProposal,
  RuleDeletionRequest,
  RuleFieldsRequest,
  RuleUpdateProposal,
  RuleUpdateRequest,
} from '#types/change-proposals';
import type { NewRuleEntity } from '#types/models';

import { addRule, deleteRule, updateRule, validateRule } from './app';

const RULE_FIELDS = ['stage', 'conditionsOp', 'conditions', 'actions'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Converts public fields to the internal entity and applies owner validation.
function normalizeRule(fields: RuleFieldsRequest): NewRuleEntity {
  if (!Array.isArray(fields.conditions) || !Array.isArray(fields.actions)) {
    throw APIError('Rule conditions and actions must be arrays');
  }
  const rule: NewRuleEntity = {
    stage: fields.stage === 'default' ? null : fields.stage,
    conditionsOp: fields.conditionsOp,
    conditions: fields.conditions,
    actions: fields.actions,
  };
  try {
    ruleModel.validate(rule);
  } catch (error) {
    throw APIError(
      error instanceof Error ? error.message : 'Invalid rule fields',
    );
  }
  const errors = validateRule(rule);
  if (errors) {
    throw APIError('Invalid rule conditions or actions', {
      conditionErrors: (errors.conditionErrors ?? []) as string[],
      actionErrors: (errors.actionErrors ?? []) as string[],
    });
  }
  return rule;
}

function serializedRow(rule: NewRuleEntity) {
  return ruleModel.fromJS(rule) as Record<string, unknown>;
}

async function liveRule(id: unknown) {
  if (typeof id !== 'string' || !id.trim()) {
    throw APIError('Invalid rule request: provide an id');
  }
  const row = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [id],
  );
  if (!row || row.tombstone) {
    throw APIError(`Rule does not exist: ${id}`);
  }
  return row;
}

// Schedule rules are owned by their schedule. The delete owner refuses them
// (it checks every schedule row, including deleted ones); guarded updates
// refuse them too so a rule edit cannot desynchronize its schedule.
async function rejectScheduleRule(id: string, verb: 'edit' | 'delete') {
  const schedule = await db.first<{ id: string }>(
    'SELECT id FROM schedules WHERE rule = ?',
    [id],
  );
  if (schedule) {
    throw APIError(
      `Rule belongs to schedule ${schedule.id}; ${verb} the schedule instead`,
    );
  }
}

export async function prepareRuleCreation(
  request: RuleCreationRequest,
): Promise<RuleCreationProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !RULE_FIELDS.includes(key)) ||
    RULE_FIELDS.some(key => !(key in request))
  ) {
    throw APIError(
      'Invalid rule creation request: provide stage, conditionsOp, conditions and actions',
    );
  }
  const rule = normalizeRule(request);
  return {
    schemaVersion: 1,
    operation: 'rules.create',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash() },
    after: { rule: { ...serializedRow(rule), tombstone: 0 } },
    references: {},
    sideEffects: [
      'create one rule through the canonical owner; existing transactions are not re-run against it',
    ],
  };
}

export async function performRuleCreation(current: RuleCreationProposal) {
  const created = await addRule(normalizeRule(current.request));
  if ('error' in created) {
    throw new Error('Rule creation failed owner validation after preview');
  }
  const actual = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [created.id],
  );
  if (!rowMatches(actual, current.after.rule)) {
    throw new Error('Rule creation acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [created.id],
    ruleCreation: { ruleId: created.id },
  };
}

export async function prepareRuleUpdate(
  request: RuleUpdateRequest,
): Promise<RuleUpdateProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !isRecord(request.fields) ||
    !Object.keys(request.fields).length ||
    Object.keys(request.fields).some(key => !RULE_FIELDS.includes(key))
  ) {
    throw APIError(
      'Invalid rule update request: provide an id and stage, conditionsOp, conditions or actions',
    );
  }
  const row = await liveRule(request.id);
  await rejectScheduleRule(request.id, 'edit');
  const current = ruleModel.toJS(row) as NewRuleEntity;
  const rule = normalizeRule({
    stage: current.stage,
    conditionsOp: current.conditionsOp,
    conditions: current.conditions,
    actions: current.actions,
    ...request.fields,
  });
  return {
    schemaVersion: 1,
    operation: 'rules.update',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), rule: { ...row } },
    after: { rule: { ...row, ...serializedRow(rule) } },
    references: {},
    sideEffects: [
      'replace one rule definition through the canonical owner; existing transactions are not re-run against it',
    ],
  };
}

export async function performRuleUpdate(current: RuleUpdateProposal) {
  const row = await liveRule(current.request.id);
  const existing = ruleModel.toJS(row) as NewRuleEntity;
  const rule = normalizeRule({
    stage: existing.stage,
    conditionsOp: existing.conditionsOp,
    conditions: existing.conditions,
    actions: existing.actions,
    ...current.request.fields,
  });
  const updated = await updateRule({ id: current.request.id, ...rule });
  if ('error' in updated) {
    throw new Error('Rule update failed owner validation after preview');
  }
  const actual = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [current.request.id],
  );
  if (!rowMatches(actual, current.after.rule)) {
    throw new Error('Rule update acknowledgement is incomplete');
  }
  return {
    changed: Object.entries(current.after.rule).some(
      ([key, value]) => current.before.rule[key] !== value,
    ),
    affectedIds: [current.request.id],
  };
}

export async function prepareRuleDeletion(
  request: RuleDeletionRequest,
): Promise<RuleDeletionProposal> {
  if (!isRecord(request) || Object.keys(request).some(key => key !== 'id')) {
    throw APIError('Invalid rule deletion request: provide an id');
  }
  const row = await liveRule(request.id);
  await rejectScheduleRule(request.id, 'delete');
  return {
    schemaVersion: 1,
    operation: 'rules.delete',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), rule: { ...row } },
    after: { action: 'tombstone' },
    references: {},
    sideEffects: [
      'tombstone one rule through the canonical owner; transactions it already changed keep their values',
    ],
  };
}

export async function performRuleDeletion(current: RuleDeletionProposal) {
  if ((await deleteRule(current.request.id)) !== true) {
    throw new Error('Rule deletion was refused by the owner after preview');
  }
  const actual = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [current.request.id],
  );
  if (!actual || actual.tombstone !== 1) {
    throw new Error('Rule deletion acknowledgement is incomplete');
  }
  return { changed: true, affectedIds: [current.request.id] };
}
