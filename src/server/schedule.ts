import type { DB } from './db.js';
import { AppError } from './errors.js';
import { addDays, isIsoDate, isValidTimeZone, todayInZone } from './time.js';
import type { Role } from './types.js';

export const FIVE_TIMES = ['09:00', '13:00', '16:00', '19:00', '23:00'] as const;
export const THREE_TIMES = ['08:00', '14:00', '20:00'] as const;

export type MealCount = 3 | 5;

export type Settings = { timezone: string | null; startedOn: string | null };

export type Check = {
  role: Role;
  checkedAt: string;
  comment: string;
  preservedTime: string | null;
};

export type DaySlot = {
  position: number;
  time: string;
  extra: boolean;
  check: Check | null;
};

export type DayView = {
  date: string;
  mealCount: MealCount;
  slots: DaySlot[];
};

type Template = {
  id: number;
  effectiveDate: string;
  mealCount: MealCount;
  times: string[];
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function getSettings(db: DB): Settings {
  const row = db.prepare(`SELECT timezone, started_on FROM settings WHERE id = 1`).get() as {
    timezone: string | null;
    started_on: string | null;
  };
  return { timezone: row.timezone, startedOn: row.started_on };
}

export function normalizeTime(value: unknown): string {
  if (typeof value !== 'string' || !TIME_RE.test(value.trim())) {
    throw new AppError('Use a time like 13:30.');
  }
  return value.trim().slice(0, 5);
}

export function normalizeTimes(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new AppError('Enter a time for each meal.');
  }
  return values.map(normalizeTime);
}

export function cleanComment(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new AppError('The note should be short text.');
  const trimmed = value.trim();
  if (trimmed.length > 140) throw new AppError('Keep the note under 140 characters.');
  return trimmed;
}

