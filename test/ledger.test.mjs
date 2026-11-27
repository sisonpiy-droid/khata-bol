import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db.js'
import * as L from '../server/ledger.js'
import { converse } from '../server/dialog.js'
import { createApp } from '../server/app.js'

delete process.env.ANTHROPIC_API_KEY
delete process.env.GEMINI_API_KEY

const SESSION = 'session-test-1'
// A fresh database plus one visitor's private demo shop.
const fresh = () => { const db = openDb(':memory:'); return { db, shop: L.shopFor(db, SESSION) } }
const id = ({ db, shop }, name) => L.listCustomers(db, shop).find((c) => c.name === name).id
const commit = ({ db, shop }, o) => L.commitEntry(db, { shopId: shop, ...o })
const talk = ({ db }, text, extra = {}) => converse(db, { session: SESSION, text, lang: 'hi-IN', ...extra })

test('credit then repayment: balances come from stored rows', () => {
  const t = fresh(), r = id(t, 'Ramesh')
  assert.equal(L.balanceOf(t.db, r), 0) // demo starts Ramesh at zero
  assert.equal(commit(t, { customerId: r, type: 'credit', amountPaise: 50000, key: 'a' }).balance_paise, 50000)
  assert.equal(commit(t, { customerId: r, type: 'payment', amountPaise: 20000, key: 'b' }).balance_paise, 30000)
})

test('same idempotency key never creates a second entry', () => {
  const t = fresh(), r = id(t, 'Ramesh')
  commit(t, { customerId: r, type: 'credit', amountPaise: 50000, key: 'dup' })
  const again = commit(t, { customerId: r, type: 'credit', amountPaise: 50000, key: 'dup' })
  assert.equal(again.duplicate, true)
  assert.equal(L.balanceOf(t.db, r), 50000)
  assert.throws(() => commit(t, { customerId: r, type: 'credit', amountPaise: 99, key: 'dup' }), /different data/)
})

test('invalid amounts are rejected by the backend', () => {
  const t = fresh(), r = id(t, 'Ramesh')
  for (const amountPaise of [0, -5, 1.5, 100_000_001, NaN, '500'])
    assert.throws(() => commit(t, { customerId: r, type: 'credit', amountPaise, key: `k${amountPaise}` }), /Amount/)
  assert.throws(() => commit(t, { customerId: r, type: 'refund', amountPaise: 100, key: 'x' }), /Type/)
})

test('reversal is a linked row; history stays; double reversal blocked', () => {
  const t = fresh(), r = id(t, 'Ramesh')
  const row = commit(t, { customerId: r, type: 'credit', amountPaise: 70000, key: 'c1' }).txn
  const rev = L.reverseTxn(t.db, { shopId: t.shop, txnId: row.id, key: 'r1' })
  assert.equal(rev.balance_paise, 0)
  assert.equal(L.history(t.db, t.shop, { customerId: r }).find((h) => h.id === row.id).reversed, 1)
  assert.throws(() => L.reverseTxn(t.db, { shopId: t.shop, txnId: row.id, key: 'r2' }), /already reversed/)
  assert.throws(() => t.db.prepare('UPDATE transactions SET amount_paise = 1').run(), /immutable/)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_events WHERE event = 'reversed'").get())
})

test('daily summary counts real rows and skips reversed ones', () => {
  const t = fresh(), r = id(t, 'Suresh')
  commit(t, { customerId: r, type: 'credit', amountPaise: 200000, key: 's1' })
  commit(t, { customerId: r, type: 'payment', amountPaise: 80000, key: 's2' })
  commit(t, { customerId: r, type: 'credit', amountPaise: 5000, key: 's3' })
  L.reverseTxn(t.db, { shopId: t.shop, txnId: L.history(t.db, t.shop, { customerId: r })[0].id, key: 's4' })
  assert.deepEqual(L.todaySummary(t.db, t.shop), { credit_paise: 200000, payment_paise: 80000, count: 2 })
})

test('reset only works on a demo shop', () => {
  const t = fresh()
  t.db.prepare('UPDATE shops SET is_demo = 0').run()
  assert.throws(() => L.resetDemo(t.db, t.shop), /demo mode/)
  assert.throws(() => t.db.prepare('DELETE FROM transactions').run(), /only demo/)
})

