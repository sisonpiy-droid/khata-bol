// The REAL voice loop (src/lib/voice.js) driven by a SIMULATED speech recognizer and speaker, against the real backend.
// This proves state transitions, echo protection, cleanup and retry logic. It does NOT prove microphone capture or recognition accuracy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../server/db.js'
import * as L from '../server/ledger.js'
import { converse } from '../server/dialog.js'
import { createVoice, MSG, OFFLINE, AGAIN } from '../src/lib/voice.js'

process.env.ANTHROPIC_API_KEY = ''
process.env.GEMINI_API_KEY = ''

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, label) => { for (let i = 0; i < 200; i++) { if (fn()) return; await tick(5) } assert.fail(`timed out waiting for ${label}`) }

function rig({ session = 'voice-loop-session', db = openDb(':memory:'), lang = 'hi-IN' } = {}) {
  const shop = L.shopFor(db, session)
  const log = [], said = [], snaps = []
  const heardQueue = [] // {text, confidence} | Error
  let speaking = false, hidden = false, overlap = false, failNext = 0, calls = 0
  const state = { lang }
  const deps = {
    converse: async (body) => { calls++; if (failNext > 0) { failNext--; throw new Error('network down') } return converse(db, { session, ...body }) },
    listen: (l, onInterim) => {
      log.push('listen:start'); if (speaking) overlap = true // the microphone must never open while the app is speaking
      let aborted = false
      const holders = []
      const promise = new Promise((resolve, reject) => setTimeout(() => {
        if (aborted) return reject(new Error('aborted'))
        const next = heardQueue.shift()
        if (next === 'HOLD') { holders.push(() => reject(new Error('aborted'))); return } // microphone open, user silent
        if (next === undefined) return reject(new Error('no-speech'))
        if (next instanceof Error) return reject(next)
        onInterim?.(next.text); resolve(next)
      }, 5))
      return { promise, stop: () => { aborted = true; log.push('listen:stop'); holders.forEach((h) => h()) } }
    },
    speak: async (t) => { log.push('speak:start'); speaking = true; said.push(t); await tick(10); speaking = false; log.push('speak:end') },
    cancelSpeech: () => { speaking = false },
    getLang: () => state.lang, getReplyLang: () => state.lang,
    supported: () => true, sleep: (ms) => tick(0), hidden: () => hidden, quietMs: 0,
    refresh: () => {}, onChange: (s) => snaps.push(s.mode),
  }
  const v = createVoice(deps)
  const bal = (name) => L.listCustomers(db, shop).find((c) => c.name === name).balance_paise
  return { v, db, shop, log, said, snaps, heardQueue, bal, state, calls: () => calls, overlap: () => overlap, setHidden: (h) => { hidden = h }, failNext: (n) => { failNext = n } }
}
const say = (text, confidence = 0.9) => ({ text, confidence })

test('full journey by voice: credit, auto-listen, confirm, repayment, balance, context follow-up', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko paanch sau rupaye udhaar diye.'), say('Haan, save kar do.'))
  r.v.tapMic()
  await until(() => r.bal('Ramesh') === 50000 && r.v.state.mode === 'idle', 'credit saved')
  assert.match(r.said[0], /500 rupaye udhaar add karun\?/)
  assert.match(r.said[1], /Ho gaya.*balance 500/)
  assert.equal(r.v.state.heard, 'Haan, save kar do.') // the real words are what is shown
  r.heardQueue.push(say('Ramesh ne do sau rupaye wapas diye'), say('haan'))
  r.v.tapMic()
  await until(() => r.bal('Ramesh') === 30000 && r.v.state.mode === 'idle', 'repayment saved')
  r.heardQueue.push(say('Ab kitna baaki hai?'))
  r.v.tapMic()
  await until(() => r.said.at(-1)?.includes('300 rupaye baaki'), 'balance spoken')
  assert.equal(r.overlap(), false) // the mic never opened while the app was talking
  assert.equal(r.log.filter((e) => e === 'listen:start').length, 5) // 3 taps + 2 automatic reopenings for answers
  r.v.dispose()
})

