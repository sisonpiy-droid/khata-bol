// All money logic lives here: deterministic SQL + integer paise. The AI never touches this.
import { randomUUID } from 'node:crypto'

export const MAX_PAISE = 100_000_000 // Rs 10,00,000 per entry
const DAY = 864e5

export class LedgerError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code }
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r }
  catch (e) { db.exec('ROLLBACK'); throw e }
}
const audit = (db, txnId, event, detail) =>
  db.prepare('INSERT INTO audit_events (ts, txn_id, event, detail) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), txnId, event, JSON.stringify(detail ?? {}))

export const getShop = (db) => db.prepare('SELECT id, name, is_demo FROM shops ORDER BY id LIMIT 1').get()
export const balanceOf = (db, cid) => db.prepare('SELECT COALESCE(SUM(delta_paise), 0) AS b FROM transactions WHERE customer_id = ?').get(cid).b

export function listCustomers(db) {
  return db.prepare(`SELECT c.id, c.name, COALESCE(SUM(t.delta_paise), 0) AS balance_paise
    FROM customers c LEFT JOIN transactions t ON t.customer_id = c.id GROUP BY c.id ORDER BY c.name`).all()
}

export function stats(db) {
  const rows = listCustomers(db)
  const owing = rows.filter((r) => r.balance_paise > 0)
  return { outstanding_paise: owing.reduce((s, r) => s + r.balance_paise, 0), owing_count: owing.length, customer_count: rows.length }
}

// Entries newest first, each with the customer's balance right after it. Reversed entries stay visible, flagged.
export function history(db, { customerId = null, limit = 30 } = {}) {
  return db.prepare(`SELECT * FROM (
      SELECT t.id, t.customer_id, c.name AS customer_name, t.type, t.amount_paise, t.delta_paise, t.reversed_of, t.ts, t.synthetic, t.rowid AS rid,
        SUM(t.delta_paise) OVER (PARTITION BY t.customer_id ORDER BY t.ts, t.rowid) AS balance_after_paise,
        EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id) AS reversed
      FROM transactions t JOIN customers c ON c.id = t.customer_id)
    WHERE (?1 IS NULL OR customer_id = ?1) ORDER BY ts DESC, rid DESC LIMIT ?2`).all(customerId, Math.min(limit, 200))
}

export function addCustomer(db, name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!n || n.length > 60) throw new LedgerError('Customer name must be 1-60 characters')
  const shop = getShop(db)
  const id = db.prepare('INSERT INTO customers (shop_id, name, created_at) VALUES (?, ?, ?)').run(shop.id, n, new Date().toISOString()).lastInsertRowid
  return { id: Number(id), name: n }
}

const byKey = (db, key) => db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(key)

