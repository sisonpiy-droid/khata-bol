// All money logic lives here: deterministic SQL + integer paise. The AI never touches this.
// Every function is scoped to one shop. On the public demo each visitor gets their own demo shop,
// so visitors can never see or change each other's ledger.
import { randomUUID } from 'node:crypto'
import { addDays, istYmd } from './dates.js'

export const MAX_PAISE = 100_000_000 // Rs 10,00,000 per entry
const MAX_SHOPS = 5000 // public-demo cap; stale demo shops are pruned first
const STALE_DAYS = 14
const DAY = 864e5

export class LedgerError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code }
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r }
  catch (e) { db.exec('ROLLBACK'); throw e }
}
const audit = (db, txnId, event, detail, shopId = null) =>
  db.prepare('INSERT INTO audit_events (ts, txn_id, event, detail, shop_id) VALUES (?, ?, ?, ?, ?)').run(new Date().toISOString(), txnId, event, JSON.stringify(detail ?? {}), shopId)

// Follow-up rows reference customers and transactions, so they go first when a demo shop is reset or pruned.
const dropFollowUps = (db, shopId) => {
  db.prepare('DELETE FROM notification_deliveries WHERE shop_id = ?').run(shopId)
  db.prepare('DELETE FROM commitment_history WHERE shop_id = ?').run(shopId)
  db.prepare('DELETE FROM commitments WHERE shop_id = ?').run(shopId)
}

export const getShop = (db, shopId) => db.prepare('SELECT id, name, is_demo FROM shops WHERE id = ?').get(shopId)
export const balanceOf = (db, cid) => db.prepare('SELECT COALESCE(SUM(delta_paise), 0) AS b FROM transactions WHERE customer_id = ?').get(cid).b

// The visitor's private demo shop, created (and seeded with synthetic data) on first use.
export function shopFor(db, visitor) {
  if (!/^[\w-]{8,64}$/.test(String(visitor))) throw new LedgerError('Invalid session')
  const now = new Date().toISOString()
  const row = db.prepare('SELECT id FROM shops WHERE visitor = ?').get(visitor)
  if (row) {
    db.prepare('UPDATE shops SET last_seen = ? WHERE id = ? AND last_seen < ?').run(now, row.id, new Date(Date.now() - 36e5).toISOString())
    return row.id
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM shops').get().n >= MAX_SHOPS) {
    pruneStale(db)
    if (db.prepare('SELECT COUNT(*) AS n FROM shops').get().n >= MAX_SHOPS) throw new LedgerError('The demo is busy right now. Please try again in a few minutes.', 'busy')
  }
  const id = Number(db.prepare("INSERT INTO shops (name, is_demo, visitor, last_seen) VALUES ('Sharma Kirana Store', 1, ?, ?)").run(visitor, now).lastInsertRowid)
  seedDemo(db, id)
  return id
}

// Drops demo shops nobody has touched for two weeks (demo shops only; a real shop is never pruned).
export function pruneStale(db, days = STALE_DAYS) {
  const cutoff = new Date(Date.now() - days * DAY).toISOString()
  tx(db, () => {
    const ids = db.prepare('SELECT id, visitor FROM shops WHERE is_demo = 1 AND visitor IS NOT NULL AND last_seen < ?').all(cutoff)
    for (const s of ids) {
      dropFollowUps(db, s.id)
      db.prepare('DELETE FROM transactions WHERE shop_id = ?').run(s.id)
      db.prepare('DELETE FROM audit_events WHERE shop_id = ?').run(s.id)
      db.prepare('DELETE FROM customers WHERE shop_id = ?').run(s.id)
      db.prepare('DELETE FROM conversations WHERE id = ?').run(s.visitor)
      db.prepare('DELETE FROM shops WHERE id = ?').run(s.id)
    }
  })
}

export function listCustomers(db, shopId) {
  return db.prepare(`SELECT c.id, c.name, COALESCE(SUM(t.delta_paise), 0) AS balance_paise
    FROM customers c LEFT JOIN transactions t ON t.customer_id = c.id WHERE c.shop_id = ? GROUP BY c.id ORDER BY c.name`).all(shopId)
}

export function stats(db, shopId) {
  const rows = listCustomers(db, shopId)
  const owing = rows.filter((r) => r.balance_paise > 0)
  return { outstanding_paise: owing.reduce((s, r) => s + r.balance_paise, 0), owing_count: owing.length, customer_count: rows.length }
}

// Entries newest first, each with the customer's balance right after it. Reversed entries stay visible, flagged.
export function history(db, shopId, { customerId = null, limit = 30 } = {}) {
  return db.prepare(`SELECT * FROM (
      SELECT t.id, t.shop_id, t.customer_id, c.name AS customer_name, t.type, t.amount_paise, t.delta_paise, t.reversed_of, t.ts, t.synthetic, t.rowid AS rid,
        SUM(t.delta_paise) OVER (PARTITION BY t.customer_id ORDER BY t.ts, t.rowid) AS balance_after_paise,
        EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id) AS reversed
      FROM transactions t JOIN customers c ON c.id = t.customer_id)
    WHERE shop_id = ?3 AND (?1 IS NULL OR customer_id = ?1) ORDER BY ts DESC, rid DESC LIMIT ?2`).all(customerId, Math.min(limit, 200), shopId)
}

