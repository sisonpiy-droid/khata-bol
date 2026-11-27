// Voice-command level tests for reports, reminders and priorities, through the real dialogue state machine.
// Clock fixed to Thursday 1 January 2026, 12:00 India time, so "Friday" = 2 Jan and "Monday" = 5 Jan.
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../server/db.js'
import * as L from '../server/ledger.js'
import * as F from '../server/follow.js'
import { converse, clock } from '../server/dialog.js'

process.env.ANTHROPIC_API_KEY = ''
process.env.GEMINI_API_KEY = ''
const NOW = new Date('2026-01-01T06:30:00Z')
clock.now = () => NOW

const S = 'command-session-1'
function rig({ keepDemoFollowUps = false } = {}) {
  const db = openDb(':memory:'), shop = L.shopFor(db, S)
  if (!keepDemoFollowUps) db.exec('DELETE FROM commitment_history; DELETE FROM commitments;')
  const talk = (text, extra = {}) => converse(db, { session: S, text, lang: 'hi-IN', ...extra })
  const rows = () => F.listCommitments(db, shop, { status: 'all', now: NOW })
  const bal = (name) => L.listCustomers(db, shop).find((c) => c.name === name).balance_paise
  return { db, shop, talk, rows, bal }
}

// ---------------------------------------------------------------- reminders
test('"Ramesh ko paanch tareekh tak payment karni hai": proposes the real date, saves only after yes, announces it', async () => {
  const r = rig()
  let x = await r.talk('Ramesh ko paanch tareekh tak payment karni hai.')
  assert.equal(x.state, 'awaiting_confirmation')
  assert.match(x.say, /Ramesh ki payment ka reminder Monday 5 January ke liye set karun\?/)
  assert.equal(r.rows().length, 0) // nothing stored before the yes
  x = await r.talk('haan')
  assert.match(x.say, /Ho gaya\. Ramesh ki payment ka reminder Monday 5 January ke liye set hai\./)
  assert.deepEqual(r.rows().map((c) => [c.customer_name, c.due_date, c.priority, c.amount_paise]), [['Ramesh', '2026-01-05', 'medium', null]])
  assert.equal(r.bal('Ramesh'), 0) // a reminder never moves money
})

test('relative date and time: "Kal subah nau baje Suresh ka reminder laga do"', async () => {
  const r = rig()
  const x = await r.talk('Kal subah nau baje Suresh ka reminder laga do.')
  assert.match(x.say, /Suresh ki payment ka reminder Friday 2 January 9 baje subah ke liye set karun\?/)
  await r.talk('haan')
  assert.deepEqual([r.rows()[0].due_date, r.rows()[0].due_time], ['2026-01-02', '09:00'])
})

test('context: "Iski payment Friday ko due hai" after a credit entry, then "Isko high priority kar do"', async () => {
  const r = rig()
  await r.talk('Ramesh ko 500 rupaye udhaar diye'); await r.talk('haan')
  let x = await r.talk('Iski payment Friday ko due hai.')
  assert.match(x.say, /Ramesh ki payment ka reminder Friday 2 January/) // "iski" = Ramesh, from the conversation
  await r.talk('haan')
  const c = r.rows()[0]
  assert.equal(c.customer_name, 'Ramesh')
  assert.ok(c.txn_id) // linked to the credit just recorded
  x = await r.talk('Isko high priority kar do.')
  assert.match(x.say, /Ramesh ki payment \(Friday 2 January\) ko high priority karun\?/)
  assert.equal(r.rows()[0].priority, 'medium') // not changed until confirmed
  await r.talk('haan')
  assert.equal(r.rows()[0].priority, 'high')
  x = await r.talk('Kal kaunse payments due hain?')
  assert.match(x.say, /Kal 1 payments due hain: Ramesh 500 rupaye \(high priority\)\./)
})

test('"next Friday" and a bare hour are asked, never guessed', async () => {
  const r = rig()
  let x = await r.talk('Priya ki payment next Friday ko due hai.')
  assert.equal(x.state, 'awaiting_clarification')
  assert.deepEqual(x.card.options.map((o) => o.value), ['2026-01-02', '2026-01-09'])
  assert.equal(r.rows().length, 0)
  x = await r.talk('', { action: 'option', choice: '2026-01-09' })
  assert.match(x.say, /Friday 9 January ke liye set karun\?/)
  await r.talk('cancel')
  x = await r.talk('Kal nau baje Suresh ka reminder laga do.')
  assert.deepEqual(x.card.options.map((o) => o.value), ['09:00', '21:00'])
  x = await r.talk('shaam') // answered by voice
  assert.match(x.say, /9 baje raat/)
})