test('full journey: credit needs a yes, repayment, balance, follow-up uses context', async () => {
  const t = fresh(), r = id(t, 'Ramesh')
  let x = await talk(t, 'Ramesh ko paanch sau rupaye udhaar diye.')
  assert.equal(x.state, 'awaiting_confirmation')
  assert.match(x.say, /Ramesh ke khate mein 500 rupaye udhaar add karun\?/)
  assert.equal(L.balanceOf(t.db, r), 0) // nothing saved before confirmation
  x = await talk(t, 'Haan.')
  assert.match(x.say, /Ho gaya.*500 rupaye add ho gaye.*balance 500 rupaye/)
  x = await talk(t, 'Ramesh ne 200 rupaye wapas diye.')
  assert.match(x.say, /Ramesh se 200 rupaye ki payment record karun\?/)
  x = await talk(t, 'haan')
  assert.match(x.say, /Payment record ho gayi.*300 rupaye baaki/)
  x = await talk(t, 'Ramesh ka kitna baaki hai?')
  assert.match(x.say, /Ramesh ke 300 rupaye baaki hain/)
  x = await talk(t, 'Ab kitna baaki hai?') // "ab" -> Ramesh from context
  assert.match(x.say, /Ramesh ke 300 rupaye baaki hain/)
  assert.equal(L.balanceOf(t.db, r), 30000)
})

test('cancel and plain "nahi" never save', async () => {
  const t = fresh(), r = id(t, 'Ramesh')
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye'); await talk(t, 'Cancel karo.')
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye'); await talk(t, 'Nahi.')
  assert.equal(L.balanceOf(t.db, r), 0)
  assert.equal((await talk(t, 'haan')).state, 'idle') // a stray yes confirms nothing
  assert.equal(L.balanceOf(t.db, r), 0)
})

test('correction changes the pending amount, saves only the corrected one', async () => {
  const t = fresh(), r = id(t, 'Ramesh')
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  const x = await talk(t, 'Nahi, 300 rupaye.')
  assert.match(x.say, /Samajh gaya\. Ramesh ke khate mein 300 rupaye udhaar add karun\?/)
  await talk(t, 'haan')
  assert.equal(L.balanceOf(t.db, r), 30000)
})

test('ambiguous name asks, then keeps amount and type', async () => {
  const t = fresh()
  let x = await talk(t, 'Rameshwr ko 200 rupaye udhaar diye')
  assert.equal(x.state, 'awaiting_clarification')
  assert.match(x.say, /Aap Ramesh ki baat kar rahe hain ya Rameshwar ki\?/)
  x = await talk(t, 'Rameshwar.')
  assert.match(x.say, /Rameshwar ke khate mein 200 rupaye udhaar add karun\?/)
  const before = L.balanceOf(t.db, id(t, 'Rameshwar'))
  await talk(t, 'haan')
  assert.equal(L.balanceOf(t.db, id(t, 'Rameshwar')), before + 20000)
  assert.equal(L.balanceOf(t.db, id(t, 'Ramesh')), 0)
})

test('missing amount and missing name are asked specifically', async () => {
  const t = fresh()
  let x = await talk(t, 'Ramesh ko udhaar diye')
  assert.match(x.say, /kitne rupaye\?/)
  x = await talk(t, 'do sau')
  assert.match(x.say, /200 rupaye udhaar add karun\?/)
  await talk(t, 'cancel')
  x = await talk(t, '500 rupaye udhaar diye')
  assert.match(x.say, /Kis customer ka naam hai\?/)
  x = await talk(t, 'Suresh')
  assert.match(x.say, /Suresh ke khate mein 500 rupaye/)
})

test('unclear speech asks again without losing the pending entry', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  const x = await talk(t, 'mmm blah')
  assert.match(x.say, /Maaf kijiye, dobara boliye\./)
  assert.equal(x.state, 'awaiting_confirmation')
})

test('confirm button submitted twice saves once', async () => {
  const t = fresh(), r = id(t, 'Ramesh')
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  await talk(t, '', { action: 'confirm' }); await talk(t, '', { action: 'confirm' })
  assert.equal(L.balanceOf(t.db, r), 50000)
})

test('spoken reversal needs confirmation and keeps history', async () => {
  const t = fresh(), r = id(t, 'Ramesh')
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye'); await talk(t, 'haan')
  let x = await talk(t, 'Pichhli entry galat thi.')
  assert.match(x.say, /Isse reverse karun\?/)
  assert.equal(L.balanceOf(t.db, r), 50000)
  x = await talk(t, 'haan')
  assert.match(x.say, /Entry reverse kar di/)
  assert.equal(L.balanceOf(t.db, r), 0)
  assert.equal(L.history(t.db, t.shop, { customerId: r }).length, 4) // 2 demo + credit + reversal
})

