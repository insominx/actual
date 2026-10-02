// P01–P04: pinned fork period math (vendored verbatim, see source-manifest.json)
// against oracles fixed in this file before its first run. Expected values are
// either literal dates or computed by the independent UTC lattice below — never
// by the function under test.
//
// Run from repo root:
//   node --test ".workflow/tasks/0005-pay-period-compatibility/probes/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const vendorUrl = new URL('./vendor/pay-periods.ts', import.meta.url);
const pp = await import(vendorUrl.href);

const weekly = { payFrequency: 'weekly', startDate: '2026-01-02' };
const biweekly = { payFrequency: 'biweekly', startDate: '2026-01-02' };

// Independent oracle: whole UTC days, no local time, no date-fns.
function dayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
function fromNum(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
function addDays(s, n) {
  return fromNum(dayNum(s) + n);
}
function latticeStart(day, anchor, cycle) {
  const k = Math.floor((dayNum(day) - dayNum(anchor)) / cycle);
  return fromNum(dayNum(anchor) + k * cycle);
}
function eachDay(from, to) {
  const days = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) days.push(fromNum(n));
  return days;
}

// Production convention (months.ts `_parse`): local noon.
function localDate(s, hour = 12) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, hour);
}
function periodOf(day, config) {
  const id = pp.getPayPeriodForDate(localDate(day), config);
  return { id, ...pp.getPayPeriodBounds(id, config) };
}

test('P01 weekly anchor 2026-01-02 over 2025-12-20..2026-02-10', () => {
  assert.deepEqual(periodOf('2026-01-02', weekly), {
    id: '2026-13',
    startDate: '2026-01-02',
    endDate: '2026-01-08',
  });
  assert.deepEqual(periodOf('2025-12-31', weekly), {
    id: '2025-64',
    startDate: '2025-12-26',
    endDate: '2026-01-01',
  });

  const seen = [];
  for (const day of eachDay('2025-12-20', '2026-02-10')) {
    const p = periodOf(day, weekly);
    const expectedStart = latticeStart(day, weekly.startDate, 7);
    assert.equal(p.startDate, expectedStart, `start for ${day}`);
    assert.equal(p.endDate, addDays(expectedStart, 6), `end for ${day}`);
    assert.ok(p.startDate <= day && day <= p.endDate, `${day} inside ${p.id}`);
    if (seen.at(-1)?.id !== p.id) seen.push(p);
  }
  assert.deepEqual(
    seen.map(p => p.id),
    [
      '2025-63',
      '2025-64',
      '2026-13',
      '2026-14',
      '2026-15',
      '2026-16',
      '2026-17',
      '2026-18',
    ],
  );
  for (let i = 1; i < seen.length; i++) {
    assert.equal(seen[i].startDate, addDays(seen[i - 1].endDate, 1));
  }
  assert.equal(pp.generatePayPeriods(2025, weekly).length, 52);
  assert.equal(pp.generatePayPeriods(2026, weekly).length, 52);
});

test('P02 biweekly anchor 2026-01-02 through 2026-12-31', () => {
  const periods = pp.generatePayPeriods(2026, biweekly);
  const expectedStarts = [
    '2026-01-02',
    '2026-01-16',
    '2026-01-30',
    '2026-02-13',
    '2026-02-27',
    '2026-03-13',
    '2026-03-27',
    '2026-04-10',
    '2026-04-24',
    '2026-05-08',
    '2026-05-22',
    '2026-06-05',
    '2026-06-19',
    '2026-07-03',
    '2026-07-17',
    '2026-07-31',
    '2026-08-14',
    '2026-08-28',
    '2026-09-11',
    '2026-09-25',
    '2026-10-09',
    '2026-10-23',
    '2026-11-06',
    '2026-11-20',
    '2026-12-04',
    '2026-12-18',
  ];
  assert.deepEqual(
    periods.map(p => p.startDate),
    expectedStarts,
  );
  assert.deepEqual(
    periods.map(p => p.monthId),
    expectedStarts.map((_, i) => `2026-${String(13 + i)}`),
  );
  for (let i = 0; i < periods.length; i++) {
    assert.equal(periods[i].endDate, addDays(expectedStarts[i], 13));
  }
  assert.equal(periods.at(-1).endDate, '2026-12-31');

  const startsPerMonth = new Map();
  for (const p of periods) {
    const month = p.startDate.slice(0, 7);
    startsPerMonth.set(month, (startsPerMonth.get(month) ?? 0) + 1);
  }
  const threePaycheckMonths = [...startsPerMonth]
    .filter(([, n]) => n >= 3)
    .map(([m]) => m);
  assert.deepEqual(threePaycheckMonths, ['2026-01', '2026-07']);
});

