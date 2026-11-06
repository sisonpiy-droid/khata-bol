import { useEffect, useRef, useState } from 'react'
import { SR, listen, listenAudio, speak } from './lib/speech.js'
import { useLedger, balanceOf } from './lib/store.js'
import { LANGS, phrase, yesNo } from './lib/i18n.js'
import { matchCustomer, score } from './lib/match.js'
import { creditWarning, chaseList } from './lib/insights.js'
import { CustomerList, CustomerDetail } from './Views.jsx'

const ERR = {
  denied: 'Microphone blocked. Click the lock icon in the address bar and allow the microphone.',
  'no-speech': "Didn't hear anything.",
  unsupported: 'This browser has no speech recognition. Please use Chrome.',
  other: 'Speech recognition failed. Try again.',
}
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

// Any image (jpg/png/svg/heic-as-supported) -> downscaled JPEG data URL for the vision call.
function toJpeg(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width || max, img.height || max))
      const c = document.createElement('canvas')
      c.width = Math.round((img.width || max) * k); c.height = Math.round((img.height || max) * k)
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('could not read that image'))
    img.src = url
  })
}

export default function App() {
  const ledger = useLedger()
  const { customers, txns, settings } = ledger
  const [langSel, setLang] = useState('hi-IN') // 'auto' = follow the language Gemini hears
  const [detected, setDetected] = useState('hi-IN')
  const [gemini, setGemini] = useState(false)
  const lang = langSel === 'auto' ? detected : langSel
  const [view, setView] = useState('home') // 'home' | 'list' | customer id
  const [stage, setStage] = useState('idle') // idle | listening | thinking | pick | confirm | manual
  const [interim, setInterim] = useState('')
  const [pending, setPending] = useState(null) // [{cid, name, amount, type, isNew, warn}]
  const [options, setOptions] = useState([])
  const [message, setMessage] = useState(null) // {kind:'ok'|'err', text}
  const [debug, setDebug] = useState(false)
  const [dbg, setDbg] = useState({})
  const [typed, setTyped] = useState('')
  const [hands, setHands] = useState(false)
  const run = useRef(0)
  const langRef = useRef('hi-IN')
  langRef.current = lang
  const geminiRef = useRef(false)
  const stopRef = useRef(null)
  const tapRef = useRef(null)
  const stageRef = useRef('idle')
  const handsRef = useRef(false)
  const silent = useRef(0)
  const fileRef = useRef(null)

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((c) => {
      if (c.gemini) { geminiRef.current = true; setGemini(true); setLang('auto') }
    }).catch(() => {})
  }, [])

  // Gemini audio when available (any language, auto-detects it); Chrome speech otherwise.
  const hear = () => {
    if (!geminiRef.current) return listen(langRef.current, setInterim)
    const l = listenAudio(setInterim, (code) => { langRef.current = code; setDetected(code) })
    const promise = l.promise.catch((e) => {
      if (e.message !== 'server') throw e
      geminiRef.current = false; setGemini(false); setLang(langRef.current) // server/key problem: drop to Chrome speech
      throw new Error('other')
    })
    return { promise, stop: l.stop }
  }
  const go = (s) => { stageRef.current = s; setStage(s) }
  const say = async (text) => { const s = await text; return s ? speak(s, langRef.current) : undefined }
  const bal = (cid) => balanceOf(txns, cid)
  const lastTxn = () => txns.length ? txns.reduce((a, b) => (b.ts >= a.ts ? b : a)) : null
  const nameOf = (cid) => customers.find((c) => c.id === cid)?.name ?? '?'
  const tell = (kind, text) => setMessage({ kind, text })

  // Speak `prompt` (string or promise), then wait for a voice answer or a button tap, whichever comes first.
  // Taps work immediately, even while speaking. Unclear voice answers re-listen once, then wait for a tap.
  const ask = (prompt, interpret) =>
    new Promise((resolve) => {
      let done = false
      tapRef.current = (v) => { done = true; tapRef.current = null; stopRef.current?.(); resolve(v) }
      const attempt = async (n) => {
        if (done) return
        const l = hear()
        stopRef.current = l.stop
        try {
          const text = await l.promise
          if (done) return
          setDbg((d) => ({ ...d, reply: text }))
          const v = await interpret(text)
          if (done) return
          if (v != null) return tapRef.current?.(v)
          tell('err', "Didn't catch that. Please tap a button.")
        } catch (e) {
          if (done || e.message === 'aborted') return
          tell('err', `${ERR[e.message] || ERR.other} Or tap a button.`)
          if (e.message === 'denied' || e.message === 'unsupported') return
        }
        if (n < 1) attempt(n + 1)
      }
      say(prompt).then(() => attempt(0))
    })

  function cancel() {
    run.current++
    handsRef.current = false; setHands(false)
    stopRef.current?.(); tapRef.current?.(null)
    speechSynthesis.cancel()
    go('idle'); setPending(null); setInterim('')
  }

  // Match each spoken name to the ledger; ask the shopkeeper when two customers look alike.
  async function resolveEntries(entries, alive) {
    const out = []
    for (const e of entries) {
      let m = matchCustomer(e.customer, customers)
      if (m.status === 'ambiguous') {
        setOptions(m.candidates); go('pick')
        const chosen = await ask(phrase(langRef.current, 'pick', { a: m.candidates[0].name, b: m.candidates[1].name }), (tx) => {
          const best = m.candidates.map((c) => ({ c, s: score(tx, c.name) })).sort((a, b) => b.s - a.s)[0]
          return best.s >= 0.6 ? best.c : null
        })
        if (!alive() || !chosen) return null
        m = { status: 'match', customer: chosen }
      }
      const cid = m.customer?.id ?? null
      out.push({
        cid, name: m.customer?.name ?? e.customer, amount: e.amount, type: e.type, isNew: !cid,
        warn: e.type === 'credit' ? creditWarning(txns, cid, e.amount) : null,
      })
    }
    return out
  }

  async function confirmBatch(list, alive, scan) {
    setPending(list); go('confirm')
    const spoken = scan
      ? phrase(langRef.current, 'scan', { count: list.length, total: list.reduce((s, e) => s + e.amount, 0) })
      : Promise.all([
          ...list.filter((e) => e.warn).map((e) => phrase(langRef.current, 'warn', { name: e.name, balance: e.warn.balance, oldestDays: e.warn.oldestDays })),
          phrase(langRef.current, 'readback', { entries: list.map((e) => ({ name: e.name, amount: e.amount, type: e.type })) }),
        ]).then((a) => a.join(' '))
    const yn = await ask(spoken, yesNo)
    if (!alive()) return
    if (yn === 'yes') await save(list)
    else { go('idle'); setPending(null); setInterim('') }
  }

  async function save(list) {
    ledger.addMany(list)
    go('idle'); setPending(null); setInterim('')
    let s = await phrase(langRef.current, 'saved')
    if (list.length === 1) {
      const e = list[0]
      const after = (e.cid ? bal(e.cid) : 0) + (e.type === 'credit' ? e.amount : -e.amount)
      s += ' ' + (await phrase(langRef.current, after > 0 ? 'balance' : 'clear', { name: e.name, amount: after }))
    }
    tell('ok', s)
    await say(s)
  }

  async function process(text, id) {
    const alive = () => run.current === id
    tell(null, null); go('thinking'); setDbg({ transcript: text })
    let p
    try {
      p = await post('/api/parse', { transcript: text })
    } catch (e) {
      if (!alive()) return
      setDbg((d) => ({ ...d, error: e.message }))
      tell('err', `Could not reach the AI (${e.message}). Enter it manually.`)
      return go('manual')
    }
    if (!alive()) return
    setDbg((d) => ({ ...d, parsed: p }))
    const reply = async (kind, key, v) => {
      go('idle')
      const s = await phrase(langRef.current, key, v)
      tell(kind, s)
      await say(s)
    }

    if (p.intent === 'balance_query') {
      if (!p.customer) {
        const owing = customers.map((c) => bal(c.id)).filter((b) => b > 0)
        return reply('ok', 'total', { count: owing.length, amount: owing.reduce((s, b) => s + b, 0) })
      }
      let m = matchCustomer(p.customer, customers)
      if (m.status === 'new') return reply('err', 'nf', { name: p.customer })
      if (m.status === 'ambiguous') m = { customer: m.candidates[0] }
      const b = bal(m.customer.id)
      return reply('ok', b > 0 ? 'balance' : 'clear', { name: m.customer.name, amount: b })
    }

    if (p.intent === 'undo' || p.intent === 'correction') {
      const last = lastTxn()
      if (!last) return reply('err', 'unclear')
      const name = nameOf(last.cid)
      if (p.intent === 'undo') {
        ledger.removeTxn(last.id)
        return reply('ok', 'undone', { name, amount: last.amount, type: last.type })
      }
      const patch = { amount: p.amount ?? last.amount, type: p.type ?? last.type }
      ledger.updateTxn(last.id, patch)
      return reply('ok', 'fixed', { name, ...patch })
    }

    if (p.intent === 'entry') {
      const list = await resolveEntries(p.entries, alive)
      if (!alive() || !list) return
      return confirmBatch(list, alive)
    }
    return reply('err', 'unclear')
  }

  // One full conversational turn: listen -> process. Hands-free mode chains turns.
  async function startTurn() {
    const id = ++run.current
    speechSynthesis.cancel()
    tell(null, null); setInterim(''); go('listening')
    const l = hear()
    stopRef.current = l.stop
    let text
    try {
      text = await l.promise
      silent.current = 0
    } catch (e) {
      if (run.current !== id) return
      go('idle')
      if (e.message === 'aborted') return
      if (handsRef.current && e.message === 'no-speech' && ++silent.current < 3) return again()
      if (handsRef.current) { handsRef.current = false; setHands(false) }
      return tell('err', ERR[e.message] || ERR.other)
    }
    if (run.current !== id) return
    await process(text, id)
    if (run.current === id) again()
  }
  const again = () => setTimeout(() => { if (handsRef.current && stageRef.current === 'idle') startTurn() }, 350)

  const tapMic = () => (stageRef.current !== 'idle' ? cancel() : startTurn())
  function toggleHands() {
    if (handsRef.current) return cancel()
    handsRef.current = true; setHands(true); silent.current = 0
    if (stageRef.current === 'idle') startTurn()
  }

  async function scanFile(file) {
    if (!file) return
    const id = ++run.current
    const alive = () => run.current === id
    tell(null, null); go('thinking'); setDbg({ transcript: `[photo] ${file.name}` })
    try {
      const { entries, raw } = await post('/api/scan', { image: await toJpeg(file) })
      setDbg((d) => ({ ...d, parsed: entries, raw }))
      if (!entries.length) { go('idle'); return tell('err', "Couldn't read any entries from that photo. Try a clearer, closer photo.") }
      const list = await resolveEntries(entries, alive)
      if (!alive() || !list) return
      await confirmBatch(list, alive, true)
    } catch (e) {
      if (!alive()) return
      go('idle'); tell('err', `Photo import failed: ${e.message}`)
    }
  }

  async function summary() {
    const rows = customers.map((c) => ({ name: c.name, balance: bal(c.id) })).sort((a, b) => b.balance - a.balance)
    const s = await phrase(langRef.current, 'summary', { rows })
    tell('ok', s); setView('home'); say(s)
  }

  function seed() {
    if (customers.length && !confirm('Replace existing data with sample data?')) return
    ledger.seed(); tell('ok', 'Sample data loaded.')
  }

  const cust = customers.find((c) => c.id === view)
  const busy = stage !== 'idle'
  const chase = chaseList(customers, txns)
  const owed = customers.reduce((s, c) => s + Math.max(0, bal(c.id)), 0)

  return (
    <div className="min-h-screen bg-stone-950 text-stone-50 flex flex-col max-w-xl mx-auto">
      <header className="flex items-center gap-2 p-3 border-b border-stone-800">
        <h1 className="text-xl font-black text-amber-400 mr-auto">खाता बोल</h1>
        <select value={langSel} onChange={(e) => { setLang(e.target.value); if (e.target.value !== 'auto') langRef.current = e.target.value }} className="bg-stone-800 rounded-lg p-2 text-base max-w-40">
          {gemini && <option value="auto">🌐 Auto-detect</option>}
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <button onClick={() => setDebug(!debug)} className={`rounded-lg px-3 py-2 text-sm ${debug ? 'bg-amber-400 text-black' : 'bg-stone-800'}`}>debug</button>
      </header>

      {!SR && <div className="bg-red-700 p-3 text-center font-semibold">Speech recognition needs Chrome. You can still type or scan a photo.</div>}

      <main className="flex-1 p-4 flex flex-col gap-4">
        {view === 'home' && (
          <>
            <div className="flex flex-col items-center gap-3 pt-2">
              <button
                onClick={tapMic}
                aria-label="Speak"
                className={`w-52 h-52 sm:w-60 sm:h-60 rounded-full text-8xl shadow-2xl active:scale-95 transition ${
                  stage === 'listening' ? 'bg-red-600 animate-pulse' : busy ? 'bg-stone-700' : hands ? 'bg-green-500 text-black' : 'bg-amber-400 text-black'}`}
              >
                {stage === 'listening' ? '■' : '🎤'}
              </button>
              <p className="text-lg text-stone-300 min-h-7 text-center">
                {stage === 'listening' ? interim || 'बोलिए… Listening' : stage === 'thinking' ? 'सोच रहा हूँ…' : busy ? '' : hands ? 'Hands-free on…' : 'माइक दबाकर बोलिए'}
              </p>
            </div>

            {stage === 'pick' && (
              <Card>
                <p className="text-lg mb-3">कौन? Which one?</p>
                <div className="flex gap-3 flex-wrap">
                  {options.map((c) => <Big key={c.id} onClick={() => tapRef.current?.(c)} cls="bg-amber-400 text-black">{c.name}</Big>)}
                </div>
                <Big onClick={cancel} cls="bg-stone-700 mt-3 w-full">✕ Cancel</Big>
              </Card>
            )}

            {stage === 'confirm' && pending && (
              <Card>
                <div className="max-h-72 overflow-auto divide-y divide-stone-800">
                  {pending.map((e, i) => (
                    <div key={i} className="py-2">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-2xl font-black">{e.name} {e.isNew && <span className="text-xs bg-sky-600 rounded px-2 py-1 align-middle">NEW</span>}</span>
                        <span className={`text-3xl font-black ${e.type === 'credit' ? 'text-red-400' : 'text-green-400'}`}>{e.type === 'credit' ? '+' : '−'}₹{e.amount}</span>
                      </div>
                      {e.warn && <p className="text-amber-300 text-base">⚠ Already owes ₹{e.warn.balance}{e.warn.oldestDays >= 7 && ` · oldest ${e.warn.oldestDays} days`}</p>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-3">
                  <Big onClick={() => tapRef.current?.('yes')} cls="bg-green-600 flex-1">✓ सही</Big>
                  <Big onClick={() => tapRef.current?.('no')} cls="bg-red-600 flex-1">✕ गलत</Big>
                </div>
              </Card>
            )}

            {stage === 'manual' && <ManualForm customers={customers} onCancel={cancel} onSave={(e) => save([e])} />}

            {message?.text && (
              <div className={`rounded-2xl p-4 text-xl font-semibold ${message.kind === 'ok' ? 'bg-green-900' : 'bg-red-900'}`}>{message.text}</div>
            )}

            {stage === 'idle' && (
              <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { const id = ++run.current; process(typed.trim(), id); setTyped('') } }} className="flex gap-2">
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="या type करें: Ramesh ne 200 ka udhaar liya"
                  className="flex-1 bg-stone-800 rounded-xl p-3 text-base" />
                <button className="bg-stone-700 rounded-xl px-4">↵</button>
              </form>
            )}

            {stage === 'idle' && chase.length > 0 && (
              <Card>
                <p className="text-stone-400 text-sm mb-2">पहले किससे मांगें · Chase first <span className="float-right">कुल ₹{owed}</span></p>
                {chase.map(({ c, balance, oldestDays }) => (
                  <button key={c.id} onClick={() => setView(c.id)} className="w-full flex justify-between py-2 text-xl text-left">
                    <span className="font-bold">{c.name}</span>
                    <span><span className="text-stone-400 text-base mr-2">{oldestDays}d</span><span className="text-red-400 font-black">₹{balance}</span></span>
                  </button>
                ))}
              </Card>
            )}

            <div className="flex gap-2 flex-wrap">
              <button onClick={toggleHands} className={`rounded-xl px-4 py-3 font-bold ${hands ? 'bg-green-500 text-black' : 'bg-stone-800'}`}>🎧 Hands-free</button>
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="bg-stone-800 rounded-xl px-4 py-3 disabled:opacity-40">📷 Scan khata</button>
              <button onClick={summary} className="bg-stone-800 rounded-xl px-4 py-3">📋 Weekly summary</button>
              <button onClick={() => go('manual')} className="bg-stone-800 rounded-xl px-4 py-3">✍ Manual entry</button>
              <button onClick={seed} className="bg-stone-800 rounded-xl px-4 py-3">🌱 Sample data</button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { scanFile(e.target.files[0]); e.target.value = '' }} />
            </div>

            {debug && (
              <pre className="bg-black rounded-xl p-3 text-xs text-green-300 overflow-auto whitespace-pre-wrap">
                {JSON.stringify({ lang, engine: gemini ? 'gemini' : 'chrome', ...dbg }, null, 2)}
              </pre>
            )}
          </>
        )}

        {view === 'list' && <CustomerList customers={customers} txns={txns} open={setView} settings={settings} setSettings={ledger.setSettings} />}
        {cust && <CustomerDetail c={cust} txns={txns} lang={lang} settings={settings} back={() => setView('list')} setPhone={ledger.setPhone} />}
      </main>

      <nav className="grid grid-cols-2 border-t border-stone-800 text-lg font-bold">
        <button onClick={() => setView('home')} className={`p-4 ${view === 'home' ? 'text-amber-400' : ''}`}>🎤 बोलो</button>
        <button onClick={() => setView('list')} className={`p-4 ${view !== 'home' ? 'text-amber-400' : ''}`}>👥 ग्राहक</button>
      </nav>
    </div>
  )
}

