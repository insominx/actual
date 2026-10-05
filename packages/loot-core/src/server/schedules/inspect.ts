// Read-only schedule inspection: next date, status, links and the
// occurrences in a date window, all computed with the engine's recurrence
// helpers (the same ones that advance next_date), plus transactions already
// posted for the schedule in that window. Schedules record bills; nothing
// here pays or posts anything.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import {
  DEFAULT_UPCOMING_SCHEDULE_DAYS,
  extractScheduleConds,
  getHasTransactionsQuery,
  getNextDate,
  getNextDateAfter,
  getScheduledAmount,
  getStatus,
  scheduleIsRecurring,
} from '#shared/schedules';
import type { ScheduleEntity } from '#types/models';

export type ScheduleInspection = {
  id: string;
  name: string | null;
  completed: boolean;
  postsTransaction: boolean;
  nextDate: string | null;
  status: string;
  recurring: boolean;
  date: unknown;
  amount: number;
  amountOp: string;
  amountRange: { num1: number; num2: number } | null;
  account: { id: string; name: string; closed: boolean } | null;
  payee: { id: string; name: string } | null;
  transferAccount: { id: string; name: string } | null;
  category: string | null;
  hasSplits: boolean;
  occurrences: string[];
  occurrencesTruncated: boolean;
  posted: Array<{ id: string; date: string; amount: number }>;
};

export type ScheduleInspectionResult = {
  window: { start: string; end: string };
  schedules: ScheduleInspection[];
};

const OCCURRENCE_LIMIT = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): never {
  throw APIError(`Invalid schedule inspection request: ${message}`);
}

// Occurrence dates in [start, end] from a schedule's date condition.
export function scheduleOccurrences(
  dateCond: unknown,
  start: string,
  end: string,
  limit = OCCURRENCE_LIMIT,
) {
  const dates: string[] = [];
  if (!dateCond) return { dates, truncated: false };
  let next = getNextDate(dateCond, monthUtils.parseDate(start));
  while (next != null && next <= end) {
    if (next >= start) {
      if (dates.length === limit) return { dates, truncated: true };
      if (!dates.includes(next)) dates.push(next);
    }
    const after = getNextDateAfter(dateCond, next);
    if (after == null || after <= next) break;
    next = after;
  }
  return { dates, truncated: false };
}

export type ScheduleInspectionRequest = {
  id?: string;
  account?: string;
  start?: string;
  end?: string;
  includeCompleted?: boolean;
};

export async function inspectSchedules(
  request: ScheduleInspectionRequest = {},
): Promise<ScheduleInspectionResult> {
  if (typeof request !== 'object' || request === null) {
    invalid('expected an object');
  }
  for (const key of Object.keys(request)) {
    if (!['id', 'account', 'start', 'end', 'includeCompleted'].includes(key)) {
      invalid(`unknown field ${key}`);
    }
  }
  const start = request.start ?? monthUtils.currentDay();
  const end = request.end ?? monthUtils.addDays(start, 30);
  if (!DATE.test(start) || !DATE.test(end) || end < start) {
    invalid('start and end must be YYYY-MM-DD with end on or after start');
  }
  if (monthUtils.differenceInCalendarDays(end, start) > 366 * 3) {
    invalid('the window is at most three years');
  }
  let query = q('schedules').select('*');
  if (request.id !== undefined) query = query.filter({ id: request.id });
  const { data } = await aqlQuery(query);
  let schedules = data as ScheduleEntity[];
  if (request.id !== undefined && !schedules.length) {
    throw APIError(`Schedule does not exist: ${request.id}`);
  }
  if (request.account !== undefined) {
    schedules = schedules.filter(s => s._account === request.account);
  }
  if (!request.includeCompleted && request.id === undefined) {
    schedules = schedules.filter(s => !s.completed);
  }
  const { data: hasTransData } = await aqlQuery(
    getHasTransactionsQuery(schedules),
  );
  const hasTrans = new Set(
    (hasTransData as Array<{ schedule: string } | null>)
      .filter(Boolean)
      .map(row => row!.schedule),
  );
  const upcomingPref = await db.first<{ value: string }>(
    "SELECT value FROM preferences WHERE id = 'upcomingScheduledTransactionLength'",
  );
  const accounts = new Map(
    (
      await db.all<{ id: string; name: string; closed: number }>(
        'SELECT id, name, closed FROM accounts WHERE tombstone = 0',
      )
    ).map(a => [a.id, a]),
  );
  const payees = new Map(
    (
      await db.all<{ id: string; name: string; transfer_acct: string | null }>(
        'SELECT id, name, transfer_acct FROM payees WHERE tombstone = 0',
      )
    ).map(p => [p.id, p]),
  );
  const result: ScheduleInspection[] = [];
  for (const schedule of schedules) {
    const conds = extractScheduleConds(schedule._conditions ?? []);
    const { dates, truncated } = schedule.completed
      ? { dates: [], truncated: false }
      : scheduleOccurrences(conds.date, start, end);
    const posted = await db.all<{ id: string; date: number; amount: number }>(
      'SELECT id, date, amount FROM v_transactions WHERE schedule = ? AND date >= ? AND date <= ? AND is_child = 0 ORDER BY date',
      [schedule.id, db.toDateRepr(start), db.toDateRepr(end)],
    );
    const account = schedule._account ? accounts.get(schedule._account) : null;
    const payee = schedule._payee ? payees.get(schedule._payee) : null;
    const transfer = payee?.transfer_acct
      ? accounts.get(payee.transfer_acct)
      : null;
    const categoryAction = (schedule._actions ?? []).find(
      action => action.op === 'set' && action.field === 'category',
    );
    const amount = schedule._amount;
    result.push({
      id: schedule.id,
      name: schedule.name ?? null,
      completed: Boolean(schedule.completed),
      postsTransaction: Boolean(schedule.posts_transaction),
      nextDate: schedule.next_date ?? null,
      status: getStatus(
        schedule.next_date,
        Boolean(schedule.completed),
        hasTrans.has(schedule.id),
        schedule.custom_upcoming_length ??
          upcomingPref?.value ??
          DEFAULT_UPCOMING_SCHEDULE_DAYS,
      ),
      recurring: scheduleIsRecurring(conds.date),
      date: schedule._date ?? null,
      amount: getScheduledAmount(amount),
      amountOp: schedule._amountOp,
      amountRange:
        typeof amount === 'object' && amount !== null
          ? { num1: amount.num1, num2: amount.num2 }
          : null,
      account: account
        ? { id: account.id, name: account.name, closed: !!account.closed }
        : null,
      payee: payee ? { id: payee.id, name: payee.name } : null,
      transferAccount: transfer
        ? { id: transfer.id, name: transfer.name }
        : null,
      category:
        typeof categoryAction?.value === 'string' ? categoryAction.value : null,
      hasSplits: Boolean(schedule._has_splits),
      occurrences: dates,
      occurrencesTruncated: truncated,
      posted: posted.map(row => ({
        id: row.id,
        date: db.fromDateRepr(row.date),
        amount: row.amount,
      })),
    });
  }
  result.sort(
    (a, b) =>
      String(a.nextDate ?? '9999').localeCompare(
        String(b.nextDate ?? '9999'),
      ) || a.id.localeCompare(b.id),
  );
  return { window: { start, end }, schedules: result };
}