test('P03 monthly anchor Jan 31 clamps February in 2027 and 2028', () => {
  const monthly2027 = { payFrequency: 'monthly', startDate: '2027-01-31' };
  const monthly2028 = { payFrequency: 'monthly', startDate: '2028-01-31' };
  const starts2027 = [
    '2027-01-31',
    '2027-02-28',
    '2027-03-31',
    '2027-04-30',
    '2027-05-31',
    '2027-06-30',
    '2027-07-31',
    '2027-08-31',
    '2027-09-30',
    '2027-10-31',
    '2027-11-30',
    '2027-12-31',
  ];
  const starts2028 = [
    '2028-01-31',
    '2028-02-29',
    '2028-03-31',
    '2028-04-30',
    '2028-05-31',
    '2028-06-30',
    '2028-07-31',
    '2028-08-31',
    '2028-09-30',
    '2028-10-31',
    '2028-11-30',
    '2028-12-31',
  ];
  assert.deepEqual(
    pp.generatePayPeriods(2027, monthly2027).map(p => p.startDate),
    starts2027,
  );
  assert.deepEqual(
    pp.generatePayPeriods(2028, monthly2027).map(p => p.startDate),
    starts2028,
  );
  assert.deepEqual(
    pp.generatePayPeriods(2028, monthly2028).map(p => p.startDate),
    starts2028,
  );
  assert.deepEqual(pp.getPayPeriodBounds('2027-14', monthly2027), {
    startDate: '2027-02-28',
    endDate: '2027-03-30',
  });
  assert.deepEqual(pp.getPayPeriodBounds('2028-14', monthly2027), {
    startDate: '2028-02-29',
    endDate: '2028-03-30',
  });
  // Jan 1–30 2027 belong to the last 2026 period (Dec 31 2026 – Jan 30 2027).
  assert.deepEqual(periodOf('2027-01-15', monthly2027), {
    id: '2026-24',
    startDate: '2026-12-31',
    endDate: '2027-01-30',
  });
});

const childSource = `
const pp = await import(${JSON.stringify(vendorUrl.href)});
const configs = {
  weekly: { payFrequency: 'weekly', startDate: '2026-01-02' },
  biweekly: { payFrequency: 'biweekly', startDate: '2026-01-02' },
};
const windows = [['2026-03-01', '2026-03-15'], ['2026-10-25', '2026-11-08']];
const map = {};
for (const [name, config] of Object.entries(configs)) {
  for (const [from, to] of windows) {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    for (let n = Date.UTC(fy, fm - 1, fd); n <= Date.UTC(ty, tm - 1, td); n += 86400000) {
      const day = new Date(n).toISOString().slice(0, 10);
      const [y, m, d] = day.split('-').map(Number);
      for (const hour of [0, 12]) {
        const id = pp.getPayPeriodForDate(new Date(y, m - 1, d, hour), config);
        map[name + '|' + day + '|h' + hour] = pp.getPayPeriodBounds(id, config).startDate;
      }
    }
  }
}
const offsets = ['2026-03-01', '2026-03-15', '2026-10-25', '2026-11-08'].map(s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTimezoneOffset();
});
process.stdout.write(JSON.stringify({ tz: process.env.TZ, offsets, map }));
`;

function runChild(tz) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', childSource],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `child TZ=${tz} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('P04 DST windows: identical period starts under TZ=UTC and America/Los_Angeles', () => {
  const parentTzBefore = process.env.TZ;
  const utc = runChild('UTC');
  const la = runChild('America/Los_Angeles');
  assert.equal(process.env.TZ, parentTzBefore, 'parent TZ must be unchanged');

  // The TZ override must actually take effect in each child.
  assert.deepEqual(utc.offsets, [0, 0, 0, 0]);
  assert.deepEqual(la.offsets, [480, 420, 420, 480]);

  const expected = {};
  for (const [name, cycle] of [
    ['weekly', 7],
    ['biweekly', 14],
  ]) {
    for (const [from, to] of [
      ['2026-03-01', '2026-03-15'],
      ['2026-10-25', '2026-11-08'],
    ]) {
      for (const day of eachDay(from, to)) {
        for (const hour of [0, 12]) {
          expected[`${name}|${day}|h${hour}`] = latticeStart(
            day,
            '2026-01-02',
            cycle,
          );
        }
      }
    }
  }
  assert.deepEqual(utc.map, expected);
  assert.deepEqual(la.map, expected);
  assert.deepEqual(la.map, utc.map);
});

// Not a completion gate: pins the date ranges quoted by the P05, P06 and P09
// ledgers so those source-backed records do not rely on hand arithmetic.
test('fixture ranges for P05/P06/P09 ledgers', () => {
  const monthly = { payFrequency: 'monthly', startDate: '2026-01-02' };
  assert.deepEqual(pp.getPayPeriodBounds('2026-13', weekly), {
    startDate: '2026-01-02',
    endDate: '2026-01-08',
  });
  assert.deepEqual(pp.getPayPeriodBounds('2026-14', weekly), {
    startDate: '2026-01-09',
    endDate: '2026-01-15',
  });
  assert.deepEqual(pp.getPayPeriodBounds('2026-64', weekly), {
    startDate: '2026-12-25',
    endDate: '2026-12-31',
  });
  assert.deepEqual(pp.getPayPeriodBounds('2026-13', monthly), {
    startDate: '2026-01-02',
    endDate: '2026-02-01',
  });
  assert.deepEqual(pp.getPayPeriodBounds('2026-14', monthly), {
    startDate: '2026-02-02',
    endDate: '2026-03-01',
  });
  assert.equal(pp.generatePayPeriods(2026, monthly).length, 12);
  assert.throws(
    () => pp.getPayPeriodBounds('2026-64', monthly),
    /does not exist for the monthly cadence/,
  );
  assert.equal(pp.isPayPeriod('2026-13'), true);
  assert.equal(pp.isPayPeriod('2026-12'), false);
});