test('daily summary by voice, and English works too', async () => {
  const t = fresh()
  await talk(t, 'Suresh ko 2000 rupaye udhaar diye'); await talk(t, 'haan')
  await talk(t, 'Kavita ne 800 rupaye wapas diye'); await talk(t, 'haan')
  assert.match((await talk(t, 'Aaj ka hisaab batao.')).say, /Aaj 2000 rupaye ka udhaar diya gaya aur 800 rupaye ki payment receive hui\./)
  const e = await converse(t.db, { session: SESSION, text: 'How much does Suresh owe me?', lang: 'en-IN' })
  assert.match(e.say, /Suresh owes 2450 rupees\./)
})

test('unknown language without AI explains the limitation', async () => {
  const t = fresh()
  const x = await talk(t, 'ನಮಸ್ಕಾರ ಹೇಗಿದ್ದೀರಿ', { lang: 'kn-IN' })
  assert.match(x.say, /AI enhancement/)
})

test('two visitors never see or change each other\'s ledger or conversation', async () => {
  const db = openDb(':memory:')
  const A = 'visitor-aaaaaaaa', B = 'visitor-bbbbbbbb'
  await converse(db, { session: A, text: 'Ramesh ko 500 rupaye udhaar diye', lang: 'hi-IN' })
  // B has not confirmed anything: A's pending entry must not be B's, and B's "haan" must save nothing.
  assert.match((await converse(db, { session: B, text: 'haan', lang: 'hi-IN' })).say, /pending nahi/)
  await converse(db, { session: A, text: 'haan', lang: 'hi-IN' })
  const shopA = L.shopFor(db, A), shopB = L.shopFor(db, B)
  assert.notEqual(shopA, shopB)
  const bal = (shop) => L.listCustomers(db, shop).find((c) => c.name === 'Ramesh').balance_paise
  assert.equal(bal(shopA), 50000)
  assert.equal(bal(shopB), 0) // B's demo still starts at zero
  assert.equal(L.history(db, shopB).some((h) => h.synthetic === 0), false)
  const aEntry = L.history(db, shopA)[0]
  assert.throws(() => L.reverseTxn(db, { shopId: shopB, txnId: aEntry.id, key: 'x' }), /not found/) // cannot touch A's entry by id
  assert.equal(L.entryById(db, shopB, aEntry.id), undefined)
  L.resetDemo(db, shopB)
  assert.equal(bal(shopA), 50000) // B's reset leaves A alone
})

test('stale demo shops are pruned, active ones kept', () => {
  const db = openDb(':memory:')
  const old = L.shopFor(db, 'visitor-oldoldold'), live = L.shopFor(db, 'visitor-liveliveli')
  db.prepare('UPDATE shops SET last_seen = ? WHERE id = ?').run(new Date(Date.now() - 30 * 864e5).toISOString(), old)
  L.pruneStale(db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shops WHERE id = ?').get(old).n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE shop_id = ?').get(old).n, 0)
  assert.ok(L.listCustomers(db, live).length === 5)
})

test('invalid session ids are rejected', async () => {
  const db = openDb(':memory:')
  await assert.rejects(() => converse(db, { session: 'x', text: 'hi' }), /Invalid session/)
  assert.throws(() => L.shopFor(db, '../etc/passwd'), /Invalid session/)
})

async function request(app, path, headers = {}, method = 'GET', body) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
  } finally { server.close() }
}

test('health endpoint answers without a session; API needs one; mic header allowed', async () => {
  const app = createApp(openDb(':memory:'))
  const h = await request(app, '/health')
  assert.deepEqual([h.status, h.body.ok], [200, true])
  assert.equal(h.headers.get('permissions-policy'), 'microphone=(self)')
  assert.equal((await request(app, '/api/state')).status, 400) // no session -> no ledger
  const s = await request(app, '/api/state', { 'x-session': 'visitor-httphttp' })
  assert.equal(s.status, 200)
  assert.equal(s.body.shop.name, 'Sharma Kirana Store')
  assert.equal(s.body.customers.length, 5)
})

test('data survives a restart, and the app starts with no keys', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'khata-')), 'k.db')
  let db = openDb(path); createApp(db)
  const shop = L.shopFor(db, SESSION)
  L.commitEntry(db, { shopId: shop, customerId: L.listCustomers(db, shop).find((c) => c.name === 'Ramesh').id, type: 'credit', amountPaise: 12300, key: 'persist' })
  db.close()
  db = openDb(path); createApp(db)
  const again = L.shopFor(db, SESSION)
  assert.equal(again, shop) // same visitor, same shop
  assert.equal(L.listCustomers(db, again).find((c) => c.name === 'Ramesh').balance_paise, 12300)
  assert.equal(L.listCustomers(db, again).length, 5) // not reseeded
})
