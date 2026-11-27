// Daily and weekly reports. Every figure is a database query over real ledger and commitment rows.
// Nothing is estimated: no sales, profit or cash flow is shown because the ledger does not record them.
import { addDays, dayEndIso, dayStartIso, istYmd } from './dates.js'
import * as L from './ledger.js'
import { listCommitments } from './follow.js'

// Credit given and repayments received in [from, to). A credit that was later reversed is not counted;
// net_paise is the real movement in what customers owe (it includes reversals, so it always reconciles with balances).
function totals(db, shopId, fromIso, toIso) {
  const sum = (type) => db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS s, COUNT(*) AS n FROM transactions t
    WHERE shop_id = ? AND type = ? AND ts >= ? AND ts < ? AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)`).get(shopId, type, fromIso, toIso)
  const c = sum('credit'), p = sum('payment')
  const net = db.prepare('SELECT COALESCE(SUM(delta_paise), 0) AS s FROM transactions WHERE shop_id = ? AND ts >= ? AND ts < ?').get(shopId, fromIso, toIso).s
  return { credit_paise: c.s, payment_paise: p.s, entries: c.n + p.n, net_paise: net }
}

const slim = (c) => ({ id: c.id, customer_id: c.customer_id, customer_name: c.customer_name, due_date: c.due_date, due_time: c.due_time, amount_paise: c.amount_paise, priority: c.priority, balance_paise: c.balance_paise, urgency: c.urgency, settled: c.settled, linked_reversed: c.linked_reversed, days_overdue: c.days_overdue })

export function dailyReport(db, shopId, now = new Date(), day = null) {
  const today = istYmd(now), d = day ?? today
  const open = listCommitments(db, shopId, { now })
  const st = L.stats(db, shopId)
  return {
    kind: 'daily', date: d, is_today: d === today, generated_at: now.toISOString(),
    ...totals(db, shopId, dayStartIso(d), dayEndIso(d)),
    outstanding_paise: st.outstanding_paise, owing_count: st.owing_count,
    due_today: open.filter((c) => c.due_date === d).map(slim),
    overdue: open.filter((c) => c.due_date < d).map(slim),
    upcoming: open.filter((c) => c.due_date > d && c.due_date <= addDays(d, 7)).map(slim),
  }
}

// Rolling seven days: today and the six days before it.
export function weeklyReport(db, shopId, now = new Date()) {
  const to = istYmd(now), from = addDays(to, -6), fromIso = dayStartIso(from), toIso = dayEndIso(to)
  const st = L.stats(db, shopId)
  const open = listCommitments(db, shopId, { now })
  const all = listCommitments(db, shopId, { status: 'all', now })
  const completed = all.filter((c) => c.status === 'completed' && c.closed_at && c.closed_at >= fromIso && c.closed_at < toIso)
  // Collection performance: of the amounts the shopkeeper said they expected to collect on days in this window,
  // how much was actually repaid (per customer, capped at what was expected there). Only commitments with a stated amount count.
  const expectedBy = new Map()
  for (const c of all.filter((x) => x.status !== 'cancelled' && x.due_date >= from && x.due_date <= to && x.amount_paise))
    expectedBy.set(c.customer_id, (expectedBy.get(c.customer_id) ?? 0) + c.amount_paise)
  let expected = 0, collected = 0
  for (const [cid, exp] of expectedBy) {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS s FROM transactions t WHERE shop_id = ? AND customer_id = ? AND type = 'payment' AND ts >= ? AND ts < ?
      AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversed_of = t.id)`).get(shopId, cid, fromIso, toIso).s
    expected += exp; collected += Math.min(paid, exp)
  }
  const overdue = open.filter((c) => c.urgency === 'overdue' && !c.settled)
  return {
    kind: 'weekly', from, to, generated_at: now.toISOString(),
    ...totals(db, shopId, fromIso, toIso),
    outstanding_paise: st.outstanding_paise, owing_count: st.owing_count,
    top_customers: L.listCustomers(db, shopId).filter((c) => c.balance_paise > 0).sort((a, b) => b.balance_paise - a.balance_paise).slice(0, 5),
    overdue: overdue.map(slim),
    overdue_paise: overdue.reduce((s, c) => s + Math.max(c.balance_paise, 0), 0),
    reminders_completed: completed.length,
    completed_on_time: completed.filter((c) => !c.late).length,
    collection: { expected_paise: expected, collected_paise: collected, rate_percent: expected ? Math.round((collected * 100) / expected) : null },
    due_this_week: open.filter((c) => c.due_date >= to && c.due_date <= addDays(to, 6)).map(slim),
  }
}
