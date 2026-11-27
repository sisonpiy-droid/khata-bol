import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../server/db.js'
import * as L from '../server/ledger.js'
import * as F from '../server/follow.js'
import { dailyReport, weeklyReport } from '../server/reports.js'

// Fixed clock: Thursday 1 January 2026, 12:00 India time.
const NOW = new Date('2026-01-01T06:30:00Z')
const A = 'follow-session-aaa', B = 'follow-session-bbb'

function rig(session = A) {
  const db = openDb(':memory:'), shop = L.shopFor(db, session)
  db.exec('DELETE FROM commitment_history; DELETE FROM commitments;') // start without the demo's own follow-ups
  const cid = (name) => L.listCustomers(db, shop).find((c) => c.name === name).id
  let n = 0
  const credit = (name, rupees, ts, type = 'credit') => L.commitEntry(db, { shopId: shop, customerId: cid(name), type, amountPaise: rupees * 100, key: `k${++n}`, ts })
  const follow = (name, due, extra = {}) => F.createCommitment(db, { shopId: shop, customerId: cid(name), dueDate: due, key: `f${++n}`, now: NOW, ...extra })
  return { db, shop, cid, credit, follow, bal: (name) => L.balanceOf(db, cid(name)) }
}

// ---------------------------------------------------------------- reports
test('daily report: totals from real rows, IST day boundaries, net reconciles with balances', () => {
  const r = rig()
  r.credit('Ramesh', 900, '2025-12-31T18:25:00Z') // 23:55 IST on Dec 31: yesterday
  r.credit('Ramesh', 500, '2025-12-31T18:35:00Z') // 00:05 IST on Jan 1: today
  r.credit('Ramesh', 200, '2026-01-01T05:00:00Z', 'payment') // 10:30 IST today
  const d = dailyReport(r.db, r.shop, NOW)
  assert.equal(d.credit_paise, 50000)
  assert.equal(d.payment_paise, 20000)
  assert.equal(d.net_paise, 30000) // +500 - 200
  const y = dailyReport(r.db, r.shop, NOW, '2025-12-31')
  assert.equal(y.credit_paise, 90000)
  assert.equal(y.is_today, false)
  assert.equal(d.outstanding_paise, L.stats(r.db, r.shop).outstanding_paise)
})

test('a reversed credit is not counted, and a reversal of an older entry shows as a net decrease', () => {
  const r = rig()
  const old = r.credit('Suresh', 300, new Date(Date.now() - 2 * 864e5).toISOString()).txn // two days ago
  const today = r.credit('Ramesh', 400, new Date().toISOString()).txn // right now, on the real clock the ledger stamps reversals with
  L.reverseTxn(r.db, { shopId: r.shop, txnId: today.id, key: 'rev1' })
  L.reverseTxn(r.db, { shopId: r.shop, txnId: old.id, key: 'rev2' })
  const d = dailyReport(r.db, r.shop, new Date())
  assert.equal(d.credit_paise, 0)
  assert.equal(d.net_paise, -30000) // today's 400 and its reversal cancel; reversing the older 300 lowers what is owed
  assert.equal(d.entries, 0)
})

test('weekly report: rolling seven days, top customers, completed reminders, collection rate', () => {
  const r = rig()
  r.credit('Ramesh', 1000, '2025-12-26T10:00:00Z') // inside (Dec 26 = day 7 of the window)
  r.credit('Ramesh', 700, '2025-12-25T10:00:00Z') // outside: 8th day back
  r.credit('Priya', 250, '2025-12-29T10:00:00Z')
  r.credit('Ramesh', 400, '2025-12-31T10:00:00Z', 'payment')
  const f = r.follow('Ramesh', '2026-01-01', { amountPaise: 100000 }) // expected 1000, paid 400 -> 40%
  F.closeCommitment(r.db, { shopId: r.shop, id: F.createCommitment(r.db, { shopId: r.shop, customerId: r.cid('Priya'), dueDate: '2026-01-03', key: 'pf', now: NOW }).commitment.id, status: 'completed', now: NOW })
  const w = weeklyReport(r.db, r.shop, NOW)
  assert.deepEqual([w.from, w.to], ['2025-12-26', '2026-01-01'])
  assert.equal(w.credit_paise, 125000) // 1000 + 250, not the 700 outside the window
  assert.equal(w.payment_paise, 40000)
  assert.equal(w.net_paise, 85000)
  assert.equal(w.reminders_completed, 1)
  assert.deepEqual(w.collection, { expected_paise: 100000, collected_paise: 40000, rate_percent: 40 })
  assert.ok(w.top_customers[0].balance_paise >= w.top_customers.at(-1).balance_paise) // biggest first
  assert.ok(f.commitment)
})

