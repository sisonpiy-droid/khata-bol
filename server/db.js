import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0
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
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, txn_id TEXT, event TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, ctx TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS tx_no_update BEFORE UPDATE ON transactions
BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON transactions
WHEN (SELECT is_demo FROM shops WHERE id = OLD.shop_id) != 1
BEGIN SELECT RAISE(ABORT, 'only demo data can be deleted'); END;
`

export function openDb(path = process.env.KHATA_DB || (process.env.VERCEL ? '/tmp/khata.db' : 'data/khata.db')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  return db
}
