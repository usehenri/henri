const { next, parse } = require('../src/cron');
const { duration, runAt } = require('../src/duration');

const utc = (text) => new Date(text).getTime();
const iso = (time) => new Date(time).toISOString();

describe('cron', () => {
  test.each([
    ['* * * * *', '2026-03-01T10:00:30Z', '2026-03-01T10:01:00.000Z'],
    ['*/15 * * * *', '2026-03-01T10:02:00Z', '2026-03-01T10:15:00.000Z'],
    ['0 * * * *', '2026-03-01T10:02:00Z', '2026-03-01T11:00:00.000Z'],
    ['0 3 * * *', '2026-03-01T10:02:00Z', '2026-03-02T03:00:00.000Z'],
    ['30 2 1 * *', '2026-03-01T10:02:00Z', '2026-04-01T02:30:00.000Z'],
    ['0 0 * * 0', '2026-03-04T10:02:00Z', '2026-03-08T00:00:00.000Z'],
    ['0 0 * * sun', '2026-03-04T10:02:00Z', '2026-03-08T00:00:00.000Z'],
    ['0 0 29 2 *', '2026-03-01T00:00:00Z', '2028-02-29T00:00:00.000Z'],
    ['15,45 * * * *', '2026-03-01T10:20:00Z', '2026-03-01T10:45:00.000Z'],
    ['0 9-17 * * mon-fri', '2026-03-07T12:00:00Z', '2026-03-09T09:00:00.000Z'],
  ])('%s from %s', (expression, from, expected) => {
    expect(iso(next(expression, utc(from)))).toBe(expected);
  });

  test.each([
    ['@hourly', '2026-03-01T10:02:00Z', '2026-03-01T11:00:00.000Z'],
    ['@daily', '2026-03-01T10:02:00Z', '2026-03-02T00:00:00.000Z'],
    ['@weekly', '2026-03-04T10:02:00Z', '2026-03-08T00:00:00.000Z'],
    ['@monthly', '2026-03-04T10:02:00Z', '2026-04-01T00:00:00.000Z'],
    ['@yearly', '2026-03-04T10:02:00Z', '2027-01-01T00:00:00.000Z'],
  ])('%s from %s', (expression, from, expected) => {
    expect(iso(next(expression, utc(from)))).toBe(expected);
  });

  test('runs on the day of the month or the weekday when both are set', () => {
    // The 1st, and every Monday
    const schedule = parse('0 0 1 * mon');

    expect(iso(next(schedule, utc('2026-03-27T12:00:00Z')))).toBe(
      '2026-03-30T00:00:00.000Z'
    );
    expect(iso(next(schedule, utc('2026-03-30T12:00:00Z')))).toBe(
      '2026-04-01T00:00:00.000Z'
    );
  });

  test('never returns the moment it was given', () => {
    const from = utc('2026-03-01T10:00:00Z');

    expect(next('* * * * *', from)).toBeGreaterThan(from);
  });

  test('reads 0 and 7 as Sunday', () => {
    expect(next('0 0 * * 7', utc('2026-03-04T00:00:00Z'))).toBe(
      next('0 0 * * 0', utc('2026-03-04T00:00:00Z'))
    );
  });

  test.each([
    ['* * * *', 'expected 5 fields'],
    ['61 * * * *', 'Out of range'],
    ['* 25 * * *', 'Out of range'],
    ['* * * * xyz', 'Invalid weekday'],
    ['*/0 * * * *', 'Invalid step'],
  ])('refuses %s', (expression, message) => {
    expect(() => parse(expression)).toThrow(message);
  });
});

describe('duration', () => {
  test.each([
    ['500ms', 500],
    ['30s', 30000],
    ['5m', 300000],
    ['2h', 7200000],
    ['1d', 86400000],
    ['1w', 604800000],
    [1500, 1500],
  ])('%s is %d ms', (value, expected) => {
    expect(duration(value)).toBe(expected);
  });

  test('answers the fallback for nothing', () => {
    expect(duration(null, 42)).toBe(42);
    expect(duration(undefined, 42)).toBe(42);
    expect(duration('', 42)).toBe(42);
    expect(duration(null)).toBeNull();
  });

  test('refuses what is not a duration', () => {
    expect(() => duration('soon')).toThrow('Invalid duration');
    expect(() => duration(-1)).toThrow('Invalid duration');
  });

  test('computes when a job should run', () => {
    const now = utc('2026-03-01T10:00:00Z');

    expect(runAt({}, now)).toBe(now);
    expect(runAt({ wait: '5m' }, now)).toBe(now + 300000);
    expect(runAt({ at: '2026-03-02T00:00:00Z' }, now)).toBe(
      utc('2026-03-02T00:00:00Z')
    );
    expect(runAt({ at: new Date(now + 1000) }, now)).toBe(now + 1000);
  });

  test('refuses a date it cannot read', () => {
    expect(() => runAt({ at: 'tomorrow' })).toThrow('Invalid date');
  });
});