export function addCustomer(db, shopId, name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!n || n.length > 60) throw new LedgerError('Customer name must be 1-60 characters')
  const id = db.prepare('INSERT INTO customers (shop_id, name, created_at) VALUES (?, ?, ?)').run(shopId, n, new Date().toISOString()).lastInsertRowid
  return { id: Number(id), name: n }
}

// Adds a customer once. An existing customer with the same name is returned instead of a duplicate
// (identical names the user wants separately are created through commitEntry's newName path after explicit choice).
export function createCustomer(db, { shopId, name, key }) {
  if (!key) throw new LedgerError('Missing idempotency key')
  return tx(db, () => {
    const done = db.prepare("SELECT detail FROM audit_events WHERE event = 'customer_created' AND txn_id = ?").get(key)
    if (done) { const c = db.prepare('SELECT id, name FROM customers WHERE id = ? AND shop_id = ?').get(JSON.parse(done.detail).customerId, shopId); if (c) return { duplicate: true, customer: c } }
    const n = String(name ?? '').trim().replace(/\s+/g, ' ')
    const same = db.prepare('SELECT id, name FROM customers WHERE shop_id = ? AND lower(name) = lower(?)').get(shopId, n)
    if (same) return { duplicate: true, customer: same }
    const customer = addCustomer(db, shopId, n)
    audit(db, key, 'customer_created', { customerId: customer.id }, shopId)
    return { duplicate: false, customer }
  })
}

