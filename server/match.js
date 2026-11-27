const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')

export function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

export function score(x, y) {
  const a = norm(x), b = norm(y)
  if (!a || !b) return 0
  if (a === b) return 1
  const s = 1 - lev(a, b) / Math.max(a.length, b.length)
  return a.startsWith(b) || b.startsWith(a) ? Math.max(s, 0.8) : s
}

const STRONG = 0.7 // confident enough to use one customer
const PLAUSIBLE = 0.55 // similar enough that silently creating a NEW customer would be wrong

// -> {status:'match',customer}
//  | {status:'ambiguous',candidates}   two or more customers fit (including identical names)
//  | {status:'maybe',candidates,name}  only a plausible match: the user must pick it or say it is new
//  | {status:'new'}
export function matchCustomer(name, customers) {
  const ranked = customers
    .map((c) => ({ c, s: score(name, c.name) }))
    .filter((x) => x.s >= PLAUSIBLE)
    .sort((p, q) => q.s - p.s)
  if (!ranked.length) return { status: 'new' }
  const exact = ranked.filter((x) => x.s === 1)
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact.slice(0, 3).map((x) => x.c) } // duplicate names: never pick for the user
  if (exact.length === 1) return { status: 'match', customer: exact[0].c }
  if (ranked[0].s < STRONG) return { status: 'maybe', candidates: ranked.slice(0, 2).map((x) => x.c), name }
  const close = ranked.filter((x) => x.s >= STRONG && ranked[0].s - x.s <= 0.15)
  return close.length > 1
    ? { status: 'ambiguous', candidates: close.slice(0, 3).map((x) => x.c) }
    : { status: 'match', customer: ranked[0].c }
}
