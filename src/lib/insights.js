const DAY = 864e5

// FIFO: payments clear the oldest credits first.
export function stats(txns, cid, now = Date.now()) {
  const open = []
  const paidIn = [] // days it took to clear each credit
  let balance = 0
  for (const t of txns.filter((x) => x.cid === cid).sort((a, b) => a.ts - b.ts)) {
    if (t.type === 'credit') { open.push({ amt: t.amount, ts: t.ts }); balance += t.amount; continue }
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
  }
}

// Returns {balance, oldestDays} when adding `amount` credit looks risky, else null.
export function creditWarning(txns, cid, amount) {
  if (!cid) return null
  const s = stats(txns, cid)
  return s.balance > 0 && (s.oldestDays >= 14 || s.balance + amount >= 1000) ? s : null
}

// Who to chase first: big and old dues rank highest.
export function chaseList(customers, txns, n = 3) {
  return customers
    .map((c) => ({ c, ...stats(txns, c.id) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance * (1 + b.oldestDays / 14) - a.balance * (1 + a.oldestDays / 14))
    .slice(0, n)
}