// ---------------------------------------------------------------- commitments
test('creating a commitment validates dates, priority, customer and amount', () => {
  const r = rig()
  const bad = (o, re) => assert.throws(() => r.follow('Ramesh', o.due ?? '2026-01-05', o), re)
  bad({ due: '2025-12-31' }, /already passed/) // past date
  bad({ due: '2026-02-30' }, /valid date/)
  bad({ due: 'kal' }, /valid date/)
  bad({ priority: 'urgent' }, /high, medium or low/)
  bad({ dueTime: '25:99' }, /valid time/)
  bad({ amountPaise: -5 }, /Amount/)
  bad({ amountPaise: 1.5 }, /Amount/)
  assert.throws(() => F.createCommitment(r.db, { shopId: r.shop, customerId: 99999, dueDate: '2026-01-05', key: 'x', now: NOW }), /Unknown customer/)
  bad({ due: '2026-01-01', dueTime: '09:00' }, /already passed/) // today, but 9:00 is before the current time (12:00)
  assert.ok(r.follow('Ramesh', '2026-01-01', { dueTime: '18:00' }).commitment) // later today is fine
})

test('duplicate obligations and repeated requests create one reminder', () => {
  const r = rig()
  const first = r.follow('Ramesh', '2026-01-05')
  const again = r.follow('Ramesh', '2026-01-05')
  assert.equal(again.duplicate, true)
  assert.equal(again.commitment.id, first.commitment.id)
  const key = F.createCommitment(r.db, { shopId: r.shop, customerId: r.cid('Priya'), dueDate: '2026-01-06', key: 'same-key', now: NOW })
  assert.equal(F.createCommitment(r.db, { shopId: r.shop, customerId: r.cid('Priya'), dueDate: '2026-01-06', key: 'same-key', now: NOW }).commitment.id, key.commitment.id)
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM commitments').get().n, 2)
  // the same credit entry cannot get two reminders either
  const t = r.credit('Suresh', 100, '2025-12-30T10:00:00Z').txn
  r.follow('Suresh', '2026-01-08', { txnId: t.id })
  assert.equal(r.follow('Suresh', '2026-01-09', { txnId: t.id }).duplicate, true)
})

test('a reminder can never be tied to another customer\'s entry', () => {
  const r = rig()
  const t = r.credit('Suresh', 100, '2025-12-30T10:00:00Z').txn
  assert.throws(() => r.follow('Ramesh', '2026-01-08', { txnId: t.id }), /different customer/)
})

test('reminders never change a balance', () => {
  const r = rig()
  const before = L.listCustomers(r.db, r.shop).map((c) => c.balance_paise)
  r.follow('Ramesh', '2026-01-05', { amountPaise: 99900, priority: 'high' })
  F.updateCommitment(r.db, { shopId: r.shop, id: F.listCommitments(r.db, r.shop, { now: NOW })[0].id, dueDate: '2026-01-09', now: NOW })
  assert.deepEqual(L.listCustomers(r.db, r.shop).map((c) => c.balance_paise), before)
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE synthetic = 0').get().n, 0)
})

test('edit, reschedule, complete and cancel, with history; closed ones are final', () => {
  const r = rig()
  const id = r.follow('Ramesh', '2026-01-05').commitment.id
  F.updateCommitment(r.db, { shopId: r.shop, id, priority: 'high', now: NOW })
  F.updateCommitment(r.db, { shopId: r.shop, id, dueDate: '2026-01-07', dueTime: '10:00', now: NOW })
  assert.throws(() => F.updateCommitment(r.db, { shopId: r.shop, id, dueDate: '2025-12-01', now: NOW }), /already passed/)
  F.closeCommitment(r.db, { shopId: r.shop, id, status: 'completed', now: new Date('2026-01-09T06:30:00Z') }) // two days after the due date
  assert.throws(() => F.closeCommitment(r.db, { shopId: r.shop, id, status: 'cancelled', now: NOW }), /already completed/)
  assert.throws(() => F.updateCommitment(r.db, { shopId: r.shop, id, priority: 'low', now: NOW }), /already completed/)
  const done = F.listCommitments(r.db, r.shop, { status: 'completed', now: NOW })
  assert.equal(done[0].late, true) // paid after the due date
  assert.deepEqual(F.commitmentHistory(r.db, r.shop, id).map((h) => h.event), ['created', 'priority', 'rescheduled', 'completed'])
  const c2 = r.follow('Priya', '2026-01-04').commitment.id
  F.closeCommitment(r.db, { shopId: r.shop, id: c2, status: 'cancelled', now: NOW })
  assert.equal(F.listCommitments(r.db, r.shop, { now: NOW }).length, 0) // no open ones left
})

test('urgency is computed from the date; chosen priority is never rewritten; sorting is deterministic', () => {
  const r = rig()
  r.follow('Suresh', '2026-01-01', { priority: 'low', amountPaise: 30000 }) // due today
  r.follow('Priya', '2026-01-04', { priority: 'high', amountPaise: 90000 })
  r.follow('Kavita', '2026-01-02', { priority: 'medium', amountPaise: 60000 })
  r.db.prepare("INSERT INTO commitments (id, shop_id, customer_id, due_date, priority, status, idempotency_key, created_at, updated_at) VALUES ('old', ?, ?, '2025-12-29', 'low', 'open', 'oldk', 'x', 'x')").run(r.shop, r.cid('Ramesh')) // overdue, low
  const by = (sort) => F.listCommitments(r.db, r.shop, { sort, now: NOW }).map((c) => c.customer_name)
  assert.deepEqual(by('due'), ['Ramesh', 'Suresh', 'Kavita', 'Priya'])
  assert.deepEqual(by('priority'), ['Priya', 'Kavita', 'Ramesh', 'Suresh']) // high, medium, then low by date
  assert.deepEqual(by('amount').slice(0, 3), ['Priya', 'Kavita', 'Suresh'])
  const rows = F.listCommitments(r.db, r.shop, { now: NOW })
  assert.equal(rows.find((c) => c.customer_name === 'Ramesh').urgency, 'overdue')
  assert.equal(rows.find((c) => c.customer_name === 'Ramesh').priority, 'low') // overdue does not turn it into high
  assert.equal(rows.find((c) => c.customer_name === 'Suresh').urgency, 'due_today')
  assert.equal(rows.find((c) => c.customer_name === 'Priya').urgency, 'upcoming')
})

