// Turns a report question into {key, vars, card}: figures from the database queries, wording chosen later in say.js.
// Nothing here is estimated or invented; "most important first" is the order the facts are placed in `vars`.
import { addDays, istYmd, label } from './dates.js'
import * as L from './ledger.js'
import { listCommitments } from './follow.js'
import { dailyReport, weeklyReport } from './reports.js'

const item = (c) => ({ name: c.customer_name, amount: c.amount_paise ?? Math.max(c.balance_paise, 0), priority: c.priority, due: c.due_date, urgency: c.urgency })
const dayWord = (d, today) => (d === today ? 'today' : d === addDays(today, -1) ? 'yesterday' : d === addDays(today, 1) ? 'tomorrow' : label(d))

export function answer(db, shopId, report, now = new Date()) {
  const today = istYmd(now)
  const open = () => listCommitments(db, shopId, { now }).filter((c) => !c.settled && !c.linked_reversed) // settled / reversed ones are not "payments to collect"
  switch (report.kind) {
    case 'daily': {
      const r = dailyReport(db, shopId, now, report.day ?? today)
      return { key: 'report_daily', vars: { day: dayWord(r.date, today), credit: r.credit_paise, payment: r.payment_paise, entries: r.entries, dueCount: r.due_today.filter((c) => !c.settled).length, overdueCount: r.overdue.filter((c) => !c.settled).length }, card: { kind: 'report', report: r } }
    }
    case 'daily_credit': case 'daily_payment': {
      const r = dailyReport(db, shopId, now, report.day ?? today)
      return { key: report.kind === 'daily_credit' ? 'report_credit' : 'report_payment', vars: { day: dayWord(r.date, today), credit: r.credit_paise, payment: r.payment_paise }, card: { kind: 'report', report: r } }
    }
    case 'weekly': case 'weekly_credit': case 'weekly_payment': {
      const r = weeklyReport(db, shopId, now)
      const key = { weekly: 'report_week', weekly_credit: 'week_credit', weekly_payment: 'week_payment' }[report.kind]
      return { key, vars: { credit: r.credit_paise, payment: r.payment_paise, outstanding: r.outstanding_paise, overdueCount: r.overdue.length, top: r.top_customers[0] ? { name: r.top_customers[0].name, amount: r.top_customers[0].balance_paise } : null }, card: { kind: 'report', report: r } }
    }
    case 'due_list': {
      const d = report.date ?? today
      const rows = open().filter((c) => c.due_date === d && (!report.onlyHigh || c.priority === 'high'))
      return { key: 'due_list', vars: { day: dayWord(d, today), items: rows.map(item), onlyHigh: !!report.onlyHigh }, card: { kind: 'list', title: `Due ${dayWord(d, today)}`, items: rows } }
    }
    case 'overdue_list': case 'overdue_total': {
      const rows = open().filter((c) => c.urgency === 'overdue')
      const total = rows.reduce((s, c) => s + Math.max(c.balance_paise, 0), 0)
      return { key: report.kind === 'overdue_list' ? 'overdue_list' : 'overdue_total', vars: { items: rows.map(item), count: rows.length, total }, card: { kind: 'list', title: 'Overdue', items: rows } }
    }
    case 'top_debtor': {
      const top = L.listCustomers(db, shopId).filter((c) => c.balance_paise > 0).sort((a, b) => b.balance_paise - a.balance_paise)[0]
      return { key: 'top_debtor', vars: { top: top ? { name: top.name, amount: top.balance_paise } : null }, card: top ? { kind: 'balance', customer: { id: top.id, name: top.name }, balance_paise: top.balance_paise } : null }
    }
    case 'collect_first': { // this week's follow-ups in the order to chase: chosen priority first, then date
      const rows = listCommitments(db, shopId, { sort: 'priority', now }).filter((c) => !c.settled && !c.linked_reversed && c.due_date <= addDays(today, 6))
      return { key: 'collect_first', vars: { items: rows.map(item) }, card: { kind: 'list', title: 'Collect first', items: rows } }
    }
    case 'briefing': {
      const r = dailyReport(db, shopId, now)
      const live = (list) => list.filter((c) => !c.settled && !c.linked_reversed)
      const due = live(r.due_today), overdue = live(r.overdue)
      const top = [...due, ...overdue].filter((c) => c.priority === 'high').sort((a, b) => (b.amount_paise ?? b.balance_paise) - (a.amount_paise ?? a.balance_paise))[0]
      return { key: 'briefing', vars: { dueCount: due.length, overdueCount: overdue.length, top: top ? { name: top.customer_name, amount: top.amount_paise ?? Math.max(top.balance_paise, 0) } : null, outstanding: r.outstanding_paise, owing: r.owing_count }, card: { kind: 'report', report: r } }
    }
    default: return null
  }
}
