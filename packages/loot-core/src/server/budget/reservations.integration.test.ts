import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { toDateRepr } from '#server/models';
import {
  createSchedule,
  setNextDate,
  skipNextDate,
  updateSchedule,
} from '#server/schedules/app';
import * as sheet from '#server/sheet';
import { addSyncListener } from '#server/sync';
import { loadRules } from '#server/transactions/transaction-rules';
import type { ReservationRow } from '#types/models/reservations';
import type { Template } from '#types/models/templates';

import * as actions from './actions';
import { createAllBudgets } from './base';
import { getReservations } from './reservations';
import * as scheduleTemplate from './schedule-template';
import * as templateNotes from './template-notes';

// `#server/db` is loaded by the global test setup before these mocks exist, so
// its `sendMessages` binding cannot be wrapped. CRDT writes are observed
// through `addSyncListener` instead.
vi.mock('./actions', async importOriginal => {
  const actual = await importOriginal<typeof actions>();
  return {
    ...actual,
    setBudget: vi.fn(actual.setBudget),
    setGoal: vi.fn(actual.setGoal),
  };
});
vi.mock('./template-notes', async importOriginal => {
  const actual = await importOriginal<typeof templateNotes>();
  return {
    ...actual,
    storeNoteTemplates: vi.fn(actual.storeNoteTemplates),
  };
});
vi.mock('./schedule-template', async importOriginal => {
  const actual = await importOriginal<typeof scheduleTemplate>();
  return { ...actual, runSchedule: vi.fn(actual.runSchedule) };
});

const DUMP_TABLES = [
  'categories',
  'notes',
  'zero_budgets',
  'schedules',
  'schedules_next_date',
  'transactions',
  'preferences',
];

const CATEGORY = 'bills';
const F1_NOTE = '#template schedule Insurance\n#template 500';

type DateRule = {
  start: string;
  frequency: 'monthly' | 'yearly' | 'weekly';
  interval?: number;
};

let originalCurrentMonth: string | null;

beforeEach(async () => {
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = '2026-09';
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  await sheet.loadSpreadsheet(db);

  await db.insertCategoryGroup({ id: 'group', name: 'Bills' });
  await db.insertCategoryGroup({
    id: 'income-group',
    name: 'Income',
    is_income: 1,
  });
  await db.insertCategory({
    id: 'income',
    name: 'Salary',
    cat_group: 'income-group',
    is_income: 1,
  });
  await db.insertAccount({ id: 'account', name: 'Checking' });
});

afterEach(() => {
  global.currentMonth = originalCurrentMonth;
});

async function addCategory(id: string, name: string, note?: string) {
  await db.insertCategory({ id, name, cat_group: 'group' });
  if (note !== undefined) {
    await db.update('notes', { id, note });
  }
}

async function setBalance(id: string, amount: number, month = '2026-09') {
  await createAllBudgets();
  await actions.setBudget({ category: id, month, amount });
  await sheet.waitOnSpreadsheet();
}

async function addSchedule(name: string, amount: number, date: DateRule) {
  return createSchedule({
    schedule: { name },
    conditions: [
      {
        op: 'is',
        field: 'date',
        value: {
          start: date.start,
          frequency: date.frequency,
          interval: date.interval ?? 1,
          patterns: [],
          skipWeekend: false,
          weekendSolveMode: 'after',
          endMode: 'never',
          endOccurrences: 1,
          endDate: date.start,
        },
      },
      { op: 'is', field: 'amount', value: amount },
    ],
  });
}

async function setStoredNextDate(scheduleId: string, date: string) {
  const row = await db.first<Pick<db.DbScheduleNextDate, 'id'>>(
    'SELECT id FROM schedules_next_date WHERE schedule_id = ?',
    [scheduleId],
  );
  if (!row) {
    throw new Error(`No next date row for ${scheduleId}`);
  }
  const now = Date.now();
  await db.update('schedules_next_date', {
    id: row.id,
    local_next_date: toDateRepr(date),
    local_next_date_ts: now,
    base_next_date: toDateRepr(date),
    base_next_date_ts: now,
  });
}

