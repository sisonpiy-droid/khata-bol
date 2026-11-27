import { useEffect, useRef, useState } from 'react'
import { SR, hasVoice, listen, listenAudio, speak } from './lib/speech.js'
import { api, session } from './lib/api.js'
import { LANGS, spokenLang } from './lib/languages.js'
import { createVoice } from './lib/voice.js'
import Home from './Home.jsx'
import Ledger from './Ledger.jsx'
import Reports from './Reports.jsx'
import Reminders from './Reminders.jsx'
import { Btn, Chip, Icon, inr } from './ui.jsx'

const EMPTY = { shop: { name: '' }, stats: { outstanding_paise: 0, owing_count: 0 }, customers: [], recent: [], today: { credit_paise: 0, payment_paise: 0 }, report: null }

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode: preferences just won't persist */ } },
}
const savedLang = () => { const l = store.get('khata.lang'); return LANGS.some((x) => x.code === l) ? l : 'hi-IN' }
const NAV = [['home', 'Speak', 'mic'], ['ledger', 'Customers', 'users'], ['reports', 'Reports', 'chart'], ['reminders', 'Reminders', 'bell']]
const hasNotifications = () => typeof Notification !== 'undefined'

export default function App() {
  const [data, setData] = useState(null) // null = still loading
  const [cfg, setCfg] = useState({ shop: '', demo: false, ai: false, stt: false })
  const [lang, setLangState] = useState(savedLang)
  const [tab, setTab] = useState('home')
  const [v, setV] = useState({ mode: 'idle', dlg: 'idle', heard: null, interim: '', reply: null, err: null, canRetry: false, pid: null, source: 'voice' })
  const [typed, setTyped] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [voiceOk, setVoiceOk] = useState(true)
  const [knVoice, setKnVoice] = useState(false)
  const [showTips, setShowTips] = useState(() => store.get('khata.tips') !== 'done')
  const [dueNow, setDueNow] = useState([]) // newly due reminders shown as an in-app banner
  const [perm, setPerm] = useState(hasNotifications() ? Notification.permission : 'denied')
  const langRef = useRef(lang)
  const sttRef = useRef(false) // Gemini audio recognizer available and healthy
  const knVoiceRef = useRef(false)
  const ctl = useRef(null)
  langRef.current = lang

  // Recognition language is what the user speaks; reply language is one this device can actually speak.
  const replyLang = () => (langRef.current.startsWith('kn') && !knVoiceRef.current ? 'hi-IN' : langRef.current)
  const refresh = () => api.state().then(setData).catch(() => {})

  if (!ctl.current) {
    ctl.current = createVoice({
      converse: (body) => api.converse({ session, ...body }),
      listen: (l, onInterim) => {
        if (!sttRef.current) return listen(l, onInterim)
        const g = listenAudio(onInterim)
        return { stop: g.stop, promise: g.promise.catch((e) => { if (e.message === 'server') { sttRef.current = false; throw new Error('other') } throw e }) }
      },
      speak: (text) => speak(text, spokenLang(replyLang())),
      cancelSpeech: () => window.speechSynthesis?.cancel(),
      getLang: () => langRef.current,
      getReplyLang: replyLang,
      supported: () => !!SR || sttRef.current,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      hidden: () => document.hidden,
      refresh,
      onChange: setV,
    })
  }
  const voice = ctl.current

  // Reminders that have come due. The server records what was delivered, so repeated checks never repeat a notice.
  // This runs only while the app is open: a closed tab cannot be reminded (an always-on scheduler would reuse the same endpoints).
  async function checkDue() {
    if (document.hidden || !navigator.onLine) return
    try {
      const list = await api.dueNotifications()
      if (!list.length) return
      setDueNow((cur) => [...cur.filter((c) => !list.some((n) => n.id === c.id)), ...list])
      for (const n of list) {
        if (hasNotifications() && Notification.permission === 'granted') {
          try { new Notification('Khata Bol: payment due', { body: `${n.customer_name} · ${inr(n.amount_paise ?? Math.max(n.balance_paise, 0))}`, tag: `${n.id}${n.fire_key}` }) } catch { /* some browsers only allow it from a service worker */ }
        }
        await api.ackNotification(n.id, n.fire_key)
      }
      refresh()
    } catch { /* offline or server restarting: the Reminders screen still lists everything due */ }
  }

  useEffect(() => {
    refresh(); checkDue()
    api.config().then((c) => { setCfg(c); sttRef.current = c.stt }).catch(() => {})
    hasVoice('kn-IN').then((ok) => { knVoiceRef.current = ok; setKnVoice(ok) })
    Promise.all([hasVoice('hi-IN'), hasVoice('en-IN')]).then(([a, b]) => setVoiceOk(a || b))
    voice.resume() // an unfinished entry survives a page refresh
    const vis = () => { if (document.hidden) voice.hidden(); else checkDue() } // a background tab must not keep the microphone or voice running
    const up = () => { setOnline(true); refresh(); checkDue() }, down = () => setOnline(false)
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    const poll = setInterval(checkDue, 60_000)
    // The app greets once, on the first touch (browsers only allow speech after a user gesture).
    const greet = (e) => {
      if (e.target.closest?.('[data-mic]')) return
      window.removeEventListener('pointerdown', greet); window.removeEventListener('keydown', greet)
      api.converse({ session, action: 'greet', lang: langRef.current, reply: replyLang() }).then((r) => speak(r.say, spokenLang(replyLang()))).catch(() => {})
    }
    window.addEventListener('pointerdown', greet); window.addEventListener('keydown', greet)
    return () => {
      voice.dispose(); clearInterval(poll)
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('online', up); window.removeEventListener('offline', down)
      window.removeEventListener('pointerdown', greet); window.removeEventListener('keydown', greet)
    }
  }, [])

  const setLang = (l) => { langRef.current = l; setLangState(l); store.set('khata.lang', l); voice.languageChanged() }
  const goHome = (fn) => { setTab('home'); fn() }

  const actions = {
    mic: () => voice.tapMic(),
    typed: () => { const t = typed.trim(); if (t) { setTyped(''); voice.submitText(t) } },
    say: (t) => voice.submitText(t),
    dictated: (t) => voice.submitText(t, 'dictation'), // text from the user's own dictation tool; labelled as such, confirmed like any other input
    confirm: () => voice.confirm(),
    cancel: () => voice.cancel(),
    choose: (id) => voice.choose(id),
    chooseType: (t) => voice.chooseType(t),
    option: (value) => voice.option(value),
    briefing: () => goHome(() => voice.briefing()), // spoken only when asked: never automatically on open
    hear: (t) => goHome(() => voice.submitText(t)),
    reverse: (txnId) => goHome(() => voice.reverse(txnId)),
    openTab: setTab,
    retry: () => voice.retry(),
    reset: async () => {
      if (!confirm('Reset demo data? This restores the sample shop and removes entries and reminders made in this demo.')) return
      try { await api.resetDemo(); voice.clear(); setDueNow([]); refresh() } catch { /* the banner/err state covers connectivity */ }
    },
  }
  const tips = { show: showTips && !v.reply, dismiss: () => { store.set('khata.tips', 'done'); setShowTips(false) } }
  const notify = {
    supported: hasNotifications(), permission: perm,
    ask: async () => { try { setPerm(await Notification.requestPermission()) } catch { setPerm('denied') } },
  }

  const live = (a = []) => a.filter((c) => !c.settled && !c.linked_reversed)
  const badge = data?.report ? live(data.report.due_today).length + live(data.report.overdue).length : 0
  const level = LANGS.find((l) => l.code === lang)?.level
  const hint = lang.startsWith('kn')
    ? `ಕನ್ನಡ beta: basic phrases work without a key. ${knVoice ? 'Replies are spoken in Kannada.' : 'This device has no Kannada voice, so replies are spoken in Hinglish.'} Not yet verified with native speakers.`
    : level === 'beta' && !cfg.ai ? `${LANGS.find((l) => l.code === lang).label}: Chrome can hear it, but understanding it needs AI enhancement, which is not configured. Hindi and English work fully without any key.` : null

  const tabBtn = (id, l, ic, cls, textCls) => (
    <button key={id} onClick={() => setTab(id)} aria-current={tab === id} className={`${cls} ${tab === id ? textCls[0] : textCls[1]}`}>
      <span className="relative"><Icon n={ic} className={cls.includes('flex-col') ? 'w-6 h-6' : 'w-4 h-4'} />{id === 'reminders' && badge > 0 && <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-brick text-white text-[10px] font-bold grid place-items-center" aria-label={`${badge} due`}>{badge}</span>}</span>{l}
    </button>
  )

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-line no-print">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => setTab('home')} className="flex items-center gap-3 mr-auto text-left" aria-label="Khata Bol home">
            <span className="w-10 h-10 rounded-xl grid place-items-center bg-forest text-white"><Icon n="book" className="w-5 h-5" /></span>
            <span className="leading-none"><span className="block font-display text-2xl font-extrabold">Khata Bol</span><span className="text-[11px] font-bold tracking-widest text-muted uppercase">खाता बोल</span></span>
          </button>
          <nav className="hidden sm:flex gap-1 bg-card border border-line rounded-full p-1" aria-label="Sections">
            {NAV.map(([id, l, ic]) => tabBtn(id, l, ic, 'inline-flex items-center gap-2 rounded-full px-4 min-h-11 text-sm font-bold', ['bg-forest text-white', 'text-forest hover:bg-mint']))}
          </nav>
        </div>
      </header>

      {!online && (
        <div role="alert" className="bg-ink text-paper text-sm font-semibold py-2 px-4 text-center no-print">
          Internet band hai · No internet. Khata Bol cannot work offline: voice recognition and saving both need a connection. Your saved entries and reminders are safe on the server.
        </div>
      )}
      {!SR && !cfg.stt && <div className="bg-brick text-white text-center text-sm font-semibold py-2 px-4 no-print">Speech recognition needs Chrome. You can still type below.</div>}
      {dueNow.length > 0 && (
        <div role="status" className="bg-amber-soft border-b border-amber/20 px-4 py-3 no-print">
          <div className="max-w-6xl mx-auto flex items-start gap-3">
            <Icon n="bell" className="w-5 h-5 text-amber mt-0.5 shrink-0" />
            <p className="flex-1 font-semibold text-amber">Payment due: {dueNow.slice(0, 3).map((n) => `${n.customer_name} ${inr(n.amount_paise ?? Math.max(n.balance_paise, 0))}`).join(', ')}{dueNow.length > 3 ? ` and ${dueNow.length - 3} more` : ''}</p>
            <button onClick={() => { setTab('reminders'); setDueNow([]) }} className="min-h-11 px-3 font-bold text-forest">Open</button>
            <button onClick={() => setDueNow([])} aria-label="Dismiss" className="min-w-11 min-h-11 grid place-items-center text-muted"><Icon n="x" /></button>
          </div>
        </div>
      )}

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 pb-28 sm:pb-10">
        {tab === 'home' && (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold">Namaste 🙏 <span className="text-forest">{cfg.shop || data?.shop?.name}</span></h1>
              {cfg.demo && <Chip tone="warn">Demo shop · synthetic data</Chip>}
              {!cfg.ai && <Chip>AI enhancement not configured · keyless parser active</Chip>}
            </div>
            <Home data={data ?? EMPTY} loading={!data} cfg={cfg} v={v} hint={hint} typed={typed} setTyped={setTyped} lang={lang} setLang={setLang} tips={tips} voiceOk={voiceOk} actions={actions} />
          </>
        )}
        {tab === 'ledger' && <Ledger data={data ?? EMPTY} onReverse={actions.reverse} />}
        {tab === 'reports' && <Reports actions={actions} version={data} />}
        {tab === 'reminders' && <Reminders customers={(data ?? EMPTY).customers} lang={lang} shop={cfg.shop} version={data} onChanged={refresh} notify={notify} />}
      </main>

      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-20 bg-paper/95 backdrop-blur border-t border-line grid grid-cols-4 pb-[env(safe-area-inset-bottom)] no-print" aria-label="Sections">
        {NAV.map(([id, l, ic]) => tabBtn(id, l, ic, 'flex flex-col items-center justify-center gap-0.5 min-h-16 text-[11px] font-bold', ['text-forest', 'text-muted']))}
      </nav>
    </div>
  )
}
