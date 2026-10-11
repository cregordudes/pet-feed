import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      timezone TEXT,
      started_on TEXT
    );

    INSERT OR IGNORE INTO settings (id, timezone, started_on) VALUES (1, NULL, NULL);

    CREATE TABLE IF NOT EXISTS people (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('Husband', 'Wife')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY,
      effective_date TEXT NOT NULL UNIQUE,
      meal_count INTEGER NOT NULL CHECK (meal_count IN (3, 5)),
      times_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS day_overrides (
      date TEXT PRIMARY KEY,
      times_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checks (
      date TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      role TEXT NOT NULL CHECK (role IN ('Husband', 'Wife')),
      checked_at TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      preserved_time TEXT,
      PRIMARY KEY (date, position)
    );
  `);
}
