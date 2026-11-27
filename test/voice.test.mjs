import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../server/db.js'
import * as L from '../server/ledger.js'
import { converse } from '../server/dialog.js'

delete process.env.ANTHROPIC_API_KEY
delete process.env.GEMINI_API_KEY

const S = 'voice-test-session'
const fresh = () => { const db = openDb(':memory:'); return { db, shop: L.shopFor(db, S) } }
const bal = ({ db, shop }, name) => L.listCustomers(db, shop).find((c) => c.name === name).balance_paise
const talk = ({ db }, text, extra = {}) => converse(db, { session: S, text, lang: 'hi-IN', ...extra })

test('natural phrases: save kar do, nahi teen sau, cancel karo', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko paanch sau udhaar diye.')
  assert.match((await talk(t, 'Nahi, teen sau.')).say, /300 rupaye udhaar add karun\?/)
  assert.match((await talk(t, 'Haan, save kar do.')).say, /Ho gaya.*300/)
  await talk(t, 'Ramesh ne do sau wapas diye.')
  await talk(t, 'Cancel karo.')
  assert.equal(bal(t, 'Ramesh'), 30000) // the cancelled repayment was not saved
  assert.match((await talk(t, 'Ab kitna baaki hai?')).say, /Ramesh ke 300 rupaye baaki hain/)
})

test('a failed database write is reported, never faked, and a retry saves exactly once', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  const exec = t.db.exec.bind(t.db)
  t.db.exec = (sql) => { if (sql === 'BEGIN IMMEDIATE') throw new Error('disk I/O error'); return exec(sql) }
  const bad = await talk(t, 'haan')
  assert.match(bad.say, /save nahi ho paayi.*Kuch save nahi hua/)
  assert.equal(bad.card.kind, 'error')
  assert.equal(bad.state, 'awaiting_confirmation') // the pending entry is kept
  assert.equal(bal(t, 'Ramesh'), 0)
  t.db.exec = exec
  await talk(t, 'haan'); await talk(t, 'haan')
  assert.equal(bal(t, 'Ramesh'), 50000)
})

test('an unanswered question expires instead of being confirmed late', async () => {
  const t = fresh()
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye')
  t.db.prepare("UPDATE conversations SET ctx = json_set(ctx, '$.at', 1)").run()
  const x = await talk(t, 'haan')
  assert.match(x.say, /cancel ho gayi/)
  assert.equal(bal(t, 'Ramesh'), 0)
})

test('large amounts are flagged for a second look; a repeated command replaces, not duplicates', async () => {
  const t = fresh()
  const x = await talk(t, 'Ramesh ko paanch hazaar udhaar diye')
  assert.match(x.say, /bada amount/)
  assert.equal(x.card.large, true)
  await talk(t, 'Ramesh ko 500 rupaye udhaar diye') // said again: replaces the pending one
  await talk(t, 'haan')
  assert.equal(bal(t, 'Ramesh'), 50000)
})

test('misheard amount is corrected by voice before anything is saved', async () => {
  const t = fresh()
  await talk(t, 'Rameshwar ko paanch hazaar udhaar diye')
  const x = await talk(t, 'Nahi, paanch sau')
  assert.match(x.say, /Samajh gaya\. Rameshwar ke khate mein 500 rupaye/)
  assert.equal(x.card.large, false)
})

test('Kannada works keyless for the core phrases, with Kannada replies on request', async () => {
  const t = fresh()
  const kn = { lang: 'kn-IN', reply: 'kn-IN' }
  let x = await talk(t, 'ರಮೇಶ್ ಗೆ ಐನೂರು ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ', kn)
  assert.equal(x.state, 'awaiting_confirmation')
  assert.match(x.say, /ರಮೇಶ್? ಖಾತೆಗೆ 500 ರೂಪಾಯಿ ಸಾಲ|Ramesh ಖಾತೆಗೆ 500 ರೂಪಾಯಿ ಸಾಲ/)
  x = await talk(t, 'ಹೌದು', kn)
  assert.equal(bal(t, 'Ramesh'), 50000)
  x = await talk(t, 'ರಮೇಶ್ ಅವರ ಬಾಕಿ ಎಷ್ಟು', kn)
  assert.match(x.say, /500 ರೂಪಾಯಿ/)
  // Recognised in Kannada but spoken back in Hinglish (device has no Kannada voice)
  x = await talk(t, 'ರಮೇಶ್ ಅವರ ಬಾಕಿ ಎಷ್ಟು', { lang: 'kn-IN', reply: 'hi-IN' })
  assert.match(x.say, /Ramesh ke 500 rupaye baaki hain/)
})

test('unparseable Kannada says AI enhancement is needed instead of guessing', async () => {
  const t = fresh()
  assert.match((await talk(t, 'ನಮಸ್ಕಾರ ಹೇಗಿದ್ದೀರಿ', { lang: 'kn-IN' })).say, /AI enhancement/)
})
