import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { devRoleCookie, resolveActor, type Actor } from './access.js';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { claimRole, listPeople, swapRoles } from './people.js';
import {
  applyFromNowOn,
  applyTodayOnly,
  assertDateInLog,
  buildHome,
  clearCheck,
  editableTimes,
  getDay,
  getSettings,
  listHistory,
  setCheck,
  setComment,
  setTimezone,
  switchMealCount,
  type MealCount,
} from './schedule.js';
import { formatDayLabel, formatTimeInZone, todayInZone, zonedTimeToUtc } from './time.js';
import { isRole, type Role } from './types.js';

type Variables = { actor: Actor };

type SlotJson = {
  position: number;
  time: string;
  extra: boolean;
  status: 'fed' | 'overdue' | 'upcoming';
  check: null | { role: Role; checkedAt: string; checkedTime: string; comment: string };
};

function publicSlot(
  slot: { position: number; time: string; extra: boolean; check: { role: Role; checkedAt: string; comment: string } | null },
  date: string,
  timeZone: string,
  now: Date,
): SlotJson {
  let status: SlotJson['status'] = 'upcoming';
  if (slot.check) status = 'fed';
  else status = now.getTime() >= zonedTimeToUtc(date, slot.time, timeZone).getTime() ? 'overdue' : 'upcoming';
  return {
    position: slot.position,
    time: slot.time,
    extra: slot.extra,
    status,
    check: slot.check
      ? {
          role: slot.check.role,
          checkedAt: slot.check.checkedAt,
          checkedTime: formatTimeInZone(new Date(slot.check.checkedAt), timeZone),
          comment: slot.check.comment,
        }
      : null,
  };
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Expected a JSON object.');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Expected a JSON object.');
  }
}

function requireRole(actor: Actor): Role {
  if (actor.kind === 'dev' || actor.kind === 'user') return actor.role;
  if (actor.kind === 'blocked') throw new AppError("This email isn't one of the two people.", 403);
  throw new AppError('Choose Husband or Wife first.', 403);
}

function parsePosition(value: string): number {
  if (!/^\d+$/.test(value)) throw new AppError('Unknown meal.');
  const position = Number(value);
  if (position > 20) throw new AppError('Unknown meal.');
  return position;
}

