import { useEffect, useReducer, useRef, useState } from 'react'
import { SR, listen, listenAudio, speak } from './lib/speech.js'
import { api } from './lib/api.js'
import { LANGS, spokenLang } from './lib/languages.js'
import { initial, reduce } from './lib/machine.js'
import Home from './Home.jsx'
import Ledger from './Ledger.jsx'
import { Chip, Icon } from './ui.jsx'

const MSG = {
  denied: 'Microphone is blocked. Click the lock icon in the address bar, set Microphone to Allow, then reload this page.',
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
  unsupported: 'This browser has no speech recognition. Please use Chrome, or type below.',
  other: 'Speech recognition failed. Try again, or type below.',
}
const OFFLINE = 'Maaf kijiye, server se connect nahi ho paaya. Kuch save nahi hua.'
const AGAIN = 'Maaf kijiye, dobara boliye.'

const newSession = () => {
  try {
    const k = localStorage.getItem('khata.session')
    if (k) return k
    const id = crypto.randomUUID()
    localStorage.setItem('khata.session', id)
    return id
  } catch { return `s-${Math.random().toString(36).slice(2, 12)}` }
}

export default function App() {
  const [data, setData] = useState({ shop: { name: '' }, stats: { outstanding_paise: 0, owing_count: 0 }, customers: [], recent: [], today: { credit_paise: 0, payment_paise: 0 } })
  const [cfg, setCfg] = useState({ shop: '', demo: false, ai: false, stt: false })
  const [vm, setVm] = useState(initial)
  const [, force] = useReducer((x) => x + 1, 0)
  const [lang, setLang] = useState('hi-IN')
  const [tab, setTab] = useState('home')
  const [heard, setHeard] = useState(null)
  const [reply, setReply] = useState(null)
  const [interim, setInterim] = useState('')
  const [err, setErr] = useState(null)
  const [typed, setTyped] = useState('')
  const vmRef = useRef(initial)
  const langRef = useRef(lang)
  const sttRef = useRef(false) // Gemini audio recognizer available and healthy
  const stopRef = useRef(null)
  const session = useRef(newSession()).current
  langRef.current = lang

  const send = (e) => { const n = reduce(vmRef.current, e); vmRef.current = n; setVm(n); return n }
  const say = (t) => speak(t, spokenLang(langRef.current))
  const refresh = () => api.state().then(setData).catch(() => {})

  useEffect(() => {
    refresh()
    api.config().then((c) => { setCfg(c); sttRef.current = c.stt; force() }).catch(() => setErr(OFFLINE))
  }, [])

  // The app greets once, on the first touch (browsers only allow speech after a user gesture).
  useEffect(() => {
    const greet = (e) => {
      if (e.target.closest?.('[data-mic]')) return
      window.removeEventListener('pointerdown', greet); window.removeEventListener('keydown', greet)
      api.converse({ session, action: 'greet', lang: langRef.current }).then((r) => say(r.say)).catch(() => {})
    }
    window.addEventListener('pointerdown', greet); window.addEventListener('keydown', greet)
    return () => { window.removeEventListener('pointerdown', greet); window.removeEventListener('keydown', greet) }
  }, [])

  const hear = () => {
    if (!sttRef.current) return listen(langRef.current, setInterim)
    const l = listenAudio(setInterim)
    return { stop: l.stop, promise: l.promise.catch((e) => { if (e.message === 'server') { sttRef.current = false; e = new Error('other') } throw e }) }
  }

  function interrupt() {
    speechSynthesis.cancel(); stopRef.current?.()
    if (['speaking', 'listening'].includes(vmRef.current.name)) send({ type: 'STOP' })
  }

  async function turn(body, typedInput = false) {
    if (['processing', 'saving'].includes(vmRef.current.name)) return // one request at a time: no double-submit
    const voice = !typedInput && !body.action // a spoken turn arrives while we are in 'listening'; taps interrupt whatever is going on
    if (!voice) interrupt()
    send({ type: voice ? 'HEARD' : body.action === 'confirm' ? 'CONFIRM' : 'TYPED' })
    if (vmRef.current.name !== 'processing' && vmRef.current.name !== 'saving') return
    setHeard(body.text ?? null); setErr(null)
    let r
    try {
      r = await api.converse({ session, lang: langRef.current, ...body })
    } catch {
      send({ type: 'FAIL' }); setErr(OFFLINE) // never pretend it was saved
      send({ type: 'STOP' }); return say(OFFLINE)
    }
    setReply(r); send({ type: 'REPLY', next: r.state }); refresh()
    await say(r.say)
    if (vmRef.current.name !== 'speaking') return // interrupted by a tap: the new action owns the state now
    send({ type: 'SPOKEN' })
    if (r.expect) listenOnce(0) // the app asked a question: listen for the answer
  }

  async function listenOnce(attempt = 0) {
    if (!SR && !sttRef.current) return setErr(MSG.unsupported)
    speechSynthesis.cancel()
    if (send({ type: 'LISTEN' }).name !== 'listening') return
    setInterim(''); setErr(null)
    const l = hear(); stopRef.current = l.stop
    try {
      const text = await l.promise
      turn({ text })
    } catch (e) {
      if (e.message === 'aborted') return
      if (e.message === 'no-speech' && vmRef.current.dlg !== 'idle' && attempt < 1) {
        send({ type: 'SAY' }); await say(AGAIN); send({ type: 'SPOKEN' })
        return listenOnce(attempt + 1)
      }
      send({ type: 'FAIL' }); setErr(MSG[e.message] ?? MSG.other)
    }
  }

  const actions = {
    mic: () => {
      const n = vmRef.current.name
      if (n === 'listening') { stopRef.current?.(); return send({ type: 'STOP' }) }
      if (['processing', 'saving'].includes(n)) return
      if (n === 'speaking') interrupt() // talk over the app: stop its voice, then listen
      listenOnce(0)
    },
    typed: () => { const t = typed.trim(); if (t) { setTyped(''); turn({ text: t }, true) } },
    say: (t) => turn({ text: t }, true),
    confirm: () => turn({ action: 'confirm' }),
    cancel: () => turn({ action: 'cancel' }, true),
    choose: (id) => turn({ action: 'choose', choice: id }, true),
    reverse: (txnId) => { setTab('home'); turn({ action: 'reverse', txnId }, true) },
    reset: async () => {
      if (!confirm('Reset demo data? This restores the sample shop and removes entries made during the demo.')) return
      try { await api.resetDemo(); setReply(null); setHeard(null); setErr(null); refresh() } catch (e) { setErr(e.message) }
    },
  }

  const level = LANGS.find((l) => l.code === lang)?.level
  const hint = level === 'beta' && !cfg.ai ? `${LANGS.find((l) => l.code === lang).label}: Chrome can hear it, but understanding it needs AI enhancement, which is not configured. Hindi and English work fully without any key.` : null

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => setTab('home')} className="flex items-center gap-3 mr-auto text-left" aria-label="Khata Bol home">
            <span className="w-10 h-10 rounded-xl grid place-items-center bg-forest text-white"><Icon n="book" className="w-5 h-5" /></span>
            <span className="leading-none"><span className="block font-display text-2xl font-extrabold">Khata Bol</span><span className="text-[11px] font-bold tracking-widest text-muted uppercase">खाता बोल</span></span>
          </button>
          <nav className="hidden sm:flex gap-1 bg-card border border-line rounded-full p-1" aria-label="Sections">
            {[['home', 'Speak', 'mic'], ['ledger', 'Customers', 'users']].map(([v, l, ic]) => (
              <button key={v} onClick={() => setTab(v)} aria-current={tab === v} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${tab === v ? 'bg-forest text-white' : 'text-forest hover:bg-mint'}`}><Icon n={ic} className="w-4 h-4" />{l}</button>
            ))}
          </nav>
          <label className="relative inline-flex items-center">
            <Icon n="globe" className="w-4 h-4 absolute left-3 pointer-events-none text-forest" />
            <select value={lang} aria-label="Language" onChange={(e) => setLang(e.target.value)} className="appearance-none bg-card border border-line rounded-full pl-9 pr-4 py-2 text-sm font-bold max-w-44">
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}{l.level === 'beta' ? ' (beta)' : ''}</option>)}
            </select>
          </label>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 pb-28 sm:pb-10">
        {tab === 'home' ? (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold">Namaste 🙏 <span className="text-forest">{cfg.shop || data.shop.name}</span></h1>
              {cfg.demo && <Chip tone="warn">Demo shop · synthetic data</Chip>}
              {!cfg.ai && <Chip>AI enhancement not configured · keyless parser active</Chip>}
            </div>
            <Home data={data} cfg={cfg} mode={vm.name} dlg={vm.dlg} heard={heard} interim={interim} reply={reply} err={err} hint={hint} typed={typed} setTyped={setTyped} actions={actions} />
          </>
        ) : <Ledger data={data} onReverse={actions.reverse} />}
      </main>

      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-20 bg-paper/95 backdrop-blur border-t border-line grid grid-cols-2 pb-[env(safe-area-inset-bottom)]" aria-label="Sections">
        {[['home', 'Speak', 'mic'], ['ledger', 'Customers', 'users']].map(([v, l, ic]) => (
          <button key={v} onClick={() => setTab(v)} aria-current={tab === v} className={`flex flex-col items-center gap-0.5 py-3 text-xs font-bold ${tab === v ? 'text-forest' : 'text-muted'}`}><Icon n={ic} className="w-6 h-6" />{l}</button>
        ))}
      </nav>
    </div>
  )
}
