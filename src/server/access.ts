import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { listPeople } from './people.js';
import type { Role } from './types.js';

export type Actor =
  | { kind: 'dev'; role: Role }
  | { kind: 'user'; email: string; role: Role }
  | { kind: 'needs-role'; email: string; availableRoles: Role[] }
  | { kind: 'blocked'; email: string };

export type RuntimeConfig =
  | { ok: true; devMode: true }
  | { ok: true; devMode: false; teamDomain: string; audience: string }
  | { ok: false; message: string };

export function normalizeTeamDomain(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^https?:\/\//i, '');
  value = value.split('/')[0] ?? '';
  return value.replace(/\.$/, '').toLowerCase();
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? '');
  const audience = (env.CF_ACCESS_AUD ?? '').trim();
  if ((teamDomain && !audience) || (!teamDomain && audience)) {
    return {
      ok: false,
      message: 'Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or leave both unset for local development.',
    };
  }
  if (!teamDomain && !audience) {
    if (env.NODE_ENV === 'production') {
      return {
        ok: false,
        message:
          'Refusing to start. Production requires Cloudflare Access (CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD). The Husband/Wife dev switch cannot be exposed publicly.',
      };
    }
    return { ok: true, devMode: true };
  }
  return { ok: true, devMode: false, teamDomain, audience };
}

export function makeCloudflareVerifier(teamDomain: string, audience: string): (token: string) => Promise<string> {
  const issuer = `https://${teamDomain}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    const email = payload.email;
    if (typeof email !== 'string') throw new Error('missing email');
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new Error('missing email');
    return normalized;
  };
}

const DEV_COOKIE = 'cat_dev_role';

export function readDevRole(cookieHeader: string | undefined): Role | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== DEV_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    if (value === 'Husband' || value === 'Wife') return value;
  }
  return null;
}

export function devRoleCookie(role: Role): string {
  return `${DEV_COOKIE}=${role}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

export async function resolveActor(input: {
  devMode: boolean;
  cookieHeader: string | undefined;
  jwt: string | undefined;
  verifyJwt: (token: string) => Promise<string>;
  db: DB;
}): Promise<Actor> {
  if (input.devMode) {
    return { kind: 'dev', role: readDevRole(input.cookieHeader) ?? 'Husband' };
  }
  const token = input.jwt?.trim();
  if (!token) throw new AppError('A verified Cloudflare Access token is required.', 401);
  let email: string;
  try {
    email = await input.verifyJwt(token);
  } catch {
    throw new AppError('A verified Cloudflare Access token is required.', 401);
  }
  const people = listPeople(input.db);
  const person = people.find((entry) => entry.email === email);
  if (person) return { kind: 'user', email, role: person.role };
  const taken = new Set(people.map((entry) => entry.role));
  if (taken.size >= 2) return { kind: 'blocked', email };
  const availableRoles = (['Husband', 'Wife'] as const).filter((role) => !taken.has(role));
  return { kind: 'needs-role', email, availableRoles: [...availableRoles] };
}