test('settled balances and reversed credits are flagged and never notify', () => {
  const r = rig()
  const t = r.credit('Suresh', 100, '2025-12-30T10:00:00Z').txn // Suresh owes 450 + 100 in the demo
  r.credit('Suresh', 550, '2025-12-30T11:00:00Z', 'payment') // settles Suresh completely
  r.follow('Suresh', '2026-01-01')
  r.credit('Ramesh', 500, '2025-12-30T10:00:00Z')
  const rt = r.credit('Ramesh', 50, '2025-12-30T12:00:00Z').txn
  r.follow('Ramesh', '2026-01-01', { txnId: rt.id })
  L.reverseTxn(r.db, { shopId: r.shop, txnId: rt.id, key: 'rev-x' })
  r.follow('Kavita', '2026-01-01') // Kavita genuinely owes 800
  const rows = F.listCommitments(r.db, r.shop, { now: NOW })
  assert.equal(rows.find((c) => c.customer_name === 'Suresh').settled, true) // "already paid": offer to complete
  assert.equal(rows.find((c) => c.customer_name === 'Ramesh').linked_reversed, true)
  assert.deepEqual(F.dueNotifications(r.db, r.shop, NOW).map((n) => n.customer_name), ['Kavita']) // only the real one
  assert.ok(t)
})

test('notifications fire once per scheduled time, survive restarts, and stale acks are ignored', () => {
  const r = rig()
  r.credit('Kavita', 100, '2025-12-30T10:00:00Z')
  const id = r.follow('Kavita', '2026-01-01', { dueTime: '11:00', now: new Date('2026-01-01T03:00:00Z') }).commitment.id // set at 08:30 IST for 11:00
  r.follow('Priya', '2026-01-03')
  const [n] = F.dueNotifications(r.db, r.shop, NOW)
  assert.equal(n.fire_key, '2026-01-01T11:00')
  assert.equal(F.dueNotifications(r.db, r.shop, new Date('2026-01-01T04:00:00Z')).length, 0) // 09:30 IST: not time yet
  assert.deepEqual(F.ackNotification(r.db, { shopId: r.shop, commitmentId: id, key: n.fire_key, now: NOW }), { ok: true, duplicate: false })
  assert.deepEqual(F.ackNotification(r.db, { shopId: r.shop, commitmentId: id, key: n.fire_key, now: NOW }), { ok: true, duplicate: true }) // repeated checks: no second delivery
  assert.equal(F.dueNotifications(r.db, r.shop, NOW).length, 0)
  F.updateCommitment(r.db, { shopId: r.shop, id, dueDate: '2026-01-01', dueTime: '18:00', now: NOW }) // rescheduled later today
  assert.equal(F.ackNotification(r.db, { shopId: r.shop, commitmentId: id, key: '2026-01-01T11:00', now: NOW }).reason, 'stale')
  assert.equal(F.dueNotifications(r.db, r.shop, new Date('2026-01-01T13:00:00Z')).length, 1) // fires again at the new time
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM notification_deliveries').get().n, 1)
})

test('visitors cannot see, edit or close each other\'s reminders', () => {
  const a = rig(A)
  const id = a.follow('Ramesh', '2026-01-05').commitment.id
  const shopB = L.shopFor(a.db, B)
  assert.equal(F.listCommitments(a.db, shopB, { now: NOW }).some((c) => c.id === id), false)
  assert.throws(() => F.updateCommitment(a.db, { shopId: shopB, id, priority: 'low', now: NOW }), /not found/)
  assert.throws(() => F.closeCommitment(a.db, { shopId: shopB, id, status: 'cancelled', now: NOW }), /not found/)
  assert.equal(F.ackNotification(a.db, { shopId: shopB, commitmentId: id, key: '2026-01-05T00:00', now: NOW }).ok, false)
  assert.deepEqual(F.commitmentHistory(a.db, shopB, id), [])
})

test('resetting the demo removes follow-ups and restores the synthetic ones', () => {
  const r = rig()
  r.follow('Ramesh', '2026-01-05')
  L.resetDemo(r.db, r.shop)
  const rows = F.listCommitments(r.db, r.shop)
  assert.equal(rows.length, 3) // the three synthetic demo follow-ups
  assert.equal(rows.some((c) => c.customer_name === 'Ramesh'), false)
})
