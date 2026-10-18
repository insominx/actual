import * as monthUtils from './months';

test('range returns a full range', () => {
  expect(monthUtils.range('2016-10', '2018-01')).toMatchSnapshot();
});

test('getQuarter returns the quarter number for a given month', () => {
  expect(monthUtils.getQuarter('2024-01')).toBe(1);
  expect(monthUtils.getQuarter('2024-03')).toBe(1);
  expect(monthUtils.getQuarter('2024-04')).toBe(2);
  expect(monthUtils.getQuarter('2024-06')).toBe(2);
  expect(monthUtils.getQuarter('2024-07')).toBe(3);
  expect(monthUtils.getQuarter('2024-09')).toBe(3);
  expect(monthUtils.getQuarter('2024-10')).toBe(4);
  expect(monthUtils.getQuarter('2024-12')).toBe(4);
});

test('getQuarterStart and getQuarterEnd return the bounding months of the quarter', () => {
  expect(monthUtils.getQuarterStart('2024-02')).toBe('2024-01');
  expect(monthUtils.getQuarterEnd('2024-02')).toBe('2024-03');
  expect(monthUtils.getQuarterStart('2024-11')).toBe('2024-10');
  expect(monthUtils.getQuarterEnd('2024-11')).toBe('2024-12');
});

test('prevQuarter subtracts three months, landing in the previous quarter', () => {
  expect(monthUtils.prevQuarter('2024-02')).toBe('2023-11');
  expect(monthUtils.prevQuarter('2024-01')).toBe('2023-10');
  expect(monthUtils.prevQuarter('2024-04')).toBe('2024-01');
});

test('a date-only UTC midnight keeps that calendar day', () => {
  expect(monthUtils.dayFromDate(new Date('2030-12-31'))).toBe('2030-12-31');
  expect(monthUtils.monthFromDate(new Date('2030-12-31'))).toBe('2030-12');
  expect(monthUtils.dayFromDate(new Date(2030, 11, 31))).toBe('2030-12-31');
});

test('month and week bounds stay on the calendar day', () => {
  expect(monthUtils.firstDayOfMonth('2017-01-31')).toBe('2017-01-01');
  expect(monthUtils.firstDayOfMonth('2017-01')).toBe('2017-01-01');
  expect(monthUtils.lastDayOfMonth('2017-02')).toBe('2017-02-28');
  expect(monthUtils.lastDayOfMonth('2024-02-15')).toBe('2024-02-29');
  expect(monthUtils.bounds('2017-01')).toEqual({
    start: 20170101,
    end: 20170131,
  });
  // 2017-01-01 is a Sunday. A Monday-start week begins the previous Monday.
  expect(monthUtils.weekFromDate('2017-01-01', '0')).toBe('2017-01-01');
  expect(monthUtils.weekFromDate('2017-01-01', '1')).toBe('2016-12-26');
  expect(monthUtils.weekFromDate('2017-01-04', '0')).toBe('2017-01-01');
  expect(monthUtils.getWeekEnd('2017-01-04', '0')).toBe('2017-01-07');
  expect(monthUtils.getWeekEnd('2017-01-01', '1')).toBe('2017-01-01');
});

test('isValidYearMonthDay validates the day against the month and year', () => {
  expect(monthUtils.isValidYearMonthDay('2024-02-29')).toBe(true);
  expect(monthUtils.isValidYearMonthDay('2023-02-29')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-04-31')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-12-31')).toBe(true);
  expect(monthUtils.isValidYearMonthDay('2024-00-10')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-13-10')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-02-00')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-02')).toBe(false);
});