// The only way credit/payment is written. The same idempotency key never creates a second row.
export function commitEntry(db, { customerId = null, newName = null, type, amountPaise, key, synthetic = 0, ts = null }) {
  if (!['credit', 'payment'].includes(type)) throw new LedgerError('Type must be credit or payment')
  if (!Number.isInteger(amountPaise) || amountPaise < 1 || amountPaise > MAX_PAISE) throw new LedgerError('Amount must be between Rs 0.01 and Rs 10,00,000')
  if (!key) throw new LedgerError('Missing idempotency key')
  return tx(db, () => {
    const existing = byKey(db, key)
    if (existing) {
      if (existing.type !== type || existing.amount_paise !== amountPaise) throw new LedgerError('Idempotency key reused with different data', 'conflict')
      audit(db, existing.id, 'duplicate_blocked', { key })
      return { duplicate: true, txn: existing, balance_paise: balanceOf(db, existing.customer_id) }
    }
    const shop = getShop(db)
    let customer
    if (customerId != null) {
      customer = db.prepare('SELECT id, name FROM customers WHERE id = ? AND shop_id = ?').get(customerId, shop.id)
      if (!customer) throw new LedgerError('Unknown customer', 'not_found')
    } else customer = addCustomer(db, newName)
    const id = randomUUID()
    db.prepare(`INSERT INTO transactions (id, shop_id, customer_id, type, amount_paise, delta_paise, idempotency_key, ts, synthetic)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, shop.id, customer.id, type, amountPaise, type === 'credit' ? amountPaise : -amountPaise, key, ts ?? new Date().toISOString(), synthetic)
    audit(db, id, 'created', { type, amountPaise, customerId: customer.id })
    return { duplicate: false, txn: byKey(db, key), customer, balance_paise: balanceOf(db, customer.id) }
  })
}

// Mistakes are corrected by a new, linked reversal row; the original stays in history.
export function reverseTxn(db, { txnId, key }) {
  if (!key) throw new LedgerError('Missing idempotency key')
  return tx(db, () => {
    const existing = byKey(db, key)
    if (existing) { audit(db, existing.id, 'duplicate_blocked', { key }); return { duplicate: true, txn: existing, balance_paise: balanceOf(db, existing.customer_id) } }
    const orig = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId)
    if (!orig) throw new LedgerError('Entry not found', 'not_found')
    if (orig.type === 'reversal') throw new LedgerError('A reversal cannot be reversed')
    if (db.prepare('SELECT 1 FROM transactions WHERE reversed_of = ?').get(txnId)) throw new LedgerError('Entry already reversed', 'conflict')
    const id = randomUUID()
    db.prepare(`INSERT INTO transactions (id, shop_id, customer_id, type, amount_paise, delta_paise, reversed_of, idempotency_key, ts)
      VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, ?)`).run(id, orig.shop_id, orig.customer_id, orig.amount_paise, -orig.delta_paise, orig.id, key, new Date().toISOString())
    audit(db, id, 'reversed', { original: orig.id })
    return { duplicate: false, txn: byKey(db, key), original: orig, balance_paise: balanceOf(db, orig.customer_id) }
  })
}

// Latest entry that is a real credit/payment and not yet reversed.
export function lastReversible(db) {
  return db.prepare(`SELECT t.*, c.name AS customer_name FROM transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.type != 'reversal' AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)
    ORDER BY t.ts DESC, t.rowid DESC LIMIT 1`).get()
}

export function entryById(db, id) {
  return db.prepare(`SELECT t.*, c.name AS customer_name FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?`).get(id)
}

// Today in IST, from real rows. Reversed entries are excluded; nothing else is invented.
export function todaySummary(db, now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const start = new Date(`${ymd}T00:00:00+05:30`).toISOString()
  const end = new Date(new Date(start).getTime() + DAY).toISOString()
  const sum = (type) => db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS s, COUNT(*) AS n FROM transactions t
    WHERE type = ? AND ts >= ? AND ts < ? AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)`).get(type, start, end)
  const c = sum('credit'), p = sum('payment')
  return { credit_paise: c.s, payment_paise: p.s, count: c.n + p.n }
}

const DEMO = [
  ['Ramesh', [[12, 'credit', 300], [5, 'payment', 300]]], // starts at zero on purpose
  ['Rameshwar', [[14, 'credit', 1200], [6, 'payment', 400]]],
  ['Suresh', [[9, 'credit', 450]]],
  ['Priya', [[7, 'credit', 250], [2, 'payment', 250]]],
  ['Kavita', [[10, 'credit', 600], [3, 'credit', 200]]],
]

// Synthetic, clearly flagged history. Only ever called on an empty database or on an is_demo shop.
export function seedDemo(db) {
  tx(db, () => {
    db.prepare("INSERT OR IGNORE INTO shops (id, name, is_demo) VALUES (1, 'Sharma Kirana Store', 1)").run()
    DEMO.forEach(([name, rows], i) => {
      const cid = Number(db.prepare('INSERT INTO customers (shop_id, name, created_at) VALUES (1, ?, ?)').run(name, new Date().toISOString()).lastInsertRowid)
      rows.forEach(([ago, type, rupees], j) => {
        const paise = rupees * 100
        db.prepare(`INSERT INTO transactions (id, shop_id, customer_id, type, amount_paise, delta_paise, idempotency_key, ts, synthetic)
          VALUES (?, 1, ?, ?, ?, ?, ?, ?, 1)`).run(randomUUID(), cid, type, paise, type === 'credit' ? paise : -paise, `demo-${i}-${j}`, new Date(Date.now() - ago * DAY).toISOString())
      })
    })
  })
}

export const ensureDemo = (db) => { if (!getShop(db)) seedDemo(db) }

export function resetDemo(db) {
  const shop = getShop(db)
  if (!shop?.is_demo) throw new LedgerError('Reset is only available in demo mode', 'forbidden')
  tx(db, () => {
    db.exec('DELETE FROM transactions; DELETE FROM customers; DELETE FROM conversations;')
    audit(db, null, 'demo_reset', {})
  })
  seedDemo(db)
}
