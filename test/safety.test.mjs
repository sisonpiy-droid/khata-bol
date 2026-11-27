import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../server/db.js'
import * as L from '../server/ledger.js'
import { converse } from '../server/dialog.js'

delete process.env.ANTHROPIC_API_KEY
delete process.env.GEMINI_API_KEY

const S = 'safety-session-1'
const fresh = () => { const db = openDb(':memory:'); return { db, shop: L.shopFor(db, S) } }
const cust = (t, name) => L.listCustomers(t.db, t.shop).find((c) => c.name === name)
const bal = (t, name) => cust(t, name).balance_paise
const talk = (t, text, extra = {}) => converse(t.db, { session: S, text, lang: 'hi-IN', ...extra })

// ---------------------------------------------------------------- financial accuracy
test('amounts stay integer paise: no floating-point drift', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko 1.10 rupaye udhaar diye'); await talk(t, 'haan')
  await talk(t, 'Ramesh ko 2.20 rupaye udhaar diye'); await talk(t, 'haan')
  assert.equal(bal(t, 'Ramesh'), 330) // 1.1*100 and 2.2*100 are not exact in floating point
  assert.ok(t.db.prepare('SELECT amount_paise, delta_paise FROM transactions').all().every((r) => Number.isInteger(r.amount_paise) && Number.isInteger(r.delta_paise)))
})

test('zero, negative-looking and oversized spoken amounts are refused before any confirmation', async () => {
  const t = fresh()
  assert.match((await talk(t, 'Ramesh ko 0 rupaye udhaar diye')).say, /amount sahi nahi/)
  await talk(t, 'cancel')
  assert.match((await talk(t, 'Ramesh ko 2000000 rupaye udhaar diye')).say, /amount sahi nahi/) // above the Rs 10,00,000 limit
  assert.equal(bal(t, 'Ramesh'), 0)
})

test('concurrent confirmations save exactly one entry', async () => {
  const t = fresh()
  const first = await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  await Promise.all([talk(t, 'haan'), talk(t, '', { action: 'confirm', pid: first.pid }), talk(t, 'Haan, save kar do')])
  assert.equal(bal(t, 'Ramesh'), 50000)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE type = 'credit' AND synthetic = 0").get().n, 1)
})

test('repayment above the balance needs an explicit warning and yes; the excess becomes an advance', async () => {
  const t = fresh()
  let x = await talk(t, 'Ramesh ne 200 rupaye wapas diye') // Ramesh owes 0
  assert.match(x.say, /koi balance baaki nahi.*200 rupaye advance/)
  assert.equal(x.card.overpay_paise, 20000)
  assert.equal(bal(t, 'Ramesh'), 0) // not saved yet
  x = await talk(t, 'haan')
  assert.match(x.say, /200 rupaye advance/)
  assert.equal(bal(t, 'Ramesh'), -20000)
  x = await talk(t, 'Kavita ne 1000 rupaye wapas diye') // Kavita owes 800
  assert.match(x.say, /sirf 800 rupaye baaki.*200 rupaye advance/)
  await talk(t, 'cancel')
  assert.equal(bal(t, 'Kavita'), 80000) // cancel leaves it untouched
})

test('an entry cannot be reversed twice, and another visitor cannot reverse it', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye'); const done = await talk(t, 'haan')
  const entry = L.history(t.db, t.shop)[0]
  assert.equal(done.card.balance_paise, 50000)
  await talk(t, '', { action: 'reverse', txnId: entry.id }); await talk(t, 'haan')
  assert.equal(bal(t, 'Ramesh'), 0)
  const again = await talk(t, '', { action: 'reverse', txnId: entry.id }) // already reversed
  assert.match(again.say, /koi entry nahi mili/)
  assert.equal(bal(t, 'Ramesh'), 0)
  // a different visitor naming this entry's id changes nothing
  await talk(t, 'Ramesh ko 300 rupaye udhaar diye'); await talk(t, 'haan')
  const mine = L.history(t.db, t.shop)[0]
  const other = await converse(t.db, { session: 'other-visitor-1', action: 'reverse', txnId: mine.id, lang: 'hi-IN' })
  assert.match(other.say, /koi entry nahi mili/)
  assert.equal(bal(t, 'Ramesh'), 30000)
})

