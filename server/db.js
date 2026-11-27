import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
  visitor TEXT, last_seen TEXT -- public demo: one private shop per visitor session
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60), created_at TEXT NOT NULL
);
-- Money is integer paise. delta_paise is the signed effect on what the customer owes:
-- credit +, payment -, reversal = minus the delta of the entry it reverses. Rows are never edited.
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL CHECK (type IN ('credit', 'payment', 'reversal')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 100000000),
  delta_paise INTEGER NOT NULL,
  reversed_of TEXT REFERENCES transactions(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  ts TEXT NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_reversal_per_entry ON transactions(reversed_of) WHERE reversed_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS tx_customer ON transactions(customer_id, ts);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, txn_id TEXT, event TEXT NOT NULL, detail TEXT,
  shop_id INTEGER -- audit rows (and the transcript they hold) are removed together with their demo shop
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, ctx TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Payment commitments (promised due dates) double as reminders: a due date plus optional time. They never touch balances.
-- Only credit/payment/reversal rows in transactions change what a customer owes.
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  due_date TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), -- shop-local (Asia/Kolkata) calendar day
  due_time TEXT CHECK (due_time IS NULL OR due_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  amount_paise INTEGER CHECK (amount_paise IS NULL OR (amount_paise > 0 AND amount_paise <= 100000000)), -- only when the shopkeeper said it
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')), -- chosen by the user, never auto-changed
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  txn_id TEXT REFERENCES transactions(id), -- the credit entry this follows up, if any
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS commitments_open ON commitments(shop_id, status, due_date);
CREATE TABLE IF NOT EXISTS commitment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_id TEXT NOT NULL REFERENCES commitments(id),
  shop_id INTEGER NOT NULL, ts TEXT NOT NULL, event TEXT NOT NULL, detail TEXT
);
-- One row per (commitment, fire time, channel): re-running a scheduler can never deliver the same reminder twice.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_id TEXT NOT NULL REFERENCES commitments(id),
  shop_id INTEGER NOT NULL, fire_key TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'in_app', delivered_at TEXT NOT NULL,
  UNIQUE (commitment_id, fire_key, channel)
);
CREATE TRIGGER IF NOT EXISTS tx_no_update BEFORE UPDATE ON transactions
BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON transactions
WHEN (SELECT is_demo FROM shops WHERE id = OLD.shop_id) != 1
BEGIN SELECT RAISE(ABORT, 'only demo data can be deleted'); END;
`

// Where the database lives. Railway sets RAILWAY_VOLUME_MOUNT_PATH when a volume is attached, so the
// ledger lands on the persistent volume with no extra config. Elsewhere: KHATA_DB, else ./data/khata.db.
export function dbPath() {
  // ponytail: Vercel has no persistent disk; /tmp lives as long as the warm instance. Move to Turso/Neon for real persistence.
  if (process.env.VERCEL) return '/tmp/khata.db'
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'khata.db')
  return process.env.KHATA_DB || 'data/khata.db'
}

// True when records will survive a restart: a Railway volume is attached, or we are not on Railway at all.
export const isPersistent = () => !process.env.VERCEL && (!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_VOLUME_MOUNT_PATH)

export function openDb(path = dbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  // Databases created before per-visitor demos lack these columns.
  const cols = db.prepare('PRAGMA table_info(shops)').all().map((c) => c.name)
  if (!cols.includes('visitor')) db.exec('ALTER TABLE shops ADD COLUMN visitor TEXT; ALTER TABLE shops ADD COLUMN last_seen TEXT;')
  if (!db.prepare('PRAGMA table_info(audit_events)').all().some((c) => c.name === 'shop_id')) db.exec('ALTER TABLE audit_events ADD COLUMN shop_id INTEGER;')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS shop_visitor ON shops(visitor) WHERE visitor IS NOT NULL')
  return db
}