export function createApp(
  db: DB,
  options: {
    devMode: boolean;
    verifyJwt: (token: string) => Promise<string>;
    production?: boolean;
  },
): Hono<{ Variables: Variables }> {
  const production = options.production ?? false;
  const app = new Hono<{ Variables: Variables }>();

  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: 'Something went wrong.' }, 500);
  });

  app.use('/api/*', async (c, next) => {
    const actor = await resolveActor({
      devMode: options.devMode,
      cookieHeader: c.req.header('cookie'),
      jwt: c.req.header('cf-access-jwt-assertion'),
      verifyJwt: options.verifyJwt,
      db,
    });
    c.set('actor', actor);
    c.header('Cache-Control', 'no-store');
    const open =
      (c.req.method === 'GET' && c.req.path === '/api/session') ||
      (c.req.method === 'PUT' && c.req.path === '/api/settings/timezone') ||
      (c.req.method === 'POST' && c.req.path === '/api/session/role') ||
      (c.req.method === 'POST' && c.req.path === '/api/dev/role');
    if (!open) {
      requireRole(actor);
      const settings = getSettings(db);
      if (!settings.timezone || !settings.startedOn) throw new AppError('Set a timezone first.', 409);
    }
    await next();
  });

  app.get('/api/session', (c) => {
    const actor = c.get('actor');
    const settings = getSettings(db);
    const timezone = settings.timezone;
    const today = timezone ? todayInZone(timezone) : null;
    const base = {
      devMode: options.devMode,
      timezone,
      today,
      startedOn: settings.startedOn,
      todayLabel: timezone && today ? formatDayLabel(today, timezone) : null,
      people: actor.kind === 'blocked' || actor.kind === 'needs-role' ? [] : listPeople(db),
    };
    if (actor.kind === 'dev' || actor.kind === 'user') {
      return c.json({
        ...base,
        email: actor.kind === 'user' ? actor.email : null,
        role: actor.role,
        needsRole: false,
        blocked: false,
        availableRoles: [] as Role[],
      });
    }
    if (actor.kind === 'needs-role') {
      return c.json({
        ...base,
        email: actor.email,
        role: null,
        needsRole: true,
        blocked: false,
        availableRoles: actor.availableRoles,
      });
    }
    return c.json({
      ...base,
      email: actor.email,
      role: null,
      needsRole: false,
      blocked: true,
      availableRoles: [] as Role[],
    });
  });

  app.put('/api/settings/timezone', async (c) => {
    const actor = c.get('actor');
    if (actor.kind === 'blocked') throw new AppError("This email isn't one of the two people.", 403);
    const body = await readJson(c);
    if (typeof body.timezone !== 'string') throw new AppError('Unknown timezone.');
    setTimezone(db, body.timezone);
    return c.json({ ok: true });
  });

  app.post('/api/session/role', async (c) => {
    if (options.devMode) throw new AppError('Not found.', 404);
    const actor = c.get('actor');
    if (actor.kind === 'blocked') throw new AppError("This email isn't one of the two people.", 403);
    if (actor.kind !== 'needs-role') throw new AppError('This email already has a role.', 409);
    const body = await readJson(c);
    if (!isRole(body.role) || !actor.availableRoles.includes(body.role)) {
      throw new AppError('That role is already taken.', 409);
    }
    claimRole(db, actor.email, body.role);
    return c.json({ ok: true });
  });

  app.post('/api/session/swap', (c) => {
    if (options.devMode) throw new AppError('Roles follow the Husband / Wife switch in local development.', 404);
    requireRole(c.get('actor'));
    swapRoles(db);
    return c.json({ ok: true });
  });

  app.post('/api/dev/role', async (c) => {
    if (!options.devMode) throw new AppError('Not found.', 404);
    const body = await readJson(c);
    if (!isRole(body.role)) throw new AppError('Choose Husband or Wife.');
    c.header('Set-Cookie', devRoleCookie(body.role));
    return c.json({ ok: true, role: body.role });
  });

  app.get('/api/home', (c) => {
    const now = new Date();
    const home = buildHome(db, now);
    return c.json({
      today: home.today,
      todayLabel: formatDayLabel(home.today, home.timezone),
      timezone: home.timezone,
      mealCount: home.todayDay.mealCount,
      yesterday: home.yesterday
        ? {
            date: home.yesterday.date,
            label: formatDayLabel(home.yesterday.date, home.timezone),
            slots: home.yesterday.slots.map((slot) => publicSlot(slot, home.yesterday!.date, home.timezone, now)),
          }
        : null,
      slots: home.todayDay.slots.map((slot) => publicSlot(slot, home.today, home.timezone, now)),
    });
  });

  app.get('/api/history', (c) => {
    const settings = getSettings(db);
    const timezone = settings.timezone;
    if (!timezone) throw new AppError('Set a timezone first.', 409);
    const history = listHistory(db);
    const label = (item: { date: string; fed: number; total: number }) => ({
      ...item,
      label: formatDayLabel(item.date, timezone),
    });
    return c.json({ recent: history.recent.map(label), older: history.older.map(label) });
  });

  app.get('/api/days/:date', (c) => {
    const date = c.req.param('date');
    assertDateInLog(db, date);
    const settings = getSettings(db);
    const timezone = settings.timezone!;
    const now = new Date();
    const day = getDay(db, date);
    return c.json({
      date,
      label: formatDayLabel(date, timezone),
      mealCount: day.mealCount,
      isToday: date === todayInZone(timezone, now),
      slots: day.slots.map((slot) => publicSlot(slot, date, timezone, now)),
    });
  });

  app.post('/api/days/:date/slots/:position/check', async (c) => {
    const date = c.req.param('date');
    const position = parsePosition(c.req.param('position'));
    assertDateInLog(db, date);
    const body = await readJson(c);
    setCheck(db, date, position, requireRole(c.get('actor')), body.comment ?? '');
    return c.json({ ok: true });
  });

  app.delete('/api/days/:date/slots/:position/check', (c) => {
    const date = c.req.param('date');
    const position = parsePosition(c.req.param('position'));
    assertDateInLog(db, date);
    requireRole(c.get('actor'));
    clearCheck(db, date, position);
    return c.json({ ok: true });
  });

  app.patch('/api/days/:date/slots/:position', async (c) => {
    const date = c.req.param('date');
    const position = parsePosition(c.req.param('position'));
    assertDateInLog(db, date);
    requireRole(c.get('actor'));
    const body = await readJson(c);
    setComment(db, date, position, body.comment);
    return c.json({ ok: true });
  });

  app.get('/api/schedule', (c) => {
    const settings = getSettings(db);
    const timezone = settings.timezone;
    if (!timezone) throw new AppError('Set a timezone first.', 409);
    const today = todayInZone(timezone);
    const editable = editableTimes(db, today);
    return c.json({ today, mealCount: editable.mealCount, times: editable.times });
  });

  app.put('/api/schedule/times', async (c) => {
    const body = await readJson(c);
    const settings = getSettings(db);
    if (!settings.timezone) throw new AppError('Set a timezone first.', 409);
    const today = todayInZone(settings.timezone);
    if (!Array.isArray(body.times)) throw new AppError('Enter a time for each meal.');
    if (body.scope === 'today') applyTodayOnly(db, today, body.times as string[]);
    else if (body.scope === 'forward') applyFromNowOn(db, today, body.times as string[]);
    else throw new AppError('Choose today only or from now on.');
    const editable = editableTimes(db, today);
    return c.json({ ok: true, mealCount: editable.mealCount, times: editable.times });
  });

  app.put('/api/schedule/count', async (c) => {
    const body = await readJson(c);
    const mealCount = body.mealCount;
    if (mealCount !== 3 && mealCount !== 5) throw new AppError('Choose 3 or 5 meals.');
    if (typeof body.effectiveDate !== 'string') throw new AppError('Choose a real date.');
    switchMealCount(db, body.effectiveDate, mealCount as MealCount);
    return c.json({ ok: true });
  });

  if (production) {
    app.use('*', serveStatic({ root: path.resolve('dist') }));
    const indexPath = path.resolve('dist', 'index.html');
    app.notFound((c) => {
      if (c.req.path.startsWith('/api')) return c.json({ error: 'Not found.' }, 404);
      return c.html(fs.readFileSync(indexPath, 'utf8'));
    });
  } else {
    app.notFound((c) => {
      if (c.req.path === '/') {
        return c.text('The dev UI is on the Vite server, usually http://localhost:5173\n', 404);
      }
      return c.json({ error: 'Not found.' }, 404);
    });
  }

  return app;
}
