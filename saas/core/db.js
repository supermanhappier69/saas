// SQLite storage using Node's built-in node:sqlite (Node 22.13+ / 24). No native add-ons needed.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const plain = (row) => (row ? { ...row } : row);

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  const db = {
    raw,
    file,
    exec: (sql) => raw.exec(sql),
    run(sql, ...params) {
      const r = prep(sql).run(...params.map(norm));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    get: (sql, ...params) => plain(prep(sql).get(...params.map(norm))),
    all: (sql, ...params) => prep(sql).all(...params.map(norm)).map(plain),
    /** Runs fn in a transaction. Nested calls join the outer transaction. fn must be synchronous. */
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        depth--;
      }
    },
    /** Runs fn inside a transaction that is always rolled back (used for import previews). */
    dryRun(fn) {
      if (depth > 0) throw new Error('dryRun cannot be nested inside a transaction');
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        return fn();
      } finally {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        depth--;
      }
    },
    tableColumns(table) {
      return raw.prepare(`PRAGMA table_info("${String(table).replace(/"/g, '')}")`).all().map((c) => c.name);
    },
    ensureColumns(table, cols) {
      const have = new Set(db.tableColumns(table));
      for (const [name, type] of cols) {
        if (!have.has(name)) raw.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
      }
    },
    kvGet(key) {
      const r = db.get('SELECT value FROM kv WHERE key = ?', key);
      return r ? r.value : null;
    },
    kvSet(key, value) {
      db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    },
    close: () => raw.close(),
  };
  return db;
}

export const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  plan_status TEXT NOT NULL DEFAULT 'trialing',
  trial_ends TEXT,
  stripe_customer TEXT,
  stripe_subscription TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  feed_token TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  org_id INTEGER,
  email TEXT,
  role TEXT,
  data TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource TEXT,
  record_id INTEGER,
  summary TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit(org_id, id);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  org_id INTEGER,
  to_addr TEXT NOT NULL,
  cc TEXT,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  provider_id TEXT,
  error TEXT,
  related TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_org ON outbox(org_id, id);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  resource TEXT,
  record_id INTEGER,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  storage_key TEXT NOT NULL,
  sha256 TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_record ON files(org_id, resource, record_id);
CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY,
  org_id INTEGER,
  event_id TEXT UNIQUE,
  type TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  org_id INTEGER,
  kind TEXT NOT NULL,
  name TEXT,
  email TEXT,
  company TEXT,
  message TEXT,
  data TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;
