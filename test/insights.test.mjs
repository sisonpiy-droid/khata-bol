import assert from 'node:assert/strict'
import { stats, creditWarning, chaseList } from '../src/lib/insights.js'

const D = 864e5, now = Date.now()
const tx = (cid, type, amount, ago) => ({ cid, type, amount, ts: now - ago * D })
const txns = [
  tx('a', 'credit', 500, 20), tx('a', 'credit', 300, 10), tx('a', 'payment', 500, 8), // a: 500 cleared in 12d, 300 open 10d
  tx('b', 'credit', 100, 2),
]
const s = stats(txns, 'a', now)
assert.equal(s.balance, 300)
assert.equal(s.oldestDays, 10)
assert.equal(s.avgDays, 12)
assert.equal(creditWarning(txns, 'a', 800)?.balance, 300) // 300 + 800 >= 1000
assert.equal(creditWarning(txns, 'b', 50), null)
assert.equal(creditWarning(txns, null, 50), null)
assert.equal(chaseList([{ id: 'a' }, { id: 'b' }], txns)[0].c.id, 'a')
console.log('insights ok')