const Card = ({ children }) => <div className="bg-stone-900 border border-stone-700 rounded-2xl p-4">{children}</div>
const Big = ({ cls = '', ...p }) => <button {...p} className={`rounded-2xl text-2xl font-bold py-4 px-6 ${cls}`} />

function ManualForm({ customers, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('credit')
  const existing = customers.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
  const ok = name.trim() && Number(amount) > 0
  return (
    <Card>
      <input list="names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="w-full bg-stone-800 rounded-xl p-3 text-xl mb-3" />
      <datalist id="names">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ Amount" className="w-full bg-stone-800 rounded-xl p-3 text-xl mb-3" />
      <div className="flex gap-3 mb-3">
        {[['credit', 'उधार'], ['payment', 'वापस']].map(([v, l]) => (
          <Big key={v} onClick={() => setType(v)} cls={`flex-1 ${type === v ? 'bg-amber-400 text-black' : 'bg-stone-800'}`}>{l}</Big>
        ))}
      </div>
      <div className="flex gap-3">
        <Big onClick={onCancel} cls="bg-stone-700">✕</Big>
        <Big disabled={!ok} onClick={() => onSave({ cid: existing?.id ?? null, name: existing?.name ?? name.trim(), amount: Number(amount), type })} cls="bg-green-600 flex-1 disabled:opacity-40">✓ Save</Big>
      </div>
    </Card>
  )
}