async function addInsurance(nextDate = '2027-03-15') {
  const id = await addSchedule('Insurance', -120000, {
    start: '2026-03-15',
    frequency: 'yearly',
  });
  await setStoredNextDate(id, nextDate);
  return id;
}

async function addRent(nextDate = '2026-09-05') {
  const id = await addSchedule('Rent', -150000, {
    start: '2026-01-05',
    frequency: 'monthly',
  });
  await setStoredNextDate(id, nextDate);
  return id;
}

async function storeUiTemplates(id: string, templates: Template[]) {
  await db.updateWithSchema('categories', {
    id,
    goal_def: JSON.stringify(templates),
    template_settings: { source: 'ui' },
  });
}

/** Calls the handler and proves the call wrote nothing. */
async function readReservations(month = '2026-09') {
  await sheet.waitOnSpreadsheet();
  vi.clearAllMocks();
  const before = await global.getDatabaseDump(DUMP_TABLES);
  const onApplied = vi.fn();
  const removeListener = addSyncListener(onApplied);

  const result = await getReservations({ month }).finally(removeListener);
  await sheet.waitOnSpreadsheet();

  expect(await global.getDatabaseDump(DUMP_TABLES)).toEqual(before);
  expect(onApplied).not.toHaveBeenCalled();
  expect(actions.setBudget).not.toHaveBeenCalled();
  expect(actions.setGoal).not.toHaveBeenCalled();
  expect(templateNotes.storeNoteTemplates).not.toHaveBeenCalled();
  expect(scheduleTemplate.runSchedule).not.toHaveBeenCalled();
  return result;
}

async function readRow(categoryId = CATEGORY, month = '2026-09') {
  const result = await readReservations(month);
  expect(result.month).toBe(month);
  const row = result.categories.find(c => c.categoryId === categoryId);
  if (!row) {
    throw new Error(`No row for ${categoryId}`);
  }
  return row;
}

function expectReady(row: ReservationRow) {
  if (row.state !== 'ready') {
    throw new Error(`Expected a ready row, got ${row.reason}`);
  }
  expect(row.reserved + row.allowance + row.spare).toBe(row.balance);
  return row;
}

function f1Row(insuranceId: string, label = 'Insurance'): ReservationRow {
  return {
    categoryId: CATEGORY,
    state: 'ready',
    balance: 120000,
    reserved: 60000,
    allowance: 50000,
    allowanceTotal: 50000,
    spare: 10000,
    shortfall: 0,
    claims: [
      {
        key: insuranceId,
        kind: 'schedule',
        label,
        nextDate: '2027-03-15',
        target: 120000,
        accrued: 60000,
      },
    ],
  };
}

