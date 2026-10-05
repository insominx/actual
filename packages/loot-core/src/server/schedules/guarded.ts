import { scheduleModel } from '#server/api-models';
import type { APIScheduleEntity } from '#server/api-models';
// Read-only plans and canonical writers for guarded schedule creation,
// updates and deletions. Schedules own a linked rule and a next-date row, so
// plans bind the schedule fields and the exact rule conditions/actions that the
// schedule owners must produce; next dates are disclosed, not predicted.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import { ruleModel } from '#server/transactions/transaction-rules';
import { q } from '#shared/query';
import { extractScheduleConds } from '#shared/schedules';
import type {
  ScheduleCreationProposal,
  ScheduleCreationRequest,
  ScheduleDeletionProposal,
  ScheduleDeletionRequest,
  ScheduleUpdateProposal,
  ScheduleUpdateRequest,
} from '#types/change-proposals';
import type { RuleConditionEntity, ScheduleEntity } from '#types/models';

import { applyApiScheduleFields } from './api-fields';
import {
  checkIfScheduleExists,
  createSchedule,
  deleteSchedule,
  normalizeScheduleName,
  updateActions,
  updateConditions,
  updateSchedule,
} from './app';

const CREATE_FIELDS = [
  'name',
  'posts_transaction',
  'payee',
  'account',
  'amount',
  'amountOp',
  'date',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializedConditions(conditions: unknown[]) {
  return (ruleModel.fromJS({ conditions }) as { conditions: string })
    .conditions;
}

function serializedActions(actions: unknown[]) {
  return (ruleModel.fromJS({ actions }) as { actions: string }).actions;
}

async function liveRow(table: 'payees' | 'accounts', id: unknown) {
  if (typeof id !== 'string' || !id) {
    return false;
  }
  const row = await db.first<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ? AND tombstone = 0`,
    [id],
  );
  return !!row;
}

async function loadSchedule(id: unknown) {
  if (typeof id !== 'string' || !id.trim()) {
    throw APIError('Invalid schedule request: provide an id');
  }
  const row = await db.first<Record<string, unknown>>(
    'SELECT * FROM schedules WHERE id = ?',
    [id],
  );
  if (!row || row.tombstone) {
    throw APIError(`Schedule does not exist: ${id}`);
  }
  const rule = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [String(row.rule)],
  );
  if (!rule || rule.tombstone) {
    throw APIError(`Schedule ${id} has no live rule; repair it in the app`);
  }
  return { row, rule };
}

export async function prepareScheduleCreation(
  request: ScheduleCreationRequest,
): Promise<ScheduleCreationProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !CREATE_FIELDS.includes(key)) ||
    typeof request.posts_transaction !== 'boolean' ||
    !['is', 'isapprox', 'isbetween'].includes(request.amountOp as string) ||
    request.date == null ||
    (request.name !== undefined &&
      request.name !== null &&
      typeof request.name !== 'string')
  ) {
    throw APIError(
      'Invalid schedule creation request: provide posts_transaction, amountOp, date, payee and account',
    );
  }
  if (!(await liveRow('payees', request.payee))) {
    throw APIError('Schedule payee must name a live payee');
  }
  if (!(await liveRow('accounts', request.account))) {
    throw APIError('Schedule account must name a live account');
  }
  const internal = scheduleModel.fromExternal({
    ...(request as APIScheduleEntity),
    id: '',
  });
  const name = normalizeScheduleName(internal.name);
  if (name && (await checkIfScheduleExists(name, null))) {
    throw APIError(`There is already a schedule named: ${name}`);
  }
  if (extractScheduleConds(internal._conditions).date?.value == null) {
    throw APIError('A schedule date is required');
  }
  return {
    schemaVersion: 1,
    operation: 'schedules.create',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash() },
    after: {
      schedule: {
        name,
        posts_transaction: request.posts_transaction ? 1 : 0,
        tombstone: 0,
      },
      rule: {
        stage: null,
        conditions_op: 'and',
        conditions: serializedConditions(internal._conditions),
        tombstone: 0,
      },
    },
    references: {},
    sideEffects: [
      'create one schedule, its linked rule and its next-date row through the canonical schedule owner; the next date is computed from the current day at apply',
    ],
  };
}

export async function performScheduleCreation(
  current: ScheduleCreationProposal,
) {
  const internal = scheduleModel.fromExternal({
    ...(current.request as APIScheduleEntity),
    id: '',
  });
  const scheduleId = await createSchedule({
    schedule: {
      name: internal.name,
      posts_transaction: internal.posts_transaction,
    },
    conditions: internal._conditions as RuleConditionEntity[],
  });
  const schedule = await db.first<Record<string, unknown>>(
    'SELECT * FROM schedules WHERE id = ?',
    [scheduleId],
  );
  const rule = schedule
    ? await db.first<Record<string, unknown>>(
        'SELECT * FROM rules WHERE id = ?',
        [String(schedule.rule)],
      )
    : null;
  const nextDate = await db.first<{ id: string }>(
    'SELECT id FROM schedules_next_date WHERE schedule_id = ? AND tombstone = 0',
    [scheduleId],
  );
  if (
    !schedule ||
    !rule ||
    !nextDate ||
    !rowMatches(schedule, current.after.schedule) ||
    !rowMatches(rule, current.after.rule) ||
    rule.actions !==
      serializedActions([{ op: 'link-schedule', value: scheduleId }])
  ) {
    throw new Error('Schedule creation acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [scheduleId],
    scheduleCreation: { scheduleId, ruleId: String(schedule.rule) },
  };
}

// Applies public fields to a copy of the stored schedule exactly like the
// legacy handler, then derives the rule the update owner will write.
async function planUpdate(request: ScheduleUpdateRequest) {
  const { row, rule } = await loadSchedule(request.id);
  const { data } = await aqlQuery(
    q('schedules').filter({ id: request.id }).select('*'),
  );
  const sched = structuredClone((data as ScheduleEntity[])[0]);
  if (!sched) {
    throw APIError(`Schedule does not exist: ${request.id}`);
  }
  const assigned = await applyApiScheduleFields(sched, request.fields);
  if (!assigned) {
    throw APIError('Schedule update requires at least one field');
  }
  const name = normalizeScheduleName(sched.name);
  if (name && (await checkIfScheduleExists(name, request.id))) {
    throw APIError(`There is already a schedule named: ${name}`);
  }
  const stored = ruleModel.toJS(rule) as {
    conditions: RuleConditionEntity[];
    actions: Parameters<typeof updateActions>[1];
  };
  const conditions = updateConditions(stored.conditions, sched._conditions);
  if (extractScheduleConds(conditions).date?.value == null) {
    throw APIError('A schedule date is required');
  }
  const actions = updateActions(conditions, stored.actions) ?? stored.actions;
  return { row, rule, sched, name, conditions, actions };
}

export async function prepareScheduleUpdate(
  request: ScheduleUpdateRequest,
): Promise<ScheduleUpdateProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(
      key => !['id', 'fields', 'resetNextDate'].includes(key),
    ) ||
    !isRecord(request.fields) ||
    !Object.keys(request.fields).length ||
    (request.resetNextDate !== undefined &&
      typeof request.resetNextDate !== 'boolean')
  ) {
    throw APIError(
      'Invalid schedule update request: provide an id, fields and optional resetNextDate',
    );
  }
  for (const key of ['payee', 'account'] as const) {
    if (
      key in request.fields &&
      !(await liveRow(
        key === 'payee' ? 'payees' : 'accounts',
        request.fields[key],
      ))
    ) {
      throw APIError(`Schedule ${key} must name a live ${key}`);
    }
  }
  const plan = await planUpdate(request);
  return {
    schemaVersion: 1,
    operation: 'schedules.update',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      schedule: { ...plan.row },
      rule: { ...plan.rule },
    },
    after: {
      schedule: {
        ...plan.row,
        name: plan.name,
        posts_transaction: plan.sched.posts_transaction ? 1 : 0,
      },
      rule: {
        ...plan.rule,
        conditions: serializedConditions(plan.conditions),
        actions: serializedActions(plan.actions),
      },
    },
    references: {},
    sideEffects: [
      'update one schedule and its linked rule through the canonical schedule owner; the next date is recomputed when the date or account changes or resetNextDate is set',
    ],
  };
}

export async function performScheduleUpdate(current: ScheduleUpdateProposal) {
  const plan = await planUpdate(current.request);
  await updateSchedule({
    schedule: {
      id: current.request.id,
      posts_transaction: plan.sched.posts_transaction,
      name: plan.sched.name,
    },
    conditions: plan.sched._conditions as RuleConditionEntity[],
    resetNextDate: current.request.resetNextDate,
  });
  const schedule = await db.first<Record<string, unknown>>(
    'SELECT * FROM schedules WHERE id = ?',
    [current.request.id],
  );
  const rule = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [String(current.before.schedule.rule)],
  );
  if (
    !rowMatches(schedule, current.after.schedule) ||
    !rowMatches(rule, current.after.rule)
  ) {
    throw new Error('Schedule update acknowledgement is incomplete');
  }
  return { changed: true, affectedIds: [current.request.id] };
}

export async function prepareScheduleDeletion(
  request: ScheduleDeletionRequest,
): Promise<ScheduleDeletionProposal> {
  if (!isRecord(request) || Object.keys(request).some(key => key !== 'id')) {
    throw APIError('Invalid schedule deletion request: provide an id');
  }
  const { row, rule } = await loadSchedule(request.id);
  return {
    schemaVersion: 1,
    operation: 'schedules.delete',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      schedule: { ...row },
      rule: { ...rule },
    },
    after: { action: 'tombstone', ruleId: String(row.rule) },
    references: {},
    sideEffects: [
      'tombstone one schedule and its linked rule through the canonical schedule owner; transactions already posted keep their schedule link',
    ],
  };
}

export async function performScheduleDeletion(
  current: ScheduleDeletionProposal,
) {
  await deleteSchedule({ id: current.request.id });
  const schedule = await db.first<Record<string, unknown>>(
    'SELECT * FROM schedules WHERE id = ?',
    [current.request.id],
  );
  const rule = await db.first<Record<string, unknown>>(
    'SELECT * FROM rules WHERE id = ?',
    [current.after.ruleId],
  );
  if (schedule?.tombstone !== 1 || rule?.tombstone !== 1) {
    throw new Error('Schedule deletion acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [current.request.id, current.after.ruleId],
  };
}