export function seedDefaultSchedule(db: DB, effectiveDate: string): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM templates`).get() as { n: number };
  if (count.n > 0) return;
  db.prepare(
    `INSERT INTO templates (effective_date, meal_count, times_json, created_at) VALUES (?, 5, ?, ?)`,
  ).run(effectiveDate, JSON.stringify([...FIVE_TIMES]), new Date().toISOString());
}

export function setTimezone(db: DB, timezone: string): void {
  if (!isValidTimeZone(timezone)) throw new AppError('Unknown timezone.');
  const tx = db.transaction(() => {
    const current = getSettings(db);
    if (!current.timezone || !current.startedOn) {
      const today = todayInZone(timezone);
      const startedOn = current.startedOn ?? today;
      db.prepare(`UPDATE settings SET timezone = ?, started_on = ? WHERE id = 1`).run(timezone, startedOn);
      seedDefaultSchedule(db, startedOn);
    } else {
      db.prepare(`UPDATE settings SET timezone = ? WHERE id = 1`).run(timezone);
    }
  });
  tx();
}

function requireReady(db: DB): { timezone: string; startedOn: string } {
  const settings = getSettings(db);
  if (!settings.timezone || !settings.startedOn) {
    throw new AppError('Set a timezone first.', 409);
  }
  return { timezone: settings.timezone, startedOn: settings.startedOn };
}

export function assertDateInLog(db: DB, date: string, now = new Date()): void {
  if (!isIsoDate(date)) throw new AppError('Choose a real date.');
  const { timezone, startedOn } = requireReady(db);
  const today = todayInZone(timezone, now);
  if (date < startedOn || date > today) throw new AppError("That day isn't in the log.");
}

function parseTimes(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new AppError('The saved schedule is unreadable.', 500);
  }
  return parsed;
}

function applicableTemplate(db: DB, date: string): Template | null {
  const row = db
    .prepare(
      `SELECT id, effective_date, meal_count, times_json
       FROM templates
       WHERE effective_date <= ?
       ORDER BY effective_date DESC
       LIMIT 1`,
    )
    .get(date) as
    | { id: number; effective_date: string; meal_count: number; times_json: string }
    | undefined;
  if (!row || (row.meal_count !== 3 && row.meal_count !== 5)) return null;
  return {
    id: row.id,
    effectiveDate: row.effective_date,
    mealCount: row.meal_count,
    times: parseTimes(row.times_json),
  };
}

function requiredTemplate(db: DB, date: string): Template {
  const template = applicableTemplate(db, date);
  if (!template) throw new AppError('No feeding schedule for that day.');
  return template;
}

function checksForDate(db: DB, date: string): Map<number, Check> {
  const rows = db
    .prepare(
      `SELECT position, role, checked_at, comment, preserved_time
       FROM checks WHERE date = ? ORDER BY position`,
    )
    .all(date) as {
    position: number;
    role: Role;
    checked_at: string;
    comment: string;
    preserved_time: string | null;
  }[];
  const map = new Map<number, Check>();
  for (const row of rows) {
    map.set(row.position, {
      role: row.role,
      checkedAt: row.checked_at,
      comment: row.comment,
      preservedTime: row.preserved_time,
    });
  }
  return map;
}

function overrideTimes(db: DB, date: string): string[] | null {
  const row = db.prepare(`SELECT times_json FROM day_overrides WHERE date = ?`).get(date) as
    | { times_json: string }
    | undefined;
  return row ? parseTimes(row.times_json) : null;
}

function previousTime(db: DB, template: Template, position: number, fallback: string): string {
  const row = db
    .prepare(
      `SELECT times_json FROM templates
       WHERE effective_date < ?
       ORDER BY effective_date DESC
       LIMIT 1`,
    )
    .get(template.effectiveDate) as { times_json: string } | undefined;
  if (!row) return fallback;
  const times = parseTimes(row.times_json);
  return times[position] ?? fallback;
}

export function getDay(db: DB, date: string): DayView {
  const template = requiredTemplate(db, date);
  const override = overrideTimes(db, date);
  const times = override && override.length === template.mealCount ? override : template.times;
  const checks = checksForDate(db, date);
  const slots: DaySlot[] = times.map((time, position) => ({
    position,
    time,
    extra: false,
    check: checks.get(position) ?? null,
  }));
  const maxPosition = Math.max(-1, ...checks.keys());
  for (let position = times.length; position <= maxPosition; position += 1) {
    const check = checks.get(position);
    if (!check) continue;
    const fallback = times[times.length - 1] ?? '00:00';
    slots.push({
      position,
      time: check.preservedTime ?? previousTime(db, template, position, fallback),
      extra: true,
      check,
    });
  }
  return { date, mealCount: template.mealCount, slots };
}

export function editableTimes(db: DB, date: string): { mealCount: MealCount; times: string[] } {
  const day = getDay(db, date);
  return {
    mealCount: day.mealCount,
    times: day.slots.filter((slot) => !slot.extra).map((slot) => slot.time),
  };
}

function assertTimesMatch(db: DB, date: string, times: string[]): string[] {
  const normalized = normalizeTimes(times);
  const template = requiredTemplate(db, date);
  if (normalized.length !== template.mealCount) throw new AppError('Enter one time for each meal.');
  return normalized;
}

export function applyTodayOnly(db: DB, date: string, times: string[]): void {
  if (!isIsoDate(date)) throw new AppError('Choose a real date.');
  const tx = db.transaction(() => {
    const normalized = assertTimesMatch(db, date, times);
    db.prepare(
      `INSERT INTO day_overrides (date, times_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET times_json = excluded.times_json`,
    ).run(date, JSON.stringify(normalized), new Date().toISOString());
  });
  tx();
}

export function applyFromNowOn(db: DB, date: string, times: string[]): void {
  if (!isIsoDate(date)) throw new AppError('Choose a real date.');
  const tx = db.transaction(() => {
    const normalized = assertTimesMatch(db, date, times);
    const template = requiredTemplate(db, date);
    const now = new Date().toISOString();
    if (template.effectiveDate === date) {
      db.prepare(`UPDATE templates SET times_json = ? WHERE id = ?`).run(JSON.stringify(normalized), template.id);
    } else {
      db.prepare(
        `INSERT INTO templates (effective_date, meal_count, times_json, created_at) VALUES (?, ?, ?, ?)`,
      ).run(date, template.mealCount, JSON.stringify(normalized), now);
    }
    db.prepare(`DELETE FROM day_overrides WHERE date = ?`).run(date);
  });
  tx();
}

function preserveExtraChecks(db: DB, effectiveDate: string, newCount: number): void {
  const rows = db
    .prepare(`SELECT date, position FROM checks WHERE date >= ? AND position >= ?`)
    .all(effectiveDate, newCount) as { date: string; position: number }[];
  const update = db.prepare(`UPDATE checks SET preserved_time = ? WHERE date = ? AND position = ?`);
  const seen = new Map<string, DayView>();
  for (const row of rows) {
    if (!applicableTemplate(db, row.date)) continue;
    let day = seen.get(row.date);
    if (!day) {
      day = getDay(db, row.date);
      seen.set(row.date, day);
    }
    const slot = day.slots.find((item) => item.position === row.position);
    if (!slot) continue;
    update.run(slot.time, row.date, row.position);
  }
}

export function switchMealCount(db: DB, effectiveDate: string, mealCount: MealCount): void {
  if (!isIsoDate(effectiveDate)) throw new AppError('Choose a real date.');
  if (mealCount !== 3 && mealCount !== 5) throw new AppError('Choose 3 or 5 meals.');
  const tx = db.transaction(() => {
    const settings = getSettings(db);
    if (settings.startedOn && effectiveDate < settings.startedOn) {
      throw new AppError('That date is before the log starts.');
    }
    const applicable = applicableTemplate(db, effectiveDate);
    if (applicable && applicable.mealCount === mealCount) {
      throw new AppError(mealCount === 5 ? 'Already using 5 meals.' : 'Already using 3 meals.');
    }
    // A check sticks to the meal position. If today shrinks from 5 meals to 3,
    // a later position that was already checked stays on the day with the time it had.
    preserveExtraChecks(db, effectiveDate, mealCount);
    const times = mealCount === 3 ? [...THREE_TIMES] : [...FIVE_TIMES];
    const now = new Date().toISOString();
    const existing = db.prepare(`SELECT id FROM templates WHERE effective_date = ?`).get(effectiveDate) as
      | { id: number }
      | undefined;
    if (existing) {
      db.prepare(`UPDATE templates SET meal_count = ?, times_json = ? WHERE id = ?`).run(
        mealCount,
        JSON.stringify(times),
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO templates (effective_date, meal_count, times_json, created_at) VALUES (?, ?, ?, ?)`,
      ).run(effectiveDate, mealCount, JSON.stringify(times), now);
    }
    db.prepare(`DELETE FROM templates WHERE effective_date > ?`).run(effectiveDate);
    db.prepare(`DELETE FROM day_overrides WHERE date >= ?`).run(effectiveDate);
  });
  tx();
}

