jest.mock(
  '@scspace-depot/enums/organization.enum',
  () => ({
    OrganizationStatusEnum: {
      REJECTED: 0,
      REGISTER_REQUEST: 1,
      REGISTERED: 2,
      VERIFY_REQUEST: 3,
      VERIFIED: 4,
    },
  }),
  { virtual: true },
);

import {
  checkContainAllId,
  addLegacyTimeDays,
  getDateUnit,
  getDateDiffInMinute,
  getLegacyTimeAtEndOfDay,
  getNow,
  getWeekPeriod,
} from './utils';

function legacyTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return (((year * 12 + month) * 32 + day) * 24 + hour) * 60 + minute;
}

describe('time utilities', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the current instant in Asia/Seoul', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T16:00:00.000Z'));

    expect(getDateUnit(getNow())).toEqual({
      year: 2026,
      month: 8,
      day: 1,
      hour: 1,
      minute: 0,
    });
  });

  it('calculates wall-clock duration without using the host timezone', () => {
    expect(
      getDateDiffInMinute(
        legacyTime(2026, 8, 31, 23, 59),
        legacyTime(2026, 9, 1, 0, 1),
      ),
    ).toBe(2);
  });

  it('adds calendar days across month and leap-day boundaries', () => {
    expect(getDateUnit(addLegacyTimeDays(legacyTime(2028, 1, 28, 23, 30), 1))).toEqual({
      year: 2028,
      month: 1,
      day: 29,
      hour: 23,
      minute: 30,
    });
    expect(getDateUnit(addLegacyTimeDays(legacyTime(2028, 1, 29), 1))).toEqual({
      year: 2028,
      month: 2,
      day: 1,
      hour: 0,
      minute: 0,
    });
  });

  it('normalizes a legacy time to the business-day end', () => {
    expect(getDateUnit(getLegacyTimeAtEndOfDay(legacyTime(2026, 7, 31, 4, 12)))).toEqual({
      year: 2026,
      month: 7,
      day: 31,
      hour: 23,
      minute: 59,
    });
  });

  it('uses the same Monday week across a month boundary', () => {
    const expected = {
      weekStart: legacyTime(2026, 7, 31),
      weekEnd: legacyTime(2026, 8, 6, 23, 59),
    };

    expect(getWeekPeriod(legacyTime(2026, 7, 31, 12))).toEqual(expected);
    expect(getWeekPeriod(legacyTime(2026, 8, 1, 12))).toEqual(expected);
  });

  it('does not use the legacy day-32 padding at a month boundary', () => {
    expect(getWeekPeriod(legacyTime(2026, 7, 30, 12))).toEqual({
      weekStart: legacyTime(2026, 7, 24),
      weekEnd: legacyTime(2026, 7, 30, 23, 59),
    });
  });

  it('rejects when a related record is missing from a batch lookup', () => {
    expect(() => checkContainAllId([1, 2], [{ id: 1 }], 'users')).toThrow(
      'users',
    );
    expect(() => checkContainAllId([1, 1], [{ id: 1 }], 'users')).not.toThrow();
  });
});
