import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';
import { OrganizationStatusEnum } from '@scspace-depot/enums/organization.enum';

export const BUSINESS_TIME_ZONE = 'Asia/Seoul';

export function timeRangeCheck(timeFrom: number, timeTo: number): boolean {
  return timeFrom < timeTo;
}

export function takeOne<T>(name?: string): (array: T[]) => T {
  return (array: T[]) => {
    // 배열의 요소가 하나만 나왔는 지를 검증하는 함수
    if (array.length === 0)
      throw new NotFoundException(`${name ?? 'array'} is empty`);
    if (array.length > 1)
      throw new BadRequestException(`${name ?? 'array'} is not only one`);
    return array[0];
  };
}

export function takeUnique<
  T extends string | number | boolean | symbol | null | undefined | bigint,
>(array: T[]): T[] {
  // 중복을 제외하고 배열을 반환하는 함수
  // JS 기본 자료형에 대해 잘 작동할듯??
  return [...new Set(array)];
}

export function checkContainAllId<T extends { id: K }, K extends number>(
  ids: K[],
  array: T[],
  name?: string,
): asserts array is T[] & { [key in K]: T } {
  // 중복을 제외하고, 넣은 id가 모두 값이 잘 나왔는지를 체크해주는 함수
  const uniqueIds = takeUnique(ids);
  const returnedIds = new Set(array.map(({ id }) => id));
  if (uniqueIds.some((id) => !returnedIds.has(id))) {
    throw new NotFoundException(
      `The length of ${name ?? 'array'} does not match | id length: ${uniqueIds.length} || array length: ${array.length}`,
    );
  }
}

export function takeAll<T extends { id: K }, K extends number>(
  ids: K[],
  name?: string,
): (array: T[]) => T[] {
  // 중복을 제외하고, 넣은 id가 모두 값이 잘 나왔는지를 체크해서 값을 얻는 함수
  return (array: T[]) => {
    checkContainAllId(ids, array, name);
    return array;
  };
}

export function takeExist<T>(name?: string): (array: T[]) => T[] {
  return (array: T[]) => {
    if (array.length === 0)
      throw new NotFoundException(`${name ?? 'array'} is empty`);
    return array;
  };
}

export function getNow() {
  const now = Temporal.Now.zonedDateTimeISO(BUSINESS_TIME_ZONE);
  return getLegacyTimeFromUnits(
    now.year,
    now.month - 1,
    now.day,
    now.hour,
    now.minute,
  );
}

export function getTime(date: Date) {
  const dateTime = Temporal.PlainDateTime.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  });
  return getLegacyTimeFromPlainDateTime(dateTime);
}

export function getDateUnit(time: number) {
  const minute = time % 60;
  time = Math.floor(time / 60);
  const hour = time % 24;
  time = Math.floor(time / 24);
  const day = time % 32;
  time = Math.floor(time / 32);
  const month = time % 12;
  const year = Math.floor(time / 12);

  return { year, month, day, hour, minute };
}

export function getLegacyTimeFromUnits(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return (((year * 12 + month) * 32 + day) * 24 + hour) * 60 + minute;
}

export function getPlainDateTime(time: number): Temporal.PlainDateTime {
  const { year, month, day, hour, minute } = getDateUnit(time);
  return Temporal.PlainDateTime.from({
    year,
    month: month + 1,
    day,
    hour,
    minute,
  });
}

export function addLegacyTimeDays(time: number, days: number): number {
  return getLegacyTimeFromPlainDateTime(getPlainDateTime(time).add({ days }));
}

export function getLegacyTimeAtEndOfDay(time: number): number {
  return getLegacyTimeFromPlainDateTime(
    getPlainDateTime(time).with({ hour: 23, minute: 59 }),
  );
}

function getLegacyTimeFromPlainDateTime(
  dateTime: Temporal.PlainDateTime,
): number {
  return getLegacyTimeFromUnits(
    dateTime.year,
    dateTime.month - 1,
    dateTime.day,
    dateTime.hour,
    dateTime.minute,
  );
}

export function getDate(time: number): Date {
  const dateTime = getPlainDateTime(time);
  return new Date(
    dateTime.year,
    dateTime.month - 1,
    dateTime.day,
    dateTime.hour,
    dateTime.minute,
  );
}

export function getDateString(time: number) {
  const { year, month, day } = getDateUnit(time);
  return `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export function getString(time: number) {
  const dateString = getDateString(time);
  const { hour, minute } = getDateUnit(time);
  return `${dateString} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

export function getDateDiffInMinute(timeBefore: number, timeAfter: number) {
  const dateBefore = getPlainDateTime(timeBefore);
  const dateAfter = getPlainDateTime(timeAfter);
  return dateBefore.until(dateAfter, { largestUnit: 'minutes' }).minutes;
}

export function getOrganizationStatusString(status: OrganizationStatusEnum): {
  kr: string;
  en: string;
} {
  switch (status) {
    case OrganizationStatusEnum.REJECTED:
      return {
        kr: '반려',
        en: 'Rejected',
      };
    case OrganizationStatusEnum.REGISTER_REQUEST:
      return {
        kr: '등록 대기',
        en: 'Registration Pending',
      };
    case OrganizationStatusEnum.REGISTERED:
      return {
        kr: '등록',
        en: 'Registered',
      };
    case OrganizationStatusEnum.VERIFY_REQUEST:
      return {
        kr: '인증 대기',
        en: 'Verification Pending',
      };
    case OrganizationStatusEnum.VERIFIED:
      return {
        kr: '인증',
        en: 'Verified',
      };
  }
}

export function getDateBegin(time: number): number {
  return time - (time % (24 * 60));
}

export function getDateEnd(time: number): number {
  return time - (time % (24 * 60)) + 24 * 60 - 1;
}

export function getWeekPeriod(time: number): {
  weekStart: number;
  weekEnd: number;
} {
  const date = getPlainDateTime(time).toPlainDate();
  const monday = date.subtract({ days: date.dayOfWeek - 1 });
  const sunday = monday.add({ days: 6 });
  const weekStart = getLegacyTimeFromUnits(
    monday.year,
    monday.month - 1,
    monday.day,
    0,
    0,
  );
  const weekEnd = getLegacyTimeFromUnits(
    sunday.year,
    sunday.month - 1,
    sunday.day,
    23,
    59,
  );
  return { weekStart, weekEnd };
}

export function getRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}