test('every legal step lands in a known state; never listening and speaking at once', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'), say('haan'))
  r.v.tapMic()
  await until(() => r.bal('Ramesh') === 50000 && r.v.state.mode === 'idle', 'done')
  const legal = new Set(['idle', 'listening', 'processing', 'speaking', 'awaiting_confirmation', 'awaiting_clarification', 'saving', 'error'])
  assert.ok(r.snaps.every((m) => legal.has(m)))
  const s = r.log.join(',')
  assert.equal(/speak:start,listen:start/.test(s), false) // never opens the mic mid-speech
  r.v.dispose()
})

test('tapping the mic while the app speaks interrupts it, then listens', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'))
  r.v.tapMic()
  await until(() => r.v.state.mode === 'speaking', 'speaking')
  r.heardQueue.push(say('Nahi, teen sau'))
  r.v.tapMic() // talk over it
  await until(() => /300 rupaye udhaar add karun/.test(r.said.at(-1) ?? ''), 'correction understood')
  assert.equal(r.bal('Ramesh'), 0) // still nothing saved
  r.v.dispose()
})

test('low-confidence speech is shown but never sent to the server', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko paanch hazaar udhaar diye', 0.2), say('Ramesh ko paanch sau udhaar diye'))
  r.v.tapMic()
  await until(() => r.said.some((t) => /500 rupaye udhaar add karun/.test(t)), 'second try understood')
  assert.equal(r.said[0], AGAIN)
  assert.equal(r.calls(), 1) // only the clear utterance reached the backend
  r.v.dispose()
})

test('silence during a question re-asks once; silence again shows a clear message', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye')) // then silence (queue empty -> no-speech)
  r.v.tapMic()
  await until(() => r.v.state.mode === 'error', 'gave up')
  assert.equal(r.said.filter((t) => t === AGAIN).length, 1)
  assert.equal(r.v.state.err, MSG['no-speech'])
  assert.equal(r.v.state.dlg, 'awaiting_confirmation') // the pending entry is still there
  assert.equal(r.bal('Ramesh'), 0)
  r.v.dispose()
})

test('microphone permission denied: clear instructions, and the app recovers once allowed', async () => {
  const r = rig()
  r.heardQueue.push(new Error('denied'))
  r.v.tapMic()
  await until(() => r.v.state.mode === 'error', 'error state')
  assert.equal(r.v.state.err, MSG.denied)
  r.heardQueue.push(say('Ramesh ka kitna baaki hai?'))
  r.v.tapMic() // user fixed the permission and tapped again
  await until(() => r.said.some((t) => /Ramesh ka koi paisa baaki nahi/.test(t)), 'works after recovery')
  r.v.dispose()
})

test('network failure: nothing is reported as saved; retry saves exactly once even if pressed twice', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'), 'HOLD')
  r.v.tapMic()
  await until(() => r.said.length === 1 && r.v.state.mode === 'listening' && r.v.state.pid, 'asked, mic open')
  r.failNext(1)
  r.v.confirm()
  await until(() => r.v.state.canRetry, 'retry offered')
  assert.equal(r.v.state.err, OFFLINE)
  assert.equal(r.said.at(-1), OFFLINE)
  assert.equal(r.bal('Ramesh'), 0) // honest: not saved
  r.v.retry(); r.v.retry()
  await until(() => r.bal('Ramesh') === 50000 && r.v.state.mode !== 'processing' && r.v.state.mode !== 'saving', 'saved after retry')
  assert.equal(r.bal('Ramesh'), 50000) // once
  r.v.dispose()
})

test('a double-tapped Confirm saves once', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'), 'HOLD')
  r.v.tapMic()
  await until(() => r.said.length === 1 && r.v.state.mode === 'listening' && r.v.state.pid, 'asked, mic open')
  r.v.confirm(); r.v.confirm(); r.v.confirm()
  assert.ok(['saving', 'processing'].includes(r.v.state.mode)) // the button press shows its own visible "Saving" state
  await until(() => r.bal('Ramesh') === 50000, 'saved')
  await tick(100)
  assert.equal(r.bal('Ramesh'), 50000)
  r.v.dispose()
})

test('events after dispose do nothing (no late recognition, no late speech)', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'))
  r.v.tapMic()
  r.v.dispose() // unmounted before the recognizer answers
  await tick(60)
  assert.equal(r.calls(), 0)
  assert.equal(r.said.length, 0)
})

