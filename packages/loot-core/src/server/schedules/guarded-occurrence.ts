// Guarded post and skip of one schedule occurrence. The occurrence is
// identified by the schedule ID and its current next date; a retry or a
// stale preview cannot post twice because prepare rejects an occurrence
// that already has a linked transaction and apply re-prepares. Posting adds
// the transaction exactly as the app's "Post transaction" does (rules run,
// transfer schedules create the counterpart); skipping advances next_date
// with the engine's recurrence. Nothing is paid.
import { addTransactions, planAddedTransactions } from '#server/accounts/sync';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { projectAddedTransaction } from '#server/transactions/guarded-add';
import { canonicalJson } from '#shared/canonical-json';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import {
  extractScheduleConds,
  getNextDateAfter,
  getScheduledAmount,
  getScheduleOccurrenceMatchStartDate,
} from '#shared/schedules';
import type {
  ScheduleOccurrenceRequest,
  SchedulePostProposal,
  ScheduleSkipProposal,
  ScheduleSnapshot,
} from '#types/change-proposals';
import type { ScheduleEntity, TransactionEntity } from '#types/models';

import { getRuleForSchedule, skipNextDate } from './app';

function invalid(message: string): never {
  throw APIError(`Invalid schedule occurrence request: ${message}`);
}

async function occurrence(request: ScheduleOccurrenceRequest, post: boolean) {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['id', 'date', ...(post ? ['today'] : [])].includes(key),
    )
  ) {
    invalid(
      post ? 'provide id, date and optional today' : 'provide id and date',
    );
  }
  if (typeof request.id !== 'string' || !request.id) invalid('id is required');
  if (
    typeof request.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(request.date)
  ) {
    invalid('date must be the occurrence date YYYY-MM-DD');
  }
  if (request.today !== undefined && typeof request.today !== 'boolean') {
    invalid('today must be a boolean');
  }
  const { data } = await aqlQuery(
    q('schedules').filter({ id: request.id }).select('*'),
  );
  const schedule = (data as ScheduleEntity[])[0];
  if (!schedule) throw APIError(`Schedule does not exist: ${request.id}`);
  if (schedule.completed) {
    throw APIError(`Schedule ${request.id} is completed`);
  }
  if (schedule.next_date !== request.date) {
    throw APIError(
      `${request.date} is not the next occurrence of schedule ${request.id} (next is ${schedule.next_date ?? 'none'})`,
    );
  }
  const linked = await db.first<{ id: string; date: number }>(
    'SELECT id, date FROM v_transactions WHERE schedule = ? AND date >= ? AND is_child = 0 ORDER BY date LIMIT 1',
    [
      schedule.id,
      db.toDateRepr(
        getScheduleOccurrenceMatchStartDate(schedule, schedule.next_date),
      ),
    ],
  );
  const snapshot: ScheduleSnapshot = {
    id: schedule.id,
    name: schedule.name ?? null,
    nextDate: schedule.next_date,
    postsTransaction: Boolean(schedule.posts_transaction),
    account: schedule._account ?? null,
    payee: schedule._payee ?? null,
    amount: getScheduledAmount(schedule._amount),
  };
  return { schedule, snapshot, linked };
}

function transactionFor(schedule: ScheduleEntity, today: boolean | undefined) {
  return {
    payee: schedule._payee,
    account: schedule._account,
    amount: getScheduledAmount(schedule._amount),
    date: today ? monthUtils.currentDay() : schedule.next_date,
    schedule: schedule.id,
    cleared: false,
  };
}

