// Payment commitments and reminders: a promised due date (optional time) per customer, kept strictly apart from the ledger.
// Nothing here can change a balance. `priority` is chosen by the shopkeeper; `urgency` (overdue / due today / upcoming)
// is computed from the date and shown separately, so overdue items stand out without silently rewriting a chosen priority.
import { randomUUID } from 'node:crypto'
import { LedgerError, tx } from './ledger.js'
import { addDays, isHm, isYmd, istHm, istYmd } from './dates.js'

export const PRIORITIES = ['high', 'medium', 'low']
const RANK = { high: 0, medium: 1, low: 2 }
const MAX_PAISE = 100_000_000

const log = (db, shopId, id, event, detail) =>
  db.prepare('INSERT INTO commitment_history (commitment_id, shop_id, ts, event, detail) VALUES (?, ?, ?, ?, ?)').run(id, shopId, new Date().toISOString(), event, JSON.stringify(detail ?? {}))

function check({ dueDate, dueTime, amountPaise, priority, note }, now) {
  if (!isYmd(dueDate)) throw new LedgerError('Please give a valid date', 'bad_date')
  if (dueTime != null && !isHm(dueTime)) throw new LedgerError('Please give a valid time', 'bad_time')
  const today = istYmd(now)
  if (dueDate < today || (dueDate === today && dueTime && dueTime < istHm(now))) throw new LedgerError('That date has already passed', 'past')
  if (!PRIORITIES.includes(priority)) throw new LedgerError('Priority must be high, medium or low', 'bad_priority')
  if (amountPaise != null && (!Number.isInteger(amountPaise) || amountPaise < 1 || amountPaise > MAX_PAISE)) throw new LedgerError('Amount is not valid')
  if (note != null && String(note).length > 200) throw new LedgerError('Note is too long')
}

const customerOf = (db, shopId, id) => db.prepare('SELECT id, name FROM customers WHERE id = ? AND shop_id = ?').get(id, shopId)
const byKey = (db, key) => db.prepare('SELECT * FROM commitments WHERE idempotency_key = ?').get(key)
const rowOf = (db, shopId, id) => db.prepare('SELECT * FROM commitments WHERE id = ? AND shop_id = ?').get(id, shopId)

// A reminder for the same customer on the same day (or for the same credit entry) is the same obligation: not created twice.
export function createCommitment(db, { shopId, customerId, dueDate, dueTime = null, amountPaise = null, priority = 'medium', note = null, txnId = null, key, now = new Date() }) {
  if (!key) throw new LedgerError('Missing idempotency key')
  check({ dueDate, dueTime, amountPaise, priority, note }, now)
  return tx(db, () => {
    const existing = byKey(db, key)
    if (existing) {
      if (existing.shop_id !== shopId) throw new LedgerError('Idempotency key reused with different data', 'conflict')
      return { duplicate: true, commitment: existing }
    }
    if (!customerOf(db, shopId, customerId)) throw new LedgerError('Unknown customer', 'not_found')
    if (txnId) {
      const t = db.prepare('SELECT customer_id FROM transactions WHERE id = ? AND shop_id = ?').get(txnId, shopId)
      if (!t || t.customer_id !== customerId) throw new LedgerError('That entry belongs to a different customer', 'conflict') // never silently re-attach
    }
    const dup = db.prepare("SELECT * FROM commitments WHERE shop_id = ?1 AND customer_id = ?2 AND status = 'open' AND (due_date = ?3 OR (?4 IS NOT NULL AND txn_id = ?4)) LIMIT 1").get(shopId, customerId, dueDate, txnId)
    if (dup) return { duplicate: true, commitment: dup, reason: 'same_obligation' }
    const id = randomUUID(), at = new Date().toISOString()
    db.prepare(`INSERT INTO commitments (id, shop_id, customer_id, due_date, due_time, amount_paise, priority, note, status, txn_id, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`).run(id, shopId, customerId, dueDate, dueTime, amountPaise, priority, note, txnId, key, at, at)
    log(db, shopId, id, 'created', { dueDate, dueTime, amountPaise, priority })
    return { duplicate: false, commitment: rowOf(db, shopId, id) }
  })
}