test('a tab sent to the background stops listening and never reopens the mic', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'))
  r.v.tapMic()
  await until(() => r.v.state.mode === 'speaking', 'asking')
  r.setHidden(true); r.v.hidden()
  await tick(60)
  assert.equal(r.log.filter((e) => e === 'listen:start').length, 1) // no automatic reopening while hidden
  assert.equal(r.v.state.dlg, 'awaiting_confirmation') // the question is still pending, nothing saved
  assert.equal(r.bal('Ramesh'), 0)
  r.v.dispose()
})

test('after a refresh the unfinished entry returns silently and can be confirmed', async () => {
  const first = rig()
  first.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'))
  first.v.tapMic()
  await until(() => first.said.length === 1, 'asked')
  first.v.dispose() // page reloaded
  const again = rig({ db: first.db })
  await again.v.resume()
  assert.equal(again.v.state.mode, 'awaiting_confirmation')
  assert.equal(again.v.state.reply.card.amount_paise, 50000)
  assert.equal(again.said.length, 0) // no unsolicited speech: browsers need a tap first
  assert.equal(again.log.length, 0)
  again.v.confirm()
  await until(() => again.bal('Ramesh') === 50000, 'confirmed after refresh')
  again.v.dispose()
})

test('switching language mid-question re-asks in the new language and saves nothing', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko paanch sau rupaye udhaar diye'))
  r.v.tapMic()
  await until(() => r.v.state.mode === 'speaking', 'asking in Hindi')
  r.state.lang = 'en-IN'
  r.heardQueue.push(say('yes'))
  await r.v.languageChanged()
  await until(() => /Add 500 rupees credit to Ramesh/.test(r.said.at(-1) ?? ''), 're-asked in English')
  assert.equal(r.bal('Ramesh'), 0)
  await until(() => r.bal('Ramesh') === 50000, 'confirmed in English')
  r.v.dispose()
})

test('an answer to an older question is refused by the server, not applied to a newer entry', async () => {
  const r = rig()
  r.heardQueue.push(say('Ramesh ko 500 rupaye udhaar diye'))
  r.heardQueue.push('HOLD')
  r.v.tapMic()
  await until(() => r.said.length === 1 && r.v.state.pid, 'asked with a pending id')
  const oldPid = r.v.state.pid
  await r.v.cancel()
  r.v.submitText('Suresh ko 200 rupaye udhaar diye')
  await until(() => r.v.state.pid && r.v.state.pid !== oldPid, 'new pending entry')
  const stale = await converse(r.db, { session: 'voice-loop-session', text: 'haan', pid: oldPid, lang: 'hi-IN' })
  assert.match(stale.say, /purani entry/)
  assert.equal(r.bal('Suresh'), 45000)
  r.v.dispose()
})

test('briefing is spoken only when asked, from real data, and never opens the microphone', async () => {
  const r = rig()
  await tick(40)
  assert.equal(r.said.length, 0) // opening the app and loading data say nothing by themselves
  r.v.briefing()
  await until(() => r.said.length === 1, 'briefing spoken')
  assert.match(r.said[0], /^Namaste\. Aaj 1 payments due hain\. Kavita ki 800 rupaye ki payment high priority hai\. 1 payments overdue hain\./)
  await tick(40)
  assert.equal(r.log.filter((e) => e === 'listen:start').length, 0) // it is a statement, not a question
  assert.equal(r.v.state.mode, 'idle')
  r.v.dispose()
})

test('text from a dictation tool is labelled as dictated and still needs a confirmation', async () => {
  const r = rig()
  r.heardQueue.push('HOLD')
  r.v.submitText('Ramesh ko 500 rupaye udhaar diye', 'dictation')
  await until(() => r.v.state.reply?.card?.kind === 'pending', 'confirmation card')
  assert.equal(r.v.state.source, 'dictation')
  assert.equal(r.bal('Ramesh'), 0) // nothing saved by dictating
  r.v.dispose()
})

test('date/time choices from buttons are answered through the same loop', async () => {
  const r = rig()
  r.heardQueue.push('HOLD')
  r.v.submitText('Priya ki payment next friday ko due hai')
  await until(() => r.v.state.reply?.card?.kind === 'optionchoice', 'asked which date')
  const first = r.v.state.reply.card.options[0].value
  r.v.option(first)
  await until(() => r.v.state.reply?.card?.kind === 'followup', 'confirmation of the chosen date')
  assert.equal(r.v.state.reply.card.date, first)
  r.v.dispose()
})