// Entries a user may mean by "kal wale 300": same amount, optional IST day (0 today, -1 yesterday) and customer, newest first.
export function findReversible(db, shopId, { amountPaise, dayOffset = null, customerId = null }) {
  let from = '0000', to = '9999'
  if (dayOffset !== null) {
    const ymd = new Date(Date.now() + dayOffset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    from = new Date(`${ymd}T00:00:00+05:30`).toISOString(); to = new Date(new Date(from).getTime() + DAY).toISOString()
  }
  return db.prepare(`SELECT t.*, c.name AS customer_name FROM transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.shop_id = ?1 AND t.type != 'reversal' AND t.amount_paise = ?2 AND t.ts >= ?3 AND t.ts < ?4 AND (?5 IS NULL OR t.customer_id = ?5)
      AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)
    ORDER BY t.ts DESC, t.rowid DESC LIMIT 5`).all(shopId, amountPaise, from, to, customerId)
}

const byKey = (db, key) => db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(key)

// The only way credit/payment is written. The same idempotency key never creates a second row.
export function commitEntry(db, { shopId, customerId = null, newName = null, type, amountPaise, key, synthetic = 0, ts = null, said = null }) {
  if (!['credit', 'payment'].includes(type)) throw new LedgerError('Type must be credit or payment')
  if (!Number.isInteger(amountPaise) || amountPaise < 1 || amountPaise > MAX_PAISE) throw new LedgerError('Amount must be between Rs 0.01 and Rs 10,00,000')
  if (!key) throw new LedgerError('Missing idempotency key')
  return tx(db, () => {
    const existing = byKey(db, key)
    if (existing) {
      if (existing.shop_id !== shopId || existing.type !== type || existing.amount_paise !== amountPaise) throw new LedgerError('Idempotency key reused with different data', 'conflict')
      audit(db, existing.id, 'duplicate_blocked', { key }, shopId)
      return { duplicate: true, txn: existing, balance_paise: balanceOf(db, existing.customer_id) }
    }
    let customer
    if (customerId != null) {
      customer = db.prepare('SELECT id, name FROM customers WHERE id = ? AND shop_id = ?').get(customerId, shopId)
      if (!customer) throw new LedgerError('Unknown customer', 'not_found')
    } else customer = addCustomer(db, shopId, newName)
    const id = randomUUID()
    db.prepare(`INSERT INTO transactions (id, shop_id, customer_id, type, amount_paise, delta_paise, idempotency_key, ts, synthetic)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, shopId, customer.id, type, amountPaise, type === 'credit' ? amountPaise : -amountPaise, key, ts ?? new Date().toISOString(), synthetic)
    audit(db, id, 'created', { type, amountPaise, customerId: customer.id, said: said ? String(said).slice(0, 500) : undefined }, shopId)
    return { duplicate: false, txn: byKey(db, key), customer, balance_paise: balanceOf(db, customer.id) }
  })
}

// Mistakes are corrected by a new, linked reversal row; the original stays in history.
export function reverseTxn(db, { shopId, txnId, key }) {
  if (!key) throw new LedgerError('Missing idempotency key')
  return tx(db, () => {
    const existing = byKey(db, key)
    if (existing) {
      if (existing.shop_id !== shopId) throw new LedgerError('Idempotency key reused with different data', 'conflict')
      audit(db, existing.id, 'duplicate_blocked', { key }, shopId)
      return { duplicate: true, txn: existing, balance_paise: balanceOf(db, existing.customer_id) }
    }
    const orig = db.prepare('SELECT * FROM transactions WHERE id = ? AND shop_id = ?').get(txnId, shopId)
    if (!orig) throw new LedgerError('Entry not found', 'not_found')
    if (orig.type === 'reversal') throw new LedgerError('A reversal cannot be reversed')
    if (db.prepare('SELECT 1 FROM transactions WHERE reversed_of = ?').get(txnId)) throw new LedgerError('Entry already reversed', 'conflict')
    const id = randomUUID()
    db.prepare(`INSERT INTO transactions (id, shop_id, customer_id, type, amount_paise, delta_paise, reversed_of, idempotency_key, ts)
      VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, ?)`).run(id, orig.shop_id, orig.customer_id, orig.amount_paise, -orig.delta_paise, orig.id, key, new Date().toISOString())
    audit(db, id, 'reversed', { original: orig.id }, shopId)
    return { duplicate: false, txn: byKey(db, key), original: orig, balance_paise: balanceOf(db, orig.customer_id) }
  })
}

// Latest entry that is a real credit/payment and not yet reversed.
export function lastReversible(db, shopId) {
  return db.prepare(`SELECT t.*, c.name AS customer_name FROM transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.shop_id = ? AND t.type != 'reversal' AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)
    ORDER BY t.ts DESC, t.rowid DESC LIMIT 1`).get(shopId)
}

export function entryById(db, shopId, id) {
  return db.prepare(`SELECT t.*, c.name AS customer_name FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE t.shop_id = ? AND t.id = ?`).get(shopId, id)
}

// Today in IST, from real rows. Reversed entries are excluded; nothing else is invented.
export function todaySummary(db, shopId, now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const start = new Date(`${ymd}T00:00:00+05:30`).toISOString()
  const end = new Date(new Date(start).getTime() + DAY).toISOString()
  const sum = (type) => db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS s, COUNT(*) AS n FROM transactions t
    WHERE shop_id = ? AND type = ? AND ts >= ? AND ts < ? AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)`).get(shopId, type, start, end)
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

// Synthetic, clearly flagged history for one demo shop.
export function seedDemo(db, shopId) {
  tx(db, () => {
    const ids = {}
    DEMO.forEach(([name, rows], i) => {
      const cid = Number(db.prepare('INSERT INTO customers (shop_id, name, created_at) VALUES (?, ?, ?)').run(shopId, name, new Date().toISOString()).lastInsertRowid)
      ids[name] = cid
      rows.forEach(([ago, type, rupees], j) => {
        const paise = rupees * 100
        db.prepare(`INSERT INTO transactions (id, shop_id, customer_id, type, amount_paise, delta_paise, idempotency_key, ts, synthetic)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(randomUUID(), shopId, cid, type, paise, type === 'credit' ? paise : -paise, `demo-${shopId}-${i}-${j}`, new Date(Date.now() - ago * DAY).toISOString())
      })
    })
    // Synthetic follow-ups: one overdue, one due today, one coming up (relative to today, shop time).
    const today = istYmd()
    ;[['Suresh', addDays(today, -3), 'medium', 45000], ['Kavita', today, 'high', 80000], ['Rameshwar', addDays(today, 3), 'low', null]].forEach(([name, due, priority, amount], k) => {
      const id = randomUUID(), at = new Date().toISOString()
      db.prepare(`INSERT INTO commitments (id, shop_id, customer_id, due_date, amount_paise, priority, status, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(id, shopId, ids[name], due, amount, priority, `demo-c-${shopId}-${k}`, at, at)
      db.prepare('INSERT INTO commitment_history (commitment_id, shop_id, ts, event, detail) VALUES (?, ?, ?, ?, ?)').run(id, shopId, at, 'created', '{"synthetic":true}')
    })
  })
}

// Restores this visitor's demo to its starting point. Refuses on any shop that is not flagged demo.
export function resetDemo(db, shopId) {
  const shop = getShop(db, shopId)
  if (!shop?.is_demo) throw new LedgerError('Reset is only available in demo mode', 'forbidden')
  tx(db, () => {
    dropFollowUps(db, shopId)
    db.prepare('DELETE FROM transactions WHERE shop_id = ?').run(shopId)
    db.prepare('DELETE FROM audit_events WHERE shop_id = ?').run(shopId)
    db.prepare('DELETE FROM customers WHERE shop_id = ?').run(shopId)
    db.prepare('DELETE FROM conversations WHERE id = (SELECT visitor FROM shops WHERE id = ?)').run(shopId)
    audit(db, null, 'demo_reset', { shopId }, shopId)
  })
  seedDemo(db, shopId)
}