// Reschedule / re-prioritise / edit an open commitment. Only the fields that are passed change.
export function updateCommitment(db, { shopId, id, now = new Date(), ...patch }) {
  return tx(db, () => {
    const c = rowOf(db, shopId, id)
    if (!c) throw new LedgerError('Reminder not found', 'not_found')
    if (c.status !== 'open') throw new LedgerError(`That reminder is already ${c.status}`, 'conflict')
    const next = {
      dueDate: patch.dueDate ?? c.due_date, dueTime: patch.dueTime === undefined ? c.due_time : patch.dueTime,
      amountPaise: patch.amountPaise === undefined ? c.amount_paise : patch.amountPaise, priority: patch.priority ?? c.priority,
      note: patch.note === undefined ? c.note : patch.note,
    }
    const dateMoved = next.dueDate !== c.due_date || next.dueTime !== c.due_time
    check(dateMoved ? next : { ...next, dueDate: c.due_date >= istYmd(now) ? c.due_date : istYmd(now), dueTime: null }, now) // priority/note edits stay allowed on overdue items
    if (dateMoved && db.prepare("SELECT 1 FROM commitments WHERE shop_id = ? AND customer_id = ? AND status = 'open' AND due_date = ? AND id != ?").get(shopId, c.customer_id, next.dueDate, id))
      throw new LedgerError('There is already a reminder for that customer on that day', 'conflict')
    db.prepare('UPDATE commitments SET due_date = ?, due_time = ?, amount_paise = ?, priority = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(next.dueDate, next.dueTime, next.amountPaise, next.priority, next.note, new Date().toISOString(), id)
    if (dateMoved) log(db, shopId, id, 'rescheduled', { from: [c.due_date, c.due_time], to: [next.dueDate, next.dueTime] })
    if (next.priority !== c.priority) log(db, shopId, id, 'priority', { from: c.priority, to: next.priority })
    return rowOf(db, shopId, id)
  })
}

export function closeCommitment(db, { shopId, id, status, now = new Date() }) {
  if (!['completed', 'cancelled'].includes(status)) throw new LedgerError('Invalid status')
  return tx(db, () => {
    const c = rowOf(db, shopId, id)
    if (!c) throw new LedgerError('Reminder not found', 'not_found')
    if (c.status !== 'open') throw new LedgerError(`That reminder is already ${c.status}`, 'conflict')
    const at = now.toISOString()
    db.prepare('UPDATE commitments SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(status, at, at, id)
    log(db, shopId, id, status, { late: status === 'completed' && istYmd(now) > c.due_date })
    return rowOf(db, shopId, id)
  })
}

// Enriched rows. urgency is computed; settled = the customer owes nothing now; linked_reversed = the credit it followed was reversed.
export function listCommitments(db, shopId, { status = 'open', sort = 'due', now = new Date() } = {}) {
  const today = istYmd(now)
  const rows = db.prepare(`SELECT c.*, cu.name AS customer_name,
      (SELECT COALESCE(SUM(t.delta_paise), 0) FROM transactions t WHERE t.customer_id = c.customer_id) AS balance_paise,
      (c.txn_id IS NOT NULL AND EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = c.txn_id)) AS linked_reversed
    FROM commitments c JOIN customers cu ON cu.id = c.customer_id
    WHERE c.shop_id = ?1 AND (?2 = 'all' OR c.status = ?2)`).all(shopId, status).map((r) => ({
    ...r,
    linked_reversed: !!r.linked_reversed,
    settled: r.status === 'open' && r.balance_paise <= 0,
    urgency: r.status !== 'open' ? r.status : r.due_date < today ? 'overdue' : r.due_date === today ? 'due_today' : 'upcoming',
    days_overdue: r.status === 'open' && r.due_date < today ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 864e5) : 0,
    late: r.status === 'completed' && !!r.closed_at && istYmd(new Date(r.closed_at)) > r.due_date,
  }))
  const amountKey = (r) => r.amount_paise ?? Math.max(r.balance_paise, 0)
  const byDue = (a, b) => a.due_date.localeCompare(b.due_date) || (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99') || RANK[a.priority] - RANK[b.priority] || a.id.localeCompare(b.id)
  const order = {
    due: byDue,
    amount: (a, b) => amountKey(b) - amountKey(a) || byDue(a, b),
    priority: (a, b) => RANK[a.priority] - RANK[b.priority] || byDue(a, b),
  }[sort] ?? byDue
  return rows.sort(order)
}

export const commitmentHistory = (db, shopId, id) =>
  db.prepare('SELECT ts, event, detail FROM commitment_history WHERE shop_id = ? AND commitment_id = ? ORDER BY id').all(shopId, id)

// ---- in-app notifications. The server only records WHAT is due and WHAT was already delivered. A future always-on
// scheduler can call dueNotifications()/ackNotification() unchanged; today the open app does, so nothing is sent while it is closed.
const fireKey = (c) => `${c.due_date}T${c.due_time ?? '00:00'}`

export function dueNotifications(db, shopId, now = new Date()) {
  const today = istYmd(now), hm = istHm(now)
  return listCommitments(db, shopId, { now })
    .filter((c) => (c.due_date < today || (c.due_date === today && (!c.due_time || c.due_time <= hm))) && !c.settled && !c.linked_reversed) // no false alarms for settled or reversed items
    .map((c) => ({ ...c, fire_key: fireKey(c) }))
    .filter((c) => !db.prepare("SELECT 1 FROM notification_deliveries WHERE commitment_id = ? AND fire_key = ? AND channel = 'in_app'").get(c.id, c.fire_key))
}

export function ackNotification(db, { shopId, commitmentId, key, now = new Date() }) {
  return tx(db, () => {
    const c = rowOf(db, shopId, commitmentId)
    if (!c || c.status !== 'open') return { ok: false, reason: 'not_open' }
    if (fireKey(c) !== key) return { ok: false, reason: 'stale' } // it was rescheduled since: that notice no longer counts
    const r = db.prepare("INSERT OR IGNORE INTO notification_deliveries (commitment_id, shop_id, fire_key, channel, delivered_at) VALUES (?, ?, ?, 'in_app', ?)").run(commitmentId, shopId, key, now.toISOString())
    if (r.changes) log(db, shopId, commitmentId, 'notified', { key })
    return { ok: true, duplicate: r.changes === 0 }
  })
}

export { addDays }
