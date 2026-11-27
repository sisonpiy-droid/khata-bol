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

const fresh = () => { const db = openDb(':memory:'); L.ensureDemo(db); return db }
const id = (db, name) => L.listCustomers(db).find((c) => c.name === name).id
const talk = (db, text, extra = {}) => converse(db, { session: 'session-test-1', text, lang: 'hi-IN', ...extra })

test('credit then repayment: balances come from stored rows', () => {
  const db = fresh(), r = id(db, 'Ramesh')
  assert.equal(L.balanceOf(db, r), 0) // demo starts Ramesh at zero
  assert.equal(L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 50000, key: 'a' }).balance_paise, 50000)
  assert.equal(L.commitEntry(db, { customerId: r, type: 'payment', amountPaise: 20000, key: 'b' }).balance_paise, 30000)
})

test('same idempotency key never creates a second entry', () => {
  const db = fresh(), r = id(db, 'Ramesh')
  L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 50000, key: 'dup' })
  const again = L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 50000, key: 'dup' })
  assert.equal(again.duplicate, true)
  assert.equal(L.balanceOf(db, r), 50000)
  assert.throws(() => L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 99, key: 'dup' }), /different data/)
})

test('invalid amounts are rejected by the backend', () => {
  const db = fresh(), r = id(db, 'Ramesh')
  for (const amountPaise of [0, -5, 1.5, 100_000_001, NaN, '500'])
    assert.throws(() => L.commitEntry(db, { customerId: r, type: 'credit', amountPaise, key: `k${amountPaise}` }), /Amount/)
  assert.throws(() => L.commitEntry(db, { customerId: r, type: 'refund', amountPaise: 100, key: 'x' }), /Type/)
})

test('reversal is a linked row; history stays; double reversal blocked', () => {
  const db = fresh(), r = id(db, 'Ramesh')
  const t = L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 70000, key: 'c1' }).txn
  const rev = L.reverseTxn(db, { txnId: t.id, key: 'r1' })
  assert.equal(rev.balance_paise, 0)
  assert.equal(L.history(db, { customerId: r }).find((h) => h.id === t.id).reversed, 1)
  assert.throws(() => L.reverseTxn(db, { txnId: t.id, key: 'r2' }), /already reversed/)
  assert.throws(() => db.prepare('UPDATE transactions SET amount_paise = 1').run(), /immutable/)
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE event = 'reversed'").get())
})

test('daily summary counts real rows and skips reversed ones', () => {
  const db = fresh(), r = id(db, 'Suresh')
  L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 200000, key: 's1' })
  L.commitEntry(db, { customerId: r, type: 'payment', amountPaise: 80000, key: 's2' })
  L.commitEntry(db, { customerId: r, type: 'credit', amountPaise: 5000, key: 's3' })
  L.reverseTxn(db, { txnId: L.history(db, { customerId: r })[0].id, key: 's4' })
  assert.deepEqual(L.todaySummary(db), { credit_paise: 200000, payment_paise: 80000, count: 2 })
})

test('reset only works on a demo shop', () => {
  const db = fresh()
  db.prepare('UPDATE shops SET is_demo = 0').run()
  assert.throws(() => L.resetDemo(db), /demo mode/)
  assert.throws(() => db.prepare('DELETE FROM transactions').run(), /only demo/)
})

test('full journey: credit needs a yes, repayment, balance, follow-up uses context', async () => {
  const db = fresh(), r = id(db, 'Ramesh')
  let x = await talk(db, 'Ramesh ko paanch sau rupaye udhaar diye.')
  assert.equal(x.state, 'awaiting_confirmation')
  assert.match(x.say, /Ramesh ke khate mein 500 rupaye udhaar add karun\?/)
  assert.equal(L.balanceOf(db, r), 0) // nothing saved before confirmation
  x = await talk(db, 'Haan.')
  assert.match(x.say, /Ho gaya.*500 rupaye add ho gaye.*balance 500 rupaye/)
  x = await talk(db, 'Ramesh ne 200 rupaye wapas diye.')
  assert.match(x.say, /Ramesh se 200 rupaye ki payment record karun\?/)
  x = await talk(db, 'haan')
  assert.match(x.say, /Payment record ho gayi.*300 rupaye baaki/)
  x = await talk(db, 'Ramesh ka kitna baaki hai?')
  assert.match(x.say, /Ramesh ke 300 rupaye baaki hain/)
  x = await talk(db, 'Ab kitna baaki hai?') // "ab" -> Ramesh from context
  assert.match(x.say, /Ramesh ke 300 rupaye baaki hain/)
  assert.equal(L.balanceOf(db, r), 30000)
})

test('cancel and plain "nahi" never save', async () => {
  const db = fresh(), r = id(db, 'Ramesh')
  await talk(db, 'Ramesh ko 500 rupaye udhaar diye'); await talk(db, 'Cancel karo.')
  await talk(db, 'Ramesh ko 500 rupaye udhaar diye'); await talk(db, 'Nahi.')
  assert.equal(L.balanceOf(db, r), 0)
  assert.equal((await talk(db, 'haan')).state, 'idle') // a stray yes confirms nothing
  assert.equal(L.balanceOf(db, r), 0)
})