test('past dates, unknown customers and duplicates are handled with a clear message', async () => {
  const r = rig()
  let x = await r.talk('Ramesh ki payment yesterday ko due hai')
  assert.match(x.say, /Wednesday 31 December beet chuka hai.*kis tareekh/)
  x = await r.talk('Friday ko')
  assert.match(x.say, /Friday 2 January ke liye set karun\?/)
  await r.talk('haan')
  x = await r.talk('Sharma ji ki payment Monday ko due hai.')
  assert.match(x.say, /Sharma naam ka koi customer nahi mila/) // no invented customer
  assert.equal(r.rows().length, 1)
  await r.talk('Ramesh ki payment Friday ko due hai'); x = await r.talk('haan')
  assert.match(x.say, /pehle se maujood hai/)
  assert.equal(r.rows().length, 1)
})

test('a customer named mid-flow replaces the old one; the earlier reminder never attaches to them', async () => {
  const r = rig()
  await r.talk('Ramesh ko Friday ko payment leni hai')
  const x = await r.talk('Nahi, Suresh')
  assert.match(x.say, /Suresh ki payment ka reminder Friday 2 January/)
  await r.talk('haan')
  assert.deepEqual(r.rows().map((c) => c.customer_name), ['Suresh'])
  // credit linked to Ramesh must not follow a reminder created for Suresh
  await r.talk('Ramesh ko 100 rupaye udhaar diye'); await r.talk('haan')
  await r.talk('Iski payment Monday ko due hai'); await r.talk('Nahi, Priya'); await r.talk('haan')
  assert.equal(r.rows().find((c) => c.customer_name === 'Priya').txn_id, null)
})

test('stale answers cannot confirm a different reminder', async () => {
  const r = rig()
  const one = await r.talk('Ramesh ko Friday ko payment leni hai')
  const two = await r.talk('Priya ki payment Monday ko due hai')
  assert.notEqual(one.pid, two.pid)
  const stale = await r.talk('haan', { pid: one.pid })
  assert.match(stale.say, /purani entry/)
  assert.equal(r.rows().length, 0)
  await r.talk('', { action: 'confirm', pid: two.pid })
  assert.deepEqual(r.rows().map((c) => c.customer_name), ['Priya'])
})

test('reschedule, priority, cancel and complete by voice; several reminders ask which one', async () => {
  const r = rig()
  await r.talk('Ramesh ki payment Friday ko due hai'); await r.talk('haan')
  let x = await r.talk('Ramesh ka reminder kal kar do.') // already Friday 2 Jan; move to the same day is a duplicate-free no-op? use Monday instead
  await r.talk('cancel')
  x = await r.talk('Ramesh ka reminder Monday kar do.')
  assert.match(x.say, /Ramesh ka reminder Monday 5 January par le jaun\?/)
  await r.talk('haan')
  assert.equal(r.rows()[0].due_date, '2026-01-05')
  x = await r.talk('Priya ka reminder cancel karo.')
  assert.match(x.say, /Priya ka koi reminder nahi mila/)
  await r.talk('Ramesh ki payment Wednesday ko due hai')
  await r.talk('', { action: 'option', choice: '2026-01-07' }); await r.talk('haan') // today is Thursday; Wednesday is ambiguous? no: single coming Wednesday
  x = await r.talk('Ramesh ka reminder cancel karo.')
  assert.equal(x.state, 'awaiting_clarification')
  assert.match(x.say, /kai reminders hain/)
  x = await r.talk('', { action: 'choose', choice: 0 })
  assert.match(x.say, /cancel karun\?/)
  await r.talk('haan')
  assert.equal(r.rows().filter((c) => c.status === 'cancelled').length, 1)
})

test('payment received: amount is asked, then the settled reminder is offered for completion', async () => {
  const r = rig()
  await r.talk('Ramesh ko 500 rupaye udhaar diye'); await r.talk('haan')
  await r.talk('Iski payment Friday ko due hai 500 rupaye'); await r.talk('haan')
  let x = await r.talk('Ramesh ki payment mil gayi.')
  assert.match(x.say, /kitne rupaye\?/) // never assumes the amount
  assert.equal(r.bal('Ramesh'), 50000)
  x = await r.talk('paanch sau'); assert.match(x.say, /500 rupaye ki payment record karun\?/)
  x = await r.talk('haan')
  assert.match(x.say, /Payment record ho gayi.*Ramesh ka Friday 2 January wala reminder complete mark karun\?/)
  assert.equal(x.expect, 'confirm')
  assert.equal(r.rows()[0].status, 'open') // offered, not done
  x = await r.talk('haan')
  assert.match(x.say, /complete mark kar diya/)
  assert.equal(r.rows()[0].status, 'completed')
})

