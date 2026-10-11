import { afterEach, expect, test } from 'vitest';
import { openDatabase, type DB } from './db.js';
import {
  FIVE_TIMES,
  THREE_TIMES,
  applyFromNowOn,
  applyTodayOnly,
  buildHome,
  getDay,
  seedDefaultSchedule,
  setCheck,
  switchMealCount,
} from './schedule.js';

let db: DB;

function setup(): DB {
  db = openDatabase(':memory:');
  db.prepare(`UPDATE settings SET timezone = 'UTC', started_on = '2026-10-01' WHERE id = 1`).run();
  seedDefaultSchedule(db, '2026-10-01');
  return db;
}

afterEach(() => {
  db.close();
});

function timesOf(date: string): string[] {
  return getDay(db, date).slots.map((slot) => slot.time);
}

test('today-only does not affect other days', () => {
  setup();
  const shifted = ['09:15', '13:00', '16:00', '19:00', '23:00'];
  applyTodayOnly(db, '2026-10-11', shifted);
  expect(timesOf('2026-10-11')).toEqual(shifted);
  expect(timesOf('2026-10-10')).toEqual([...FIVE_TIMES]);
  expect(timesOf('2026-10-12')).toEqual([...FIVE_TIMES]);
  expect(timesOf('2026-10-01')).toEqual([...FIVE_TIMES]);
  expect(() => applyTodayOnly(db, '2026-10-11', ['09:00'])).toThrow(/one time for each meal/i);
});

test('from-now-on does not change yesterday', () => {
  setup();
  const yesterdayTimes = ['09:05', '13:05', '16:05', '19:05', '23:05'];
  const replaced = ['09:10', '13:10', '16:10', '19:10', '23:10'];
  const ongoing = ['09:30', '13:30', '16:30', '19:30', '23:30'];
  applyTodayOnly(db, '2026-10-10', yesterdayTimes);
  applyTodayOnly(db, '2026-10-11', replaced);
  setCheck(db, '2026-10-11', 1, 'Wife', 'both', new Date('2026-10-11T13:10:00.000Z'));
  applyFromNowOn(db, '2026-10-11', ongoing);

  expect(timesOf('2026-10-09')).toEqual([...FIVE_TIMES]);
  expect(timesOf('2026-10-10')).toEqual(yesterdayTimes);
  expect(timesOf('2026-10-11')).toEqual(ongoing);
  expect(timesOf('2026-10-12')).toEqual(ongoing);

  const kept = getDay(db, '2026-10-11').slots[1];
  expect(kept?.time).toBe('13:30');
  expect(kept?.check?.role).toBe('Wife');
  expect(kept?.check?.comment).toBe('both');
});

test('a time edit keeps the check on that meal position', () => {
  setup();
  setCheck(db, '2026-10-11', 1, 'Husband', 'left a little', new Date('2026-10-11T13:02:00.000Z'));
  applyTodayOnly(db, '2026-10-11', ['09:00', '13:30', '16:00', '19:00', '23:00']);
  const day = getDay(db, '2026-10-11');
  expect(day.slots.map((slot) => slot.time)).toEqual(['09:00', '13:30', '16:00', '19:00', '23:00']);
  expect(day.slots[0]?.check).toBeNull();
  expect(day.slots[1]?.check).toMatchObject({ role: 'Husband', comment: 'left a little' });
  expect(day.slots[1]?.position).toBe(1);
});

test("switching to 3 meals does not remove an earlier day's 5 slots", () => {
  setup();
  setCheck(db, '2026-10-10', 4, 'Wife', '', new Date('2026-10-10T23:01:00.000Z'));
  switchMealCount(db, '2026-10-11', 3);

  const yesterday = getDay(db, '2026-10-10');
  expect(yesterday.mealCount).toBe(5);
  expect(yesterday.slots).toHaveLength(5);
  expect(yesterday.slots.map((slot) => slot.time)).toEqual([...FIVE_TIMES]);
  expect(yesterday.slots[4]?.check?.role).toBe('Wife');

  const today = getDay(db, '2026-10-11');
  expect(today.mealCount).toBe(3);
  expect(today.slots.map((slot) => slot.time)).toEqual([...THREE_TIMES]);
  expect(getDay(db, '2026-10-12').slots.map((slot) => slot.time)).toEqual([...THREE_TIMES]);
});

test('an already-checked extra slot stays visible if today is switched from 5 to 3', () => {
  setup();
  setCheck(db, '2026-10-11', 4, 'Husband', 'late snack', new Date('2026-10-11T23:05:00.000Z'));
  switchMealCount(db, '2026-10-11', 3);

  const today = getDay(db, '2026-10-11');
  expect(today.slots.map((slot) => slot.position)).toEqual([0, 1, 2, 4]);
  expect(today.slots.map((slot) => slot.time)).toEqual(['08:00', '14:00', '20:00', '23:00']);
  expect(today.slots.map((slot) => slot.extra)).toEqual([false, false, false, true]);
  expect(today.slots[3]?.check).toMatchObject({ role: 'Husband', comment: 'late snack' });
  expect(today.slots.some((slot) => slot.position === 3)).toBe(false);
  expect(getDay(db, '2026-10-10').slots).toHaveLength(5);
});

test("yesterday's unchecked meals are the only older rows on the home list", () => {
  setup();
  setCheck(db, '2026-10-09', 0, 'Husband', '', new Date('2026-10-09T09:01:00.000Z'));
  setCheck(db, '2026-10-10', 0, 'Wife', '', new Date('2026-10-10T09:02:00.000Z'));
  const home = buildHome(db, new Date('2026-10-11T00:30:00.000Z'));
  expect(home.today).toBe('2026-10-11');
  expect(home.yesterday?.date).toBe('2026-10-10');
  expect(home.yesterday?.slots.map((slot) => slot.position)).toEqual([1, 2, 3, 4]);
  expect(home.yesterday?.slots.every((slot) => !slot.check)).toBe(true);
  expect(home.todayDay.slots).toHaveLength(5);
});
