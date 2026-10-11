import type { DB } from './db.js';
import { AppError } from './errors.js';
import { isRole, type Role } from './types.js';

export type Person = { email: string; role: Role };

export function listPeople(db: DB): Person[] {
  const rows = db.prepare(`SELECT email, role FROM people ORDER BY role`).all() as Person[];
  return rows.filter((person) => isRole(person.role));
}

export function claimRole(db: DB, email: string, role: Role): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new AppError('That email cannot be saved.');
  const tx = db.transaction(() => {
    const self = db.prepare(`SELECT role FROM people WHERE email = ?`).get(normalized) as { role: Role } | undefined;
    if (self) throw new AppError('This email already has a role.', 409);
    const taken = db.prepare(`SELECT email FROM people WHERE role = ?`).get(role) as { email: string } | undefined;
    if (taken) throw new AppError('That role is already taken.', 409);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM people`).get() as { n: number };
    if (count.n >= 2) throw new AppError("This email isn't one of the two people.", 403);
    db.prepare(`INSERT INTO people (email, role, created_at) VALUES (?, ?, ?)`).run(
      normalized,
      role,
      new Date().toISOString(),
    );
  });
  tx();
}

export function swapRoles(db: DB): void {
  const tx = db.transaction(() => {
    const people = listPeople(db);
    if (people.length === 0) throw new AppError('Nobody has picked a role yet.');
    const update = db.prepare(`UPDATE people SET role = ? WHERE email = ?`);
    for (const person of people) {
      update.run(person.role === 'Husband' ? 'Wife' : 'Husband', person.email);
    }
  });
  tx();
}
