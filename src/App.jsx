import { useEffect, useRef, useState } from 'react'
import { SR, listen, listenAudio, speak } from './lib/speech.js'
import { useLedger, balanceOf } from './lib/store.js'
import { LANGS, phrase, yesNo } from './lib/i18n.js'
import { matchCustomer, score } from './lib/match.js'
import { creditWarning } from './lib/insights.js'
import { CustomerList, CustomerDetail } from './Views.jsx'
import Home from './Home.jsx'
import { Btn, Card, Icon } from './ui.jsx'

const ERR = {
  denied: 'Microphone blocked. Click the lock icon in the address bar and allow the microphone.',
  'no-speech': "Didn't hear anything.",
  unsupported: 'This browser has no speech recognition. Please use Chrome.',
  other: 'Speech recognition failed. Try again.',
}

// Scripted pitch: runs through the real parse/match/confirm pipeline with no mic needed.
const DEMO = [
  'Ramesh ne do sau ka udhaar liya',
  'Abdul ne sau aur Lakshmi ne pachaas wapas diye',
  'Rameshwr ne teen sau ka udhaar liya',
  'Ramesh ka kitna baaki hai?',
  'Total kitna baaki hai?',
  'Last wala hatao',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

// Any image (jpg/png/svg) -> downscaled JPEG data URL for the vision call.
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
  // Async flows (hands-free loop, demo) outlive the render that started them; always read the latest data from here.
  const D = useRef({ customers, txns })
  D.current = { customers, txns }

  const [langSel, setLang] = useState('hi-IN') // 'auto' = follow the language Gemini hears
  const [detected, setDetected] = useState('hi-IN')
  const [gemini, setGemini] = useState(false)
  const lang = langSel === 'auto' ? detected : langSel
  const [view, setView] = useState('home') // 'home' | 'list' | customer id
  const [stage, setStage] = useState('idle') // idle | listening | thinking | pick | confirm | manual
  const [interim, setInterim] = useState('')
  const [pending, setPending] = useState(null) // [{cid, name, amount, type, isNew, warn}]
  const [options, setOptions] = useState([])
  const [message, setMessage] = useState(null) // {kind:'ok'|'err', text, undo}
  const [how, setHow] = useState(false)
  const [dbg, setDbg] = useState({})
  const [typed, setTyped] = useState('')
  const [hands, setHands] = useState(false)
  const [demo, setDemo] = useState(false)
  const run = useRef(0)
  const langRef = useRef('hi-IN')
  langRef.current = lang
  const geminiRef = useRef(false)
  const stopRef = useRef(null)
  const tapRef = useRef(null)
  const stageRef = useRef('idle')
  const handsRef = useRef(false)
  const demoRef = useRef(false)
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
  const bal = (cid) => balanceOf(D.current.txns, cid)
  const lastTxn = () => D.current.txns.reduce((a, b) => (!a || b.ts >= a.ts ? b : a), null)
  const nameOf = (cid) => D.current.customers.find((c) => c.id === cid)?.name ?? '?'
  const tell = (kind, text, undo = 0) => setMessage(text ? { kind, text, undo } : null)

  // Speak `prompt` (string or promise), then wait for a voice answer or a button tap, whichever comes first.
  // Taps work immediately, even while speaking. Unclear voice answers re-listen once, then wait for a tap.
  // `auto` (demo mode only) answers by itself after the prompt.
  const ask = (prompt, interpret, auto) =>
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
      say(prompt).then(() => {
        if (demoRef.current && auto !== undefined) return void setTimeout(() => tapRef.current?.(auto), 1400)
        attempt(0)
      })
    })

  function cancel() {
    run.current++
    demoRef.current = false; setDemo(false)
    handsRef.current = false; setHands(false)
    stopRef.current?.(); tapRef.current?.(null)
    speechSynthesis.cancel()
    go('idle'); setPending(null); setInterim('')
  }

  // Match each spoken name to the ledger; ask the shopkeeper when two customers look alike.
  async function resolveEntries(entries, alive) {
    const out = []
    for (const e of entries) {
      let m = matchCustomer(e.customer, D.current.customers)
      if (m.status === 'ambiguous') {
        setOptions(m.candidates); go('pick')
        const chosen = await ask(phrase(langRef.current, 'pick', { a: m.candidates[0].name, b: m.candidates[1].name }), (tx) => {
          const best = m.candidates.map((c) => ({ c, s: score(tx, c.name) })).sort((a, b) => b.s - a.s)[0]
          return best.s >= 0.6 ? best.c : null
        }, m.candidates[0])
        if (!alive() || !chosen) return null
        m = { status: 'match', customer: chosen }
      }
      const cid = m.customer?.id ?? null
      out.push({
        cid, name: m.customer?.name ?? e.customer, amount: e.amount, type: e.type, isNew: !cid,
        warn: e.type === 'credit' ? creditWarning(D.current.txns, cid, e.amount) : null,
      })
    }
    return out
  }

  async function confirmBatch(list, alive, scan) {
    setPending(list); go('confirm')
    const L = () => langRef.current
    const spoken = scan
      ? phrase(L(), 'scan', { count: list.length, total: list.reduce((s, e) => s + e.amount, 0) })
      : Promise.all([
          ...list.filter((e) => e.warn).map((e) => phrase(L(), 'warn', { name: e.name, balance: e.warn.balance, oldestDays: e.warn.oldestDays })),
          phrase(L(), 'readback', { entries: list.map((e) => ({ name: e.name, amount: e.amount, type: e.type })) }),
        ]).then((a) => a.join(' '))
    const yn = await ask(spoken, yesNo, 'yes')
    if (!alive()) return
    if (yn === 'yes') await save(list)
    else { go('idle'); setPending(null); setInterim('') }
  }

  async function save(list) {
    ledger.addMany(list)
    navigator.vibrate?.(30)
    go('idle'); setPending(null); setInterim('')
    const L = langRef.current
    let s = await phrase(L, 'saved')
    if (list.length === 1) {
      const e = list[0]
      const after = (e.cid ? bal(e.cid) : 0) + (e.type === 'credit' ? e.amount : -e.amount)
      s += ' ' + (await phrase(L, after > 0 ? 'balance' : 'clear', { name: e.name, amount: after }))
    }
    tell('ok', s, list.length)
    await say(s)
  }

  function undoLast() {
    const n = message?.undo || 0
    ;[...D.current.txns].sort((a, b) => b.ts - a.ts).slice(0, n).forEach((t) => ledger.removeTxn(t.id))
    tell('ok', 'Undone.')
  }

  async function process(text, id) {
    const alive = () => run.current === id
    tell(null); go('thinking'); setDbg({ transcript: text })
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
        const owing = D.current.customers.map((c) => bal(c.id)).filter((b) => b > 0)
        return reply('ok', 'total', { count: owing.length, amount: owing.reduce((s, b) => s + b, 0) })
      }
      let m = matchCustomer(p.customer, D.current.customers)
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
    tell(null); setInterim(''); go('listening')
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

  async function runDemo() {
    if (stageRef.current !== 'idle') return
    demoRef.current = true; setDemo(true); setView('home')
    if (!D.current.customers.length) { ledger.seed(); await sleep(300) }
    for (const line of DEMO) {
      if (!demoRef.current) return
      const id = ++run.current
      setInterim('')
      await process(line, id)
      if (!demoRef.current) return
      if (stageRef.current === 'manual') break // API unreachable: stop the show instead of looping errors
      await sleep(2200)
    }
    demoRef.current = false; setDemo(false)
  }

  async function scanFile(file) {
    if (!file) return
    const id = ++run.current
    const alive = () => run.current === id
    tell(null); go('thinking'); setDbg({ transcript: `[photo] ${file.name}` })
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
    setView('home')
    const rows = D.current.customers.map((c) => ({ name: c.name, balance: bal(c.id) })).sort((a, b) => b.balance - a.balance)
    const s = await phrase(langRef.current, 'summary', { rows })
    tell('ok', s); say(s)
  }

  function seed() {
    if (D.current.customers.length && !confirm('Replace existing data with sample data?')) return
    ledger.seed(); tell('ok', 'Sample shop loaded.')
  }

  const cust = customers.find((c) => c.id === view)
  const nav = [['home', 'Speak', 'mic'], ['list', 'Customers', 'users']]
  const section = view === 'home' ? 'home' : 'list'

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => setView('home')} className="flex items-center gap-3 mr-auto text-left">
            <span className="w-10 h-10 rounded-xl grid place-items-center bg-[radial-gradient(circle_at_30%_25%,#FFC864,#F0901A_55%,#D9680B)] text-ink shadow"><Icon n="mic" className="w-5 h-5" sw={2.4} /></span>
            <span className="leading-none"><span className="block font-display text-2xl font-extrabold">खाता बोल</span><span className="text-xs font-bold tracking-widest text-muted uppercase">Khata Bol</span></span>
          </button>
          <nav className="hidden lg:flex gap-1 bg-card border border-line rounded-full p-1">
            {nav.map(([v, l, ic]) => (
              <button key={v} onClick={() => setView(v)} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${section === v ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-amber-soft'}`}><Icon n={ic} className="w-4 h-4" />{l}</button>
            ))}
          </nav>
          <label className="relative inline-flex items-center">
            <Icon n="globe" className="w-4 h-4 absolute left-3 pointer-events-none text-ink-soft" />
            <select value={langSel} aria-label="Language" onChange={(e) => { setLang(e.target.value); if (e.target.value !== 'auto') langRef.current = e.target.value }}
              className="appearance-none bg-card border border-line rounded-full pl-9 pr-4 py-2 text-sm font-bold max-w-40">
              {gemini && <option value="auto">Auto-detect</option>}
              {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
          <button onClick={() => setHow(!how)} aria-pressed={how} aria-label="How it works" className={`w-10 h-10 rounded-full grid place-items-center border ${how ? 'bg-saffron border-saffron text-ink' : 'bg-card border-line'}`}><Icon n="sparkle" className="w-5 h-5" /></button>
        </div>
      </header>

      {!SR && !gemini && (
        <div className="bg-brick text-white text-center text-sm font-semibold py-2 px-4">Speech recognition needs Chrome. You can still type, scan a photo, or run the auto-demo.</div>
      )}

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 pb-28 lg:pb-10">
        {view === 'home' && (
          <Home
            stage={stage} interim={interim} dbg={dbg} pending={pending} options={options} message={message}
            hands={hands} demo={demo} how={how} lang={lang} engine={gemini ? 'gemini' : 'chrome'}
            data={{ customers, txns }} typed={typed} setTyped={setTyped}
            onMic={tapMic} onTap={(v) => tapRef.current?.(v)} onCancel={cancel} onUndo={undoLast}
            onType={() => { if (typed.trim()) { const id = ++run.current; process(typed.trim(), id); setTyped('') } }}
            toggleHands={toggleHands} scan={() => fileRef.current?.click()} summary={summary} runDemo={runDemo} seed={seed}
            openManual={() => go('manual')} openCustomer={setView}
            manual={<ManualForm customers={customers} onCancel={cancel} onSave={(e) => save([e])} />}
          />
        )}
        {view === 'list' && <CustomerList customers={customers} txns={txns} open={setView} settings={settings} setSettings={ledger.setSettings} />}
        {cust && <CustomerDetail c={cust} txns={txns} lang={lang} settings={settings} back={() => setView('list')} setPhone={ledger.setPhone} />}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { scanFile(e.target.files[0]); e.target.value = '' }} />
      </main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-paper/95 backdrop-blur border-t border-line grid grid-cols-2 pb-[env(safe-area-inset-bottom)]">
        {nav.map(([v, l, ic]) => (
          <button key={v} onClick={() => setView(v)} className={`flex flex-col items-center gap-0.5 py-3 text-xs font-bold ${section === v ? 'text-saffron-deep' : 'text-muted'}`}>
            <Icon n={ic} className="w-6 h-6" />{l}
          </button>
        ))}
      </nav>
    </div>
  )
}

function ManualForm({ customers, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('credit')
  const existing = customers.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
  const ok = name.trim() && Number(amount) > 0
  return (
    <Card className="w-full max-w-md animate-rise">
      <input list="names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="w-full bg-paper border border-line rounded-xl px-4 py-3 text-lg mb-3" />
      <datalist id="names">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ Amount" className="w-full bg-paper border border-line rounded-xl px-4 py-3 text-lg mb-3" />
      <div className="grid grid-cols-2 gap-2 mb-3">
        {[['credit', 'उधार · Udhaar'], ['payment', 'वापस · Paid']].map(([v, l]) => (
          <Btn key={v} tone={type === v ? 'saffron' : 'soft'} onClick={() => setType(v)}>{l}</Btn>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Btn tone="brick" onClick={onCancel} aria-label="Cancel"><Icon n="x" /></Btn>
        <Btn tone="leaf" disabled={!ok} onClick={() => onSave({ cid: existing?.id ?? null, name: existing?.name ?? name.trim(), amount: Number(amount), type })}><Icon n="check" sw={3} /> Save</Btn>
      </div>
    </Card>
  )
}