test('a failed write mid-confirmation is not reported as saved', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  const exec = t.db.exec.bind(t.db)
  t.db.exec = (sql) => { if (sql === 'COMMIT') throw new Error('disk full'); return exec(sql) }
  const x = await talk(t, 'haan')
  t.db.exec = exec
  assert.match(x.say, /Kuch save nahi hua/)
  assert.equal(x.changed, undefined)
  assert.equal(bal(t, 'Ramesh'), 0)
})

// ---------------------------------------------------------------- conversation intelligence
test('"Ramesh ne 200 diye" is ambiguous: asked, never assumed to be a repayment', async () => {
  const t = fresh()
  let x = await talk(t, 'Ramesh ne 200 diye.')
  assert.equal(x.state, 'awaiting_clarification')
  assert.match(x.say, /payment mili ya udhaar diya\?/)
  assert.equal(x.card.kind, 'typechoice')
  x = await talk(t, 'haan') // a bare yes does not pick a direction
  assert.match(x.say, /dobara boliye/)
  x = await talk(t, '', { action: 'type', choice: 'payment' })
  assert.match(x.say, /payment record karun\?/)
  await talk(t, 'cancel')
  await talk(t, 'Ramesh ne 200 diye'); x = await talk(t, 'udhaar')
  assert.match(x.say, /200 rupaye udhaar add karun\?/)
  assert.equal(bal(t, 'Ramesh'), 0)
})

test('informal shopkeeper phrases', async () => {
  const t = fresh()
  assert.match((await talk(t, 'Ramesh ko 500 ka samaan diya.')).say, /500 rupaye udhaar add karun\?/)
  assert.match((await talk(t, 'Nahi, paanch sau nahi, teen sau.')).say, /Samajh gaya.*300 rupaye udhaar/) // the LAST amount wins
  await talk(t, 'haan')
  assert.match((await talk(t, 'Ab total batao.')).say, /Ramesh ke 300 rupaye baaki hain/) // "ab" = this customer
  assert.match((await talk(t, 'Total kitna baaki hai?')).say, /Kul 2350 rupaye baaki hain, 4 customers ke\./) // no "ab": everyone
  assert.match((await talk(t, 'Aaj kitna udhaar diya?')).say, /Aaj 300 rupaye ka udhaar diya gaya/)
})

test('"Kal wale 300 cancel kar do" reverses that specific entry after confirmation', async () => {
  const t = fresh()
  L.commitEntry(t.db, { shopId: t.shop, customerId: cust(t, 'Ramesh').id, type: 'credit', amountPaise: 30000, key: 'yday', ts: new Date(Date.now() - 864e5).toISOString() })
  L.commitEntry(t.db, { shopId: t.shop, customerId: cust(t, 'Suresh').id, type: 'credit', amountPaise: 70000, key: 'today' })
  let x = await talk(t, 'Kal wale 300 cancel kar do.')
  assert.match(x.say, /Ramesh ko 300 rupaye udhaar.*reverse karun\?/)
  assert.equal(bal(t, 'Ramesh'), 30000)
  await talk(t, 'haan')
  assert.equal(bal(t, 'Ramesh'), 0)
  assert.equal(bal(t, 'Suresh'), 45000 + 70000) // the unrelated entry is untouched
  x = await talk(t, 'Kal wale 700 cancel kar do') // that one was today's
  assert.match(x.say, /kal ka 700 rupaye ka koi entry nahi mila/)
})

test('"Rameshwar ko add karo" adds a customer only after confirmation, once', async () => {
  const t = fresh()
  assert.match((await talk(t, 'Rameshwar ko add karo')).say, /pehle se aapke khate mein/) // exists
  let x = await talk(t, 'Meena ko add karo')
  assert.match(x.say, /Naya customer Meena jodun\?/)
  assert.equal(L.listCustomers(t.db, t.shop).length, 5)
  await talk(t, 'haan'); await talk(t, 'haan')
  assert.equal(L.listCustomers(t.db, t.shop).filter((c) => c.name === 'Meena').length, 1)
})