export async function prepareSchedulePost(
  request: ScheduleOccurrenceRequest,
): Promise<SchedulePostProposal> {
  const { schedule, snapshot, linked } = await occurrence(request, true);
  if (linked) {
    throw APIError(
      `The ${request.date} occurrence of schedule ${request.id} already has transaction ${linked.id}`,
    );
  }
  if (!schedule._account) {
    throw APIError(`Schedule ${request.id} has no account to post to`);
  }
  const account = await db.first<{ closed: number }>(
    'SELECT closed FROM accounts WHERE id = ? AND tombstone = 0',
    [schedule._account],
  );
  if (!account || account.closed) {
    throw APIError(
      `Schedule ${request.id} posts to a closed or missing account`,
    );
  }
  const payee = schedule._payee
    ? await db.first<{ transfer_acct: string | null }>(
        'SELECT transfer_acct FROM payees WHERE id = ?',
        [schedule._payee],
      )
    : null;
  const { added, payeesToCreate } = await planAddedTransactions(
    schedule._account,
    [transactionFor(schedule, request.today)],
  );
  if (payeesToCreate.size > 0) {
    // ASSUMPTION: a rule-created payee would get a fresh ID on apply, so the
    // receipt could not be verified; refuse rather than post unverifiably.
    throw APIError(
      `Rules would create a new payee for schedule ${request.id}; post it in the app or set the payee first`,
    );
  }
  const ids = added.map(row => row.id);
  return JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      operation: 'schedules.post',
      budget: guardedBudgetIdentity(),
      request,
      before: { sourceHash: await guardedSourceHash(), schedule: snapshot },
      after: {
        rows: added.map(row =>
          projectAddedTransaction(
            row,
            row.payee ?? null,
            row.parent_id ? ids.indexOf(row.parent_id) : null,
          ),
        ),
        transferAccount: payee?.transfer_acct ?? null,
      },
      references: {},
      sideEffects: [
        "add the occurrence's transaction as the app's Post transaction does: rules run and a transfer schedule creates the counterpart transaction",
        'next_date is not changed here; the schedule shows the occurrence as paid and the engine advances recurring schedules as it does for app posts',
      ],
    }),
  );
}

export async function performSchedulePost(current: SchedulePostProposal) {
  const ids =
    (await addTransactions(current.before.schedule.account, [
      {
        payee: current.before.schedule.payee,
        account: current.before.schedule.account,
        amount: current.before.schedule.amount,
        date: current.request.today
          ? monthUtils.currentDay()
          : current.before.schedule.nextDate,
        schedule: current.before.schedule.id,
        cleared: false,
      },
    ])) ?? [];
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids } })
      .select('*')
      .options({ splits: 'all' }),
  );
  const byId = new Map((data as TransactionEntity[]).map(row => [row.id, row]));
  const actual = ids.map(id => {
    const row = byId.get(id);
    if (!row) throw new Error('Schedule post acknowledgement is incomplete');
    return projectAddedTransaction(
      row,
      row.payee ?? null,
      row.parent_id ? ids.indexOf(row.parent_id) : null,
    );
  });
  if (
    canonicalJson(actual) !== canonicalJson(current.after.rows) ||
    byId.get(ids[0])?.schedule !== current.before.schedule.id
  ) {
    throw new Error('Schedule post acknowledgement does not match');
  }
  const transfer = byId.get(ids[0])?.transfer_id;
  return {
    changed: true,
    affectedIds: transfer ? [...ids, transfer] : ids,
    schedulePost: { transactionIds: ids },
  };
}

export async function prepareScheduleSkip(
  request: ScheduleOccurrenceRequest,
): Promise<ScheduleSkipProposal> {
  const { schedule, snapshot } = await occurrence(request, false);
  const rule = await getRuleForSchedule(schedule.id);
  if (!rule) throw APIError(`Schedule ${request.id} has no rule`);
  const { date: dateCond } = extractScheduleConds(rule.serialize().conditions);
  const nextDate = dateCond
    ? getNextDateAfter(dateCond, schedule.next_date)
    : null;
  if (!nextDate) {
    throw APIError(
      `Schedule ${request.id} has no occurrence after ${request.date}; complete it instead`,
    );
  }
  return {
    schemaVersion: 1,
    operation: 'schedules.skip',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), schedule: snapshot },
    after: { nextDate },
    references: {},
    sideEffects: [
      'advance next_date past this occurrence with the engine recurrence; no transaction is added or changed',
    ],
  };
}

export async function performScheduleSkip(current: ScheduleSkipProposal) {
  await skipNextDate({ id: current.request.id });
  const { data } = await aqlQuery(
    q('schedules').filter({ id: current.request.id }).select('next_date'),
  );
  const nextDate = (data as Array<{ next_date: string }>)[0]?.next_date;
  if (nextDate !== current.after.nextDate) {
    throw new Error('Schedule skip acknowledgement does not match');
  }
  return {
    changed: true,
    affectedIds: [current.request.id],
    scheduleSkip: {
      previousDate: current.request.date,
      nextDate,
    },
  };
}