test('correction changes the pending amount, saves only the corrected one', async () => {
  const db = fresh(), r = id(db, 'Ramesh')
  await talk(db, 'Ramesh ko 500 rupaye udhaar diye')
  const x = await talk(db, 'Nahi, 300 rupaye.')
  assert.match(x.say, /Samajh gaya\. Ramesh ke khate mein 300 rupaye udhaar add karun\?/)
  await talk(db, 'haan')
  assert.equal(L.balanceOf(db, r), 30000)
})

test('ambiguous name asks, then keeps amount and type', async () => {
  const db = fresh()
  let x = await talk(db, 'Rameshwr ko 200 rupaye udhaar diye')
  assert.equal(x.state, 'awaiting_clarification')
  assert.match(x.say, /Aap Ramesh ki baat kar rahe hain ya Rameshwar ki\?/)
  x = await talk(db, 'Rameshwar.')
  assert.match(x.say, /Rameshwar ke khate mein 200 rupaye udhaar add karun\?/)
  const before = L.balanceOf(db, id(db, 'Rameshwar'))
  await talk(db, 'haan')
  assert.equal(L.balanceOf(db, id(db, 'Rameshwar')), before + 20000)
  assert.equal(L.balanceOf(db, id(db, 'Ramesh')), 0)
})

test('missing amount and missing name are asked specifically', async () => {
  const db = fresh()
  let x = await talk(db, 'Ramesh ko udhaar diye')
  assert.match(x.say, /kitne rupaye\?/)
  x = await talk(db, 'do sau')
  assert.match(x.say, /200 rupaye udhaar add karun\?/)
  await talk(db, 'cancel')
  x = await talk(db, '500 rupaye udhaar diye')
  assert.match(x.say, /Kis customer ka naam hai\?/)
  x = await talk(db, 'Suresh')
  assert.match(x.say, /Suresh ke khate mein 500 rupaye/)
})

test('unclear speech asks again without losing the pending entry', async () => {
  const db = fresh()
  await talk(db, 'Ramesh ko 500 rupaye udhaar diye')
  const x = await talk(db, 'mmm blah')
  assert.match(x.say, /Maaf kijiye, dobara boliye\./)
  assert.equal(x.state, 'awaiting_confirmation')
})

test('confirm button submitted twice saves once', async () => {
  const db = fresh(), r = id(db, 'Ramesh')
  await talk(db, 'Ramesh ko 500 rupaye udhaar diye')
  await talk(db, '', { action: 'confirm' }); await talk(db, '', { action: 'confirm' })
  assert.equal(L.balanceOf(db, r), 50000)
})

test('spoken reversal needs confirmation and keeps history', async () => {
  const db = fresh(), r = id(db, 'Ramesh')
  await talk(db, 'Ramesh ko 500 rupaye udhaar diye'); await talk(db, 'haan')
  let x = await talk(db, 'Pichhli entry galat thi.')
  assert.match(x.say, /Isse reverse karun\?/)
  assert.equal(L.balanceOf(db, r), 50000)
  x = await talk(db, 'haan')
  assert.match(x.say, /Entry reverse kar di/)
  assert.equal(L.balanceOf(db, r), 0)
  assert.equal(L.history(db, { customerId: r }).length, 4) // 2 demo + credit + reversal
})

test('daily summary by voice, and English works too', async () => {
  const db = fresh()
  await talk(db, 'Suresh ko 2000 rupaye udhaar diye'); await talk(db, 'haan')
  await talk(db, 'Kavita ne 800 rupaye wapas diye'); await talk(db, 'haan')
  assert.match((await talk(db, 'Aaj ka hisaab batao.')).say, /Aaj 2000 rupaye ka udhaar diya gaya aur 800 rupaye ki payment receive hui\./)
  const e = await converse(db, { session: 'session-test-2', text: 'How much does Suresh owe me?', lang: 'en-IN' })
  assert.match(e.say, /Suresh owes 2450 rupees\./)
})

test('unknown language without AI explains the limitation', async () => {
  const db = fresh()
  const x = await converse(db, { session: 'session-test-3', text: 'ರಮೇಶ್ ಗೆ ಐನೂರು ರೂಪಾಯಿ ಸಾಲ', lang: 'kn-IN' })
  assert.match(x.say, /AI enhancement/)
})

test('data survives a restart, and the app starts with no keys', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'khata-')), 'k.db')
  let db = openDb(path); createApp(db)
  L.commitEntry(db, { customerId: id(db, 'Ramesh'), type: 'credit', amountPaise: 12300, key: 'persist' })
  db.close()
  db = openDb(path); createApp(db)
  assert.equal(L.balanceOf(db, id(db, 'Ramesh')), 12300)
  assert.equal(L.listCustomers(db).length, 5) // not reseeded
})
