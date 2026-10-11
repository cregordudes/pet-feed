import { afterEach, expect, test } from 'vitest';
import { resolveRuntimeConfig } from './access.js';
import { createApp } from './app.js';
import { openDatabase, type DB } from './db.js';
import { setTimezone } from './schedule.js';

let db: DB;

afterEach(() => {
  db?.close();
});

test('production refuses to run without Cloudflare Access', () => {
  const missing = resolveRuntimeConfig({ NODE_ENV: 'production' });
  expect(missing.ok).toBe(false);
  const partial = resolveRuntimeConfig({ CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' });
  expect(partial.ok).toBe(false);
  const dev = resolveRuntimeConfig({});
  expect(dev.ok).toBe(true);
  if (dev.ok) expect(dev.devMode).toBe(true);
  const ready = resolveRuntimeConfig({
    NODE_ENV: 'production',
    CF_ACCESS_TEAM_DOMAIN: 'https://Team.cloudflareaccess.com/cdn-cgi/access/certs',
    CF_ACCESS_AUD: 'audience-tag',
  });
  expect(ready).toEqual({
    ok: true,
    devMode: false,
    teamDomain: 'team.cloudflareaccess.com',
    audience: 'audience-tag',
  });
});

test('the email header alone is not trusted', async () => {
  db = openDatabase(':memory:');
  const app = createApp(db, {
    devMode: false,
    verifyJwt: async (token) => {
      if (token === 'good') return 'husband@example.com';
      throw new Error('invalid');
    },
  });

  const headerOnly = await app.request('/api/session', {
    headers: { 'Cf-Access-Authenticated-User-Email': 'wife@example.com' },
  });
  expect(headerOnly.status).toBe(401);

  const verified = await app.request('/api/session', {
    headers: {
      'Cf-Access-Jwt-Assertion': 'good',
      'Cf-Access-Authenticated-User-Email': 'intruder@example.com',
    },
  });
  expect(verified.status).toBe(200);
  const body = (await verified.json()) as { email: string; needsRole: boolean; role: string | null };
  expect(body.email).toBe('husband@example.com');
  expect(body.needsRole).toBe(true);
  expect(body.role).toBeNull();
});

test('a third email is refused once both roles are taken', async () => {
  db = openDatabase(':memory:');
  const emails: Record<string, string> = {
    a: 'a@example.com',
    b: 'b@example.com',
    c: 'c@example.com',
  };
  const app = createApp(db, {
    devMode: false,
    verifyJwt: async (token) => {
      const email = emails[token];
      if (!email) throw new Error('invalid');
      return email;
    },
  });

  const claim = (token: string, role: string) =>
    app.request('/api/session/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
      body: JSON.stringify({ role }),
    });

  expect((await claim('a', 'Husband')).status).toBe(200);
  expect((await claim('b', 'Husband')).status).toBe(409);
  expect((await claim('b', 'Wife')).status).toBe(200);

  const third = await app.request('/api/session', {
    headers: {
      'Cf-Access-Jwt-Assertion': 'c',
      'Cf-Access-Authenticated-User-Email': 'a@example.com',
    },
  });
  const session = (await third.json()) as { blocked: boolean; email: string };
  expect(session.blocked).toBe(true);
  expect(session.email).toBe('c@example.com');

  const home = await app.request('/api/home', {
    headers: { 'Cf-Access-Jwt-Assertion': 'c' },
  });
  expect(home.status).toBe(403);

  setTimezone(db, 'UTC');
  const swapped = await app.request('/api/session/swap', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': 'a' },
  });
  expect(swapped.status).toBe(200);
  const after = (await (
    await app.request('/api/session', { headers: { 'Cf-Access-Jwt-Assertion': 'a' } })
  ).json()) as { role: string };
  expect(after.role).toBe('Wife');
});

test('dev mode switches Husband and Wife without a token', async () => {
  db = openDatabase(':memory:');
  const app = createApp(db, {
    devMode: true,
    verifyJwt: async () => 'intruder@example.com',
  });
  const first = (await (
    await app.request('/api/session', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'intruder@example.com' },
    })
  ).json()) as { devMode: boolean; role: string; email: string | null };
  expect(first).toMatchObject({ devMode: true, role: 'Husband', email: null });

  const switched = await app.request('/api/dev/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'Wife' }),
  });
  const cookie = switched.headers.get('set-cookie')?.split(';')[0];
  const second = (await (await app.request('/api/session', { headers: { cookie: cookie ?? '' } })).json()) as {
    role: string;
  };
  expect(second.role).toBe('Wife');
});