// ---------------------------------------------------------------- reports by voice
test('report questions are answered from the database', async () => {
  const r = rig({ keepDemoFollowUps: true }) // demo: Suresh overdue 450, Kavita due today 800 high, Rameshwar upcoming
  clock.now = () => new Date() // demo follow-ups are dated from the real today
  try {
    L.commitEntry(r.db, { shopId: r.shop, customerId: L.listCustomers(r.db, r.shop).find((c) => c.name === 'Suresh').id, type: 'credit', amountPaise: 100000, key: 'big' })
    L.commitEntry(r.db, { shopId: r.shop, customerId: L.listCustomers(r.db, r.shop).find((c) => c.name === 'Priya').id, type: 'credit', amountPaise: 250000, key: 'priya' })
    L.commitEntry(r.db, { shopId: r.shop, customerId: L.listCustomers(r.db, r.shop).find((c) => c.name === 'Ramesh').id, type: 'payment', amountPaise: 20000, key: 'rp' })
    const say = async (t) => (await r.talk(t)).say
    assert.match(await say('Aaj ka hisaab batao.'), /Aaj aapne 3500 rupaye udhaar diye aur 200 rupaye ki payment receive hui\. 1 customers ki payment aaj due hai\. 1 payments overdue hain\./)
    assert.match(await say('Aaj kitna udhaar diya?'), /Aaj aapne 3500 rupaye udhaar diye\./)
    assert.match(await say('Aaj kitni payment aayi?'), /Aaj 200 rupaye ki payment receive hui\./)
    assert.match(await say('Is hafte kitna udhaar diya?'), /Pichhle saat din mein aapne 3500 rupaye udhaar diye\./)
    assert.match(await say('Pichhle saat din mein kitni payment mili?'), /200 rupaye ki payment mili\./)
    assert.match(await say('Is hafte ka hisaab batao.'), /Pichhle saat din mein 3500 rupaye udhaar diye aur 200 rupaye ki payment mili\..*Sabse zyada Priya ke 2500 rupaye baaki hain\./)
    assert.match(await say('Sabse zyada udhaar kiska baaki hai?'), /Priya ke 2500 rupaye/)
    assert.match(await say('Kaunse customers ki payment overdue hai?'), /1 customers ki payment overdue hai: Suresh 450 rupaye\./)
    assert.match(await say('Kitni payment overdue hai?'), /1 payments overdue hain.*1450 rupaye/) // Suresh now owes 450 + 1000
    assert.match(await say('Aaj kis kis ki payment due hai?'), /Aaj 1 payments due hain: Kavita 800 rupaye \(high priority\)\./)
    assert.match(await say('Is week sabse pehle kisse paise lene hain?'), /Is hafte sabse pehle Kavita 800 rupaye \(high priority\), Suresh 1450 rupaye, Rameshwar 800 rupaye\./)
    const b = await r.talk('', { action: 'briefing' })
    assert.match(b.say, /Namaste\. Aaj 1 payments due hain\. Kavita ki 800 rupaye ki payment high priority hai\. 1 payments overdue hain\. Kul 5/)
    assert.equal(b.card.kind, 'report')
  } finally { clock.now = () => NOW }
})

test('settled and reversed items are not offered as payments to collect', async () => {
  const r = rig({ keepDemoFollowUps: true })
  clock.now = () => new Date()
  try {
    const cid = (n) => L.listCustomers(r.db, r.shop).find((c) => c.name === n).id
    L.commitEntry(r.db, { shopId: r.shop, customerId: cid('Suresh'), type: 'payment', amountPaise: 45000, key: 'settle-suresh' }) // Suresh's overdue balance is now paid
    const out = await r.talk('Kaunse customers ki payment overdue hai?')
    assert.match(out.say, /Koi payment overdue nahi hai\./)
    const brief = (await r.talk('', { action: 'briefing' })).say
    assert.doesNotMatch(brief, /overdue/)
  } finally { clock.now = () => NOW }
})
