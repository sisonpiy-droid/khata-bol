const DAY = 864e5

// FIFO: payments clear the oldest credits first.
export function stats(txns, cid, now = Date.now()) {
  const open = []
  const paidIn = [] // days it took to clear each credit
  const credits = []
  let balance = 0
  for (const t of txns.filter((x) => x.cid === cid).sort((a, b) => a.ts - b.ts)) {
    if (t.type === 'credit') { open.push({ amt: t.amount, ts: t.ts }); credits.push(t.amount); balance += t.amount; continue }
    balance -= t.amount
    let left = t.amount
    while (left > 0 && open.length) {
      const take = Math.min(left, open[0].amt)
      open[0].amt -= take; left -= take
      if (open[0].amt === 0) paidIn.push((t.ts - open.shift().ts) / DAY)
    }
  }
  return {
    balance,
    oldestDays: open.length ? Math.floor((now - open[0].ts) / DAY) : 0,
    avgDays: paidIn.length ? Math.round(paidIn.reduce((s, d) => s + d, 0) / paidIn.length) : null,
    avgTicket: credits.length ? credits.reduce((s, a) => s + a, 0) / credits.length : 0,
  }
}

// Khata score 5..100 from repayment speed, age of oldest due and size of dues, plus a suggested credit limit.
// ponytail: hand-tuned heuristic, not a bureau score; calibrate with real shop data before trusting it.
export function trust(txns, cid, now = Date.now()) {
  const s = stats(txns, cid, now)
  let score = 100
  score -= s.avgDays == null ? 10 : Math.min(40, Math.max(0, s.avgDays - 7) * 2)
  score -= Math.min(35, s.oldestDays * 1.5)
  score -= s.balance > 2000 ? 15 : s.balance > 1000 ? 8 : 0
  score = Math.round(Math.max(5, Math.min(100, score)))
  const limit = Math.max(300, Math.round(((s.avgTicket || 150) * 3 * score) / 100 / 50) * 50)
  const tone = score >= 75 ? 'good' : score >= 50 ? 'mid' : 'bad'
  return { ...s, score, limit, tone, label: { good: 'Reliable', mid: 'Watch', bad: 'Risky' }[tone] }
}

// Returns {balance, oldestDays, limit} when adding `amount` credit looks risky, else null.
export function creditWarning(txns, cid, amount) {
  if (!cid) return null
  const t = trust(txns, cid)
  return t.balance > 0 && (t.oldestDays >= 14 || t.balance + amount > t.limit)
    ? { balance: t.balance, oldestDays: t.oldestDays, limit: t.limit }
    : null
}

// Who to chase first: big and old dues rank highest.
export function chaseList(customers, txns, n = 3) {
  return customers
    .map((c) => ({ c, ...stats(txns, c.id) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance * (1 + b.oldestDays / 14) - a.balance * (1 + a.oldestDays / 14))
    .slice(0, n)
}

// Shop-wide numbers for the dashboard strip.
export function portfolio(customers, txns) {
  const all = customers.map((c) => stats(txns, c.id)).filter((s) => s.balance > 0)
  return {
    owed: all.reduce((s, x) => s + x.balance, 0),
    owing: all.length,
    overdue: all.filter((x) => x.oldestDays >= 14).reduce((s, x) => s + x.balance, 0),
  }
}