export function setCheck(
  db: DB,
  date: string,
  position: number,
  role: Role,
  comment: unknown,
  now = new Date(),
): void {
  const note = cleanComment(comment);
  const tx = db.transaction(() => {
    const day = getDay(db, date);
    const slot = day.slots.find((item) => item.position === position);
    if (!slot) throw new AppError("That meal isn't on this day.");
    db.prepare(
      `INSERT INTO checks (date, position, role, checked_at, comment, preserved_time)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, position) DO UPDATE SET
         role = excluded.role,
         checked_at = excluded.checked_at,
         comment = excluded.comment,
         preserved_time = COALESCE(checks.preserved_time, excluded.preserved_time)`,
    ).run(date, position, role, now.toISOString(), note, slot.check?.preservedTime ?? null);
  });
  tx();
}

export function clearCheck(db: DB, date: string, position: number): void {
  db.prepare(`DELETE FROM checks WHERE date = ? AND position = ?`).run(date, position);
}

export function setComment(db: DB, date: string, position: number, comment: unknown): void {
  const note = cleanComment(comment);
  const result = db.prepare(`UPDATE checks SET comment = ? WHERE date = ? AND position = ?`).run(note, date, position);
  if (result.changes === 0) throw new AppError('Check the meal before adding a note.');
}

export function buildHome(db: DB, now = new Date()): {
  today: string;
  timezone: string;
  startedOn: string;
  todayDay: DayView;
  yesterday: { date: string; slots: DaySlot[] } | null;
} {
  const { timezone, startedOn } = requireReady(db);
  const today = todayInZone(timezone, now);
  const yesterdayDate = addDays(today, -1);
  const todayDay = getDay(db, today);
  let yesterday: { date: string; slots: DaySlot[] } | null = null;
  if (yesterdayDate >= startedOn) {
    const unchecked = getDay(db, yesterdayDate).slots.filter((slot) => !slot.check);
    if (unchecked.length > 0) yesterday = { date: yesterdayDate, slots: unchecked };
  }
  return { today, timezone, startedOn, todayDay, yesterday };
}

export type HistoryItem = { date: string; fed: number; total: number };

export function listHistory(db: DB, now = new Date()): { recent: HistoryItem[]; older: HistoryItem[] } {
  const { timezone, startedOn } = requireReady(db);
  const today = todayInZone(timezone, now);
  const cutoff = addDays(today, -6);
  const recent: HistoryItem[] = [];
  const older: HistoryItem[] = [];
  let guard = 0;
  for (let date = today; date >= startedOn && guard < 4000; date = addDays(date, -1)) {
    guard += 1;
    const day = getDay(db, date);
    const item = { date, fed: day.slots.filter((slot) => slot.check).length, total: day.slots.length };
    if (date >= cutoff) recent.push(item);
    else older.push(item);
  }
  return { recent, older };
}