describe('budget/get-reservations', () => {
  it('the no-write spies observe a real write', async () => {
    await addCategory(CATEGORY, 'Bills', F1_NOTE);
    await createAllBudgets();
    vi.clearAllMocks();
    const before = await global.getDatabaseDump(DUMP_TABLES);
    const onApplied = vi.fn();
    const removeListener = addSyncListener(onApplied);

    await actions.setBudget({
      category: CATEGORY,
      month: '2026-09',
      amount: 1,
    });
    removeListener();

    expect(onApplied).toHaveBeenCalled();
    expect(actions.setBudget).toHaveBeenCalled();
    expect(await global.getDatabaseDump(DUMP_TABLES)).not.toEqual(before);
  });

  it('F1 surplus through the handler', async () => {
    const insuranceId = await addInsurance();
    await addCategory(CATEGORY, 'Bills', F1_NOTE);
    await setBalance(CATEGORY, 120000);

    expect(await readRow()).toEqual(f1Row(insuranceId));
  });

  it('F2 deficit keeps the full reservation and reports negative spare', async () => {
    await addInsurance();
    await addCategory(CATEGORY, 'Bills', F1_NOTE);
    await setBalance(CATEGORY, 40000);

    expect(expectReady(await readRow())).toMatchObject({
      reserved: 60000,
      allowance: 0,
      spare: -20000,
      shortfall: 20000,
    });
  });

  it('F5 due now reserves the full target', async () => {
    await addInsurance('2026-09-15');
    await addCategory(CATEGORY, 'Bills', F1_NOTE);
    await setBalance(CATEGORY, 120000);

    const row = expectReady(await readRow());
    expect(row.claims).toEqual([
      expect.objectContaining({ nextDate: '2026-09-15', accrued: 120000 }),
    ]);
    expect(row.reserved).toBe(120000);
  });

  describe('Rent', () => {
    it('F6 due this month', async () => {
      await addRent();
      await addCategory(CATEGORY, 'Rent', '#template schedule Rent');
      await setBalance(CATEGORY, 150000);

      expect(expectReady(await readRow())).toMatchObject({
        balance: 150000,
        reserved: 150000,
        allowance: 0,
        spare: 0,
        claims: [
          expect.objectContaining({
            nextDate: '2026-09-05',
            target: 150000,
            accrued: 150000,
          }),
        ],
      });
    });

    it('F7 paid: the stored next date advances and the claim resets', async () => {
      const rentId = await addRent();
      await addCategory(CATEGORY, 'Rent', '#template schedule Rent');
      await setBalance(CATEGORY, 150000);

      await db.insertTransaction({
        account: 'account',
        category: CATEGORY,
        amount: -150000,
        date: '2026-09-05',
        schedule: rentId,
      });
      await setNextDate({ id: rentId, advance: true });

      expect(expectReady(await readRow())).toMatchObject({
        balance: 0,
        reserved: 0,
        allowance: 0,
        spare: 0,
        claims: [
          expect.objectContaining({ nextDate: '2026-10-05', accrued: 0 }),
        ],
      });
    });

    it('F8 skipped behaves like paid', async () => {
      const rentId = await addRent();
      await addCategory(CATEGORY, 'Rent', '#template schedule Rent');
      await setBalance(CATEGORY, 150000);

      await skipNextDate({ id: rentId });

      expect(expectReady(await readRow())).toMatchObject({
        balance: 150000,
        reserved: 0,
        spare: 150000,
        claims: [expect.objectContaining({ nextDate: '2026-10-05' })],
      });
    });

    it('F9 overdue reserves one occurrence', async () => {
      await addRent('2026-08-05');
      await addCategory(CATEGORY, 'Rent', '#template schedule Rent');
      await setBalance(CATEGORY, 150000);

      expect(expectReady(await readRow())).toMatchObject({
        reserved: 150000,
        claims: [
          expect.objectContaining({ nextDate: '2026-08-05', accrued: 150000 }),
        ],
      });
    });
  });

  it('F10 UI-source templates follow a schedule rename', async () => {
    const insuranceId = await addInsurance();
    await addCategory(CATEGORY, 'Bills');
    await storeUiTemplates(CATEGORY, [
      {
        type: 'schedule',
        name: 'Insurance',
        scheduleId: insuranceId,
        priority: 0,
        directive: 'template',
      },
      { type: 'simple', monthly: 500, priority: 0, directive: 'template' },
    ]);
    await setBalance(CATEGORY, 120000);

    await updateSchedule({
      schedule: { id: insuranceId, name: 'Car insurance' },
    });

    expect(await readRow()).toEqual(f1Row(insuranceId, 'Car insurance'));
  });

  it('F11 notes-source name reference is missing after a rename', async () => {
    const insuranceId = await addInsurance();
    await addCategory(CATEGORY, 'Bills', F1_NOTE);
    await setBalance(CATEGORY, 120000);

    await updateSchedule({
      schedule: { id: insuranceId, name: 'Car insurance' },
    });

    expect(await readRow()).toEqual({
      categoryId: CATEGORY,
      state: 'unavailable',
      reason: 'missing-schedule',
    });
  });

  it('F12 By target rolls over after its month', async () => {
    global.currentMonth = '2026-08';
    await addCategory(
      CATEGORY,
      'Gifts',
      '#template 600 by 2026-08 repeat every year',
    );
    await setBalance(CATEGORY, 60000, '2026-08');

    expect(expectReady(await readRow(CATEGORY, '2026-08')).claims).toEqual([
      {
        key: `${CATEGORY}:0`,
        kind: 'by',
        label: 'Gifts',
        nextDate: '2026-08-01',
        target: 60000,
        accrued: 60000,
      },
    ]);

    global.currentMonth = '2026-09';
    await createAllBudgets();
    expect(expectReady(await readRow()).claims).toEqual([
      expect.objectContaining({ nextDate: '2027-08-01', accrued: 5000 }),
    ]);
  });

  it('F13 By target crosses a year boundary', async () => {
    await addCategory(
      CATEGORY,
      'Holidays',
      '#template 1200 by 2027-01 repeat every year',
    );

    const accruedFor = async (month: string) => {
      global.currentMonth = month;
      await createAllBudgets();
      const row = expectReady(await readRow(CATEGORY, month));
      return [row.claims[0].accrued, row.claims[0].nextDate];
    };

    expect(await accruedFor('2026-12')).toEqual([110000, '2027-01-01']);
    expect(await accruedFor('2027-01')).toEqual([120000, '2027-01-01']);
    expect(await accruedFor('2027-02')).toEqual([10000, '2028-01-01']);
  });

  it('F17 note without directives is a ready zero-claim row', async () => {
    await addCategory(CATEGORY, 'Misc', 'Just a note');
    await setBalance(CATEGORY, 3000);

    expect(await readRow()).toEqual({
      categoryId: CATEGORY,
      state: 'ready',
      balance: 3000,
      reserved: 0,
      allowance: 0,
      allowanceTotal: 0,
      spare: 3000,
      shortfall: 0,
      claims: [],
    });
  });

  it('F18 ignores a stale goal_def on a notes-source category', async () => {
    await addCategory(CATEGORY, 'Misc', 'Just a note');
    await db.updateWithSchema('categories', {
      id: CATEGORY,
      goal_def: JSON.stringify([
        { type: 'simple', monthly: 500, priority: 0, directive: 'template' },
      ]),
      template_settings: { source: 'notes' },
    });
    await setBalance(CATEGORY, 3000);

    expect(expectReady(await readRow())).toMatchObject({
      allowanceTotal: 0,
      spare: 3000,
      claims: [],
    });
  });

  it('F19 UI-source definitions match the notes result', async () => {
    const insuranceId = await addInsurance();
    await addCategory(CATEGORY, 'Bills');
    await storeUiTemplates(CATEGORY, [
      {
        type: 'schedule',
        name: 'Insurance',
        scheduleId: insuranceId,
        priority: 0,
        directive: 'template',
      },
      { type: 'simple', monthly: 500, priority: 0, directive: 'template' },
    ]);
    await setBalance(CATEGORY, 120000);

    expect(await readRow()).toEqual(f1Row(insuranceId));
  });

  it('F20 an unsupported category does not fail the batch', async () => {
    const insuranceId = await addInsurance();
    await addCategory(CATEGORY, 'Bills', F1_NOTE);
    await addCategory('other', 'Other', '#template remainder');
    await setBalance(CATEGORY, 120000);

    const result = await readReservations();
    expect(result.categories).toEqual(
      expect.arrayContaining([
        f1Row(insuranceId),
        {
          categoryId: 'other',
          state: 'unavailable',
          reason: 'unsupported-template',
        },
      ]),
    );
    expect(result.categories.some(c => c.categoryId === 'income')).toBe(false);
  });

  describe('F21 duplicates', () => {
    it('(a) identical references count once', async () => {
      const insuranceId = await addInsurance();
      await addCategory(
        CATEGORY,
        'Bills',
        `#template schedule Insurance\n${F1_NOTE}`,
      );
      await setBalance(CATEGORY, 120000);

      expect(await readRow()).toEqual(f1Row(insuranceId));
    });

    it('(b) the same schedule with different modifiers', async () => {
      await addInsurance();
      await addCategory(
        CATEGORY,
        'Bills',
        '#template schedule Insurance\n#template schedule full Insurance',
      );
      await setBalance(CATEGORY, 120000);

      expect(await readRow()).toMatchObject({
        state: 'unavailable',
        reason: 'duplicate-schedule',
      });
    });

    it('(c) a name matching two live schedules', async () => {
      await addInsurance();
      const otherId = await addSchedule('Other insurance', -5000, {
        start: '2026-03-15',
        frequency: 'yearly',
      });
      db.runQuery('UPDATE schedules SET name = ? WHERE id = ?', [
        ' Insurance ',
        otherId,
      ]);
      await addCategory(CATEGORY, 'Bills', F1_NOTE);
      await setBalance(CATEGORY, 120000);

      expect(await readRow()).toMatchObject({
        state: 'unavailable',
        reason: 'ambiguous-schedule',
      });
    });
  });

  describe('unavailable reasons', () => {
    it.each([
      ['invalid-template', '#template broken template'],
      ['missing-schedule', '#template schedule Nope'],
      ['unsupported-template', '#template schedule full Insurance'],
      ['unsupported-template', '#template 100 by 2026-12 repeat every month'],
      ['unsupported-template', '#template 100 by 2026-12'],
      ['unsupported-template', '#template up to 100'],
      ['unsupported-template', '#goal 100'],
      ['missing-schedule', '#template schedule Nope\n#template remainder'],
    ])('reports %s for %j', async (reason, note) => {
      await addInsurance();
      await addCategory(CATEGORY, 'Bills', note);
      await setBalance(CATEGORY, 1000);

      expect(await readRow()).toEqual({
        categoryId: CATEGORY,
        state: 'unavailable',
        reason,
      });
    });

    it('reports a completed schedule as inactive', async () => {
      const insuranceId = await addInsurance();
      await updateSchedule({ schedule: { id: insuranceId, completed: true } });
      await addCategory(CATEGORY, 'Bills', F1_NOTE);
      await setBalance(CATEGORY, 1000);

      expect(await readRow()).toMatchObject({ reason: 'inactive-schedule' });
    });

    it('reports a weekly schedule as unsupported', async () => {
      await addSchedule('Groceries', -5000, {
        start: '2026-09-02',
        frequency: 'weekly',
      });
      await addCategory(CATEGORY, 'Food', '#template schedule Groceries');
      await setBalance(CATEGORY, 1000);

      expect(await readRow()).toMatchObject({ reason: 'unsupported-template' });
    });

    it('reports malformed UI-source definitions as invalid', async () => {
      await addCategory(CATEGORY, 'Bills');
      await db.updateWithSchema('categories', {
        id: CATEGORY,
        goal_def: '{not json',
        template_settings: { source: 'ui' },
      });
      await setBalance(CATEGORY, 1000);

      expect(await readRow()).toMatchObject({ reason: 'invalid-template' });
    });
  });

  describe('F22 rejected input', () => {
    it.each(['2026-13', '2026-08', 'nonsense'])(
      'rejects month %s',
      async month => {
        await addCategory(CATEGORY, 'Bills', F1_NOTE);
        await createAllBudgets();

        await expect(getReservations({ month })).rejects.toMatchObject({
          type: 'APIError',
        });
      },
    );

    it('rejects a tracking budget', async () => {
      await addCategory(CATEGORY, 'Bills', F1_NOTE);
      await createAllBudgets();
      await db.update('preferences', { id: 'budgetType', value: 'tracking' });

      await expect(getReservations({ month: '2026-09' })).rejects.toMatchObject(
        { type: 'APIError' },
      );
    });
  });
});