test('a plausible but uncertain name is never silently created as a new customer', async () => {
  const t = fresh()
  let x = await talk(t, 'Kavya ko 100 rupaye udhaar diye') // close to Kavita
  assert.equal(x.state, 'awaiting_clarification')
  assert.match(x.say, /Kavita ki baat kar rahe hain ya Kavya \(naya customer\)/)
  assert.deepEqual(x.card.options.map((o) => o.name), ['Kavita', 'Kavya (naya customer)'])
  x = await talk(t, 'naya')
  assert.match(x.say, /Naya customer Kavya.*100 rupaye udhaar add karun\?/)
  await talk(t, 'haan')
  assert.equal(L.listCustomers(t.db, t.shop).filter((c) => c.name === 'Kavya').length, 1)
  assert.equal(bal(t, 'Kavita'), 80000) // Kavita untouched
})

test('identical customer names force an explicit choice, shown with what each owes', async () => {
  const t = fresh()
  const a = L.addCustomer(t.db, t.shop, 'Anil'), b = L.addCustomer(t.db, t.shop, 'Anil')
  L.commitEntry(t.db, { shopId: t.shop, customerId: b.id, type: 'credit', amountPaise: 25000, key: 'anil-b' })
  const x = await talk(t, 'Anil ko 100 rupaye udhaar diye')
  assert.equal(x.state, 'awaiting_clarification')
  assert.match(x.say, /Anil \(0 rupaye baaki\).*Anil \(250 rupaye baaki\)/)
  const y = await talk(t, '', { action: 'choose', choice: b.id, pid: x.pid })
  assert.match(y.say, /Anil ke khate mein 100 rupaye udhaar add karun\?/)
  await talk(t, 'haan')
  assert.equal(L.balanceOf(t.db, b.id), 35000)
  assert.equal(L.balanceOf(t.db, a.id), 0)
})

// ---------------------------------------------------------------- stale answers, refresh, language switch
test('an answer to an old question can never confirm a different entry', async () => {
  const t = fresh()
  const one = await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  const two = await talk(t, 'Suresh ko 200 rupaye udhaar diye') // replaces the first
  assert.notEqual(one.pid, two.pid)
  const stale = await talk(t, 'haan', { pid: one.pid })
  assert.match(stale.say, /purani entry/)
  assert.equal(bal(t, 'Suresh'), 45000)
  assert.equal(bal(t, 'Ramesh'), 0)
  await talk(t, '', { action: 'confirm', pid: two.pid })
  assert.equal(bal(t, 'Suresh'), 65000)
})

test('after a page refresh the pending entry is restored, and a language switch never saves it', async () => {
  const t = fresh()
  const first = await talk(t, 'Ramesh ko paanch sau rupaye udhaar diye')
  const back = await talk(t, '', { action: 'status', lang: 'en-IN' }) // refresh + switched to English
  assert.equal(back.pid, first.pid)
  assert.equal(back.card.amount_paise, 50000)
  assert.match(back.say, /Add 500 rupees credit to Ramesh/)
  assert.equal(bal(t, 'Ramesh'), 0)
  await talk(t, 'yes', { lang: 'en-IN' })
  assert.equal(bal(t, 'Ramesh'), 50000)
  assert.equal((await talk(t, '', { action: 'status' })).state, 'idle')
})

test('requests are validated at the trust boundary', async () => {
  const t = fresh()
  for (const body of [{ lang: 'not a language!' }, { action: 'drop tables' }, { action: 'choose', choice: -1 }, { action: 'type', choice: 'refund' }, { action: 'reverse' }, { text: 42 }, { pid: '../x' }])
    await assert.rejects(() => converse(t.db, { session: S, ...body }), /Invalid request/)
  const long = await talk(t, 'Ramesh '.repeat(500) + 'ko 500 rupaye udhaar diye') // truncated to 500 chars, still safe
  assert.ok(long.say)
})

test('the transcript is kept in the audit log for troubleshooting, and removed with the shop', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko paanch sau rupaye udhaar diye'); await talk(t, 'haan')
  const said = t.db.prepare("SELECT detail FROM audit_events WHERE event = 'created' AND shop_id = ?").get(t.shop)
  assert.match(JSON.parse(said.detail).said, /paanch sau/)
  L.resetDemo(t.db, t.shop)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event = 'created' AND shop_id = ?").get(t.shop).n, 0)
})
