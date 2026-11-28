import { useState } from 'react'
import { Avatar, Btn, Card, Chip, Icon, Orb, PRIO, URG, dmy, hmLabel, inr } from './ui.jsx'
import { HistoryRow } from './Ledger.jsx'
import { LANGS } from './lib/languages.js'

const STATUS = {
  idle: ['Tap the mic and speak', 'माइक दबाएँ और बोलें'],
  listening: ['Listening…', 'सुन रहा हूँ'],
  processing: ['Understanding…', 'समझ रहा हूँ'],
  speaking: ['Khata Bol is speaking', 'बोल रहा हूँ'],
  awaiting_confirmation: ["Say “haan” to confirm or “nahi” to cancel", 'हाँ या नहीं बोलें'],
  awaiting_clarification: ['Waiting for your answer', 'आपके जवाब का इंतज़ार'],
  saving: ['Saving…', 'सेव हो रहा है'],
  error: ['Something went wrong', 'कुछ गड़बड़ हुई'],
}
const TRY = ['Ramesh ko 500 rupaye udhaar diye', 'Ramesh ne 200 rupaye wapas diye', 'Ramesh ka kitna baaki hai?', 'Aaj ka hisaab batao']

export default function Home({ data, loading, cfg, v, hint, typed, setTyped, lang, setLang, tips, voiceOk, actions }) {
  const { mode, dlg, heard, interim, reply, err, canRetry, source } = v
  const [s1, s2] = STATUS[mode] ?? STATUS.idle
  const busy = mode === 'processing' || mode === 'saving'
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
      <div className="flex flex-col items-center gap-4">
        <Orb mode={mode} onClick={actions.mic} label={mode === 'listening' ? 'Stop listening' : 'Speak to Khata Bol'} />
        <div className="text-center max-w-md" aria-live="polite">
          <p className="font-display text-2xl sm:text-3xl font-extrabold leading-tight">{mode === 'listening' && interim ? interim : s1}</p>
          <p className="text-muted mt-1">{s2}</p>
        </div>

        <Btn onClick={actions.briefing} disabled={busy} className="w-full max-w-md" aria-label="Hear today's briefing"><Icon n="volume" /> Hear today's briefing</Btn>
        <LangSwitch lang={lang} setLang={setLang} />
        {!voiceOk && <p className="max-w-md text-center text-sm text-muted bg-card border border-line rounded-xl px-3 py-2">This device has no voice for spoken replies. Khata Bol will show every reply as text.</p>}
        {hint && <p className="max-w-md text-center text-sm text-amber bg-amber-soft rounded-xl px-3 py-2">{hint}</p>}
        {err && (
          <Card role="alert" className="w-full max-w-md !bg-brick-soft !border-brick/20 flex gap-3 items-start animate-rise">
            <Icon n="alert" className="w-5 h-5 text-brick shrink-0 mt-0.5" />
            <div className="flex-1"><p className="font-semibold text-brick">{err}</p>
              {canRetry && <Btn tone="brick" onClick={actions.retry} className="mt-2 !py-2 text-sm"><Icon n="refresh" className="w-4 h-4" /> Try again</Btn>}</div>
          </Card>
        )}

        {heard && (
          <p className="w-full max-w-md bg-card border border-line rounded-2xl px-4 py-3 animate-rise">
            <span className="block text-xs font-bold uppercase tracking-wider text-muted">{{ voice: 'You said', typed: 'You typed', dictation: "You dictated (text from your own dictation tool, not Khata Bol's microphone)" }[source] ?? 'You said'}</span>
            <span className="text-xl leading-snug" lang={lang.slice(0, 2)}>“{heard}”</span>
          </p>
        )}
        {reply && (
          <div className="w-full max-w-md animate-rise">
            <p className="bg-forest text-white rounded-2xl rounded-bl-md px-4 py-3 text-lg font-semibold">
              <span className="block text-xs font-bold uppercase tracking-wider text-white/60">Khata Bol</span>{reply.say}
            </p>
            <CardFor card={reply.card} dlg={dlg} busy={busy} actions={actions} />
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); actions.typed() }} className="w-full max-w-md flex gap-2">
          <label className="flex-1 min-w-0 flex items-center gap-2 bg-card border border-line rounded-2xl px-4">
            <Icon n="keyboard" className="w-5 h-5 text-muted shrink-0" />
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type here (fallback)" aria-label="Type a command"
              className="flex-1 min-w-0 bg-transparent py-3 outline-none" />
          </label>
          <Btn tone="soft" aria-label="Send" disabled={busy} className="!px-4"><Icon n="send" /></Btn>
        </form>
        <Dictation busy={busy} actions={actions} />

        {tips.show && <Tips tips={tips} busy={busy} actions={actions} />}
        <div className="w-full max-w-md">
          <p className="text-xs font-bold uppercase tracking-wider text-muted mb-2 text-center">Try saying · tap to run as text</p>
          <div className="flex flex-wrap justify-center gap-2">
            {TRY.map((t) => <button key={t} disabled={busy} onClick={() => actions.say(t)} className="text-sm bg-card border border-line rounded-full px-4 min-h-11 hover:bg-mint disabled:opacity-40">“{t}”</button>)}
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4" aria-busy={loading}>
        {loading ? <Card className="animate-pulse"><div className="h-24 rounded-2xl bg-line/50" /><p className="text-muted mt-3">Loading your khata…</p></Card> : <>
        <Collections data={data} actions={actions} />
        <div className="grid grid-cols-2 gap-3">
          <Stat big label="Total outstanding" value={inr(data.stats.outstanding_paise)} sub={data.stats.owing_count ? `${data.stats.owing_count} customer${data.stats.owing_count > 1 ? 's' : ''} owe you` : 'Nobody owes you anything'} />
          <Stat label="Credit given today" value={inr(data.today.credit_paise)} tone="text-brick" />
          <Stat label="Payments today" value={inr(data.today.payment_paise)} tone="text-forest" />
        </div>
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display text-lg font-extrabold">Recent entries</h3>
            {cfg.demo && <button onClick={actions.reset} className="inline-flex items-center gap-1 min-h-11 px-2 text-xs font-bold text-muted hover:text-brick"><Icon n="refresh" className="w-3.5 h-3.5" /> Reset demo data</button>}
          </div>
          <ul className="divide-y divide-line">{data.recent.slice(0, 8).map((r) => <HistoryRow key={r.id} row={r} onReverse={actions.reverse} />)}</ul>
          {!data.recent.length && <p className="text-muted py-3">No entries yet. Press the mic and say one.</p>}
        </Card>
        </>}
      </aside>
    </div>
  )
}

const Stat = ({ label, value, big, tone = '', sub }) => (
  <div className={`${big ? 'col-span-2 bg-forest text-white' : 'bg-card border border-line'} rounded-2xl p-4`}>
    <p className={`text-[11px] font-bold uppercase tracking-wide ${big ? 'text-white/70' : 'text-muted'}`}>{label}</p>
    <p className={`font-display ${big ? 'text-4xl' : 'text-2xl'} font-extrabold leading-tight mt-0.5 ${tone}`}>{value}</p>
    {sub && <p className={`text-sm font-semibold mt-1 ${big ? 'text-white/80' : 'text-muted'}`}>{sub}</p>}
  </div>
)

function Decision({ busy, actions, yes = 'Confirm · सही है', no = 'Cancel' }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 mt-3">
      <Btn onClick={actions.confirm} disabled={busy} className="text-xl py-4"><Icon n="check" className="w-6 h-6" sw={3} /> {yes}</Btn>
      <Btn tone="brick" onClick={actions.cancel} disabled={busy} className="py-4" aria-label={no}><Icon n="x" className="w-6 h-6" sw={3} /></Btn>
    </div>
  )
}

function CardFor({ card, dlg, busy, actions }) {
  if (!card) return null
  const credit = card.type === 'credit'
  const wrap = 'mt-3 animate-rise'
  if (card.kind === 'pending') return (
    <Card className={wrap}>
      <div className="flex items-center gap-3">
        <Avatar name={card.customer.name} />
        <div className="flex-1 min-w-0"><p className="font-display text-2xl font-extrabold truncate">{card.customer.name} {card.customer.isNew && <Chip tone="good">NEW</Chip>}</p>
          <Chip tone={credit ? 'bad' : 'good'}>{credit ? 'Credit · udhaar' : 'Repayment'}</Chip>{card.large && <> <Chip tone="warn">Large amount · check it</Chip></>}{card.overpay_paise > 0 && <> <Chip tone="warn">{inr(card.overpay_paise)} becomes advance</Chip></>}{card.viaAi && <> <Chip tone="warn">AI-assisted · check carefully</Chip></>}</div>
        <p className={`font-display text-4xl font-extrabold ${credit ? 'text-brick' : 'text-forest'}`}>{credit ? '+' : '−'}{inr(card.amount_paise)}</p>
      </div>
      <p className="text-sm text-muted mt-3">Balance {inr(card.customer.balance_paise)} → <b className="text-ink">{inr(card.after_paise)}</b></p>
      <Decision busy={busy} actions={actions} />
    </Card>
  )
  if (card.kind === 'choice') return (
    <Card className={wrap}>
      <p className="text-sm font-bold text-muted mb-3">Which customer? {card.amount_paise ? <>({credit ? 'credit' : 'repayment'} {inr(card.amount_paise)} kept)</> : null}</p>
      <div className="grid grid-cols-2 gap-3">
        {card.options.map((c) => (
          <button key={c.id} onClick={() => actions.choose(c.id)} disabled={busy} className={`flex items-center gap-3 rounded-2xl p-3 text-left font-bold text-lg active:scale-95 transition disabled:opacity-40 min-h-14 ${c.isNew ? 'border-2 border-dashed border-forest bg-card' : 'bg-mint hover:brightness-95'}`}>
            <Avatar name={c.name} /><span className="min-w-0"><span className="block truncate">{c.name}</span>{c.balance_paise != null && <span className="block text-xs font-semibold text-muted">owes {inr(Math.max(c.balance_paise, 0))}</span>}</span>
          </button>
        ))}
      </div>
      <Btn tone="brick" onClick={actions.cancel} disabled={busy} className="w-full mt-3"><Icon n="x" /> Cancel</Btn>
    </Card>
  )
  if (card.kind === 'reversal') return (
    <Card className={wrap}>
      <Chip tone="warn">Reverse an entry</Chip>
      <p className="mt-2 text-lg"><b>{card.entry.customer_name}</b> · {card.entry.type === 'credit' ? 'credit' : 'payment'} <b>{inr(card.entry.amount_paise)}</b></p>
      <p className="text-sm text-muted">A linked reversal is added. The original stays in history.</p>
      <Decision busy={busy} actions={actions} yes="Reverse it" />
    </Card>
  )
  if (card.kind === 'saved') return (
    <Card className={`${wrap} animate-stamp !bg-mint !border-forest/20`}>
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-forest text-white grid place-items-center"><Icon n="check" sw={3} /></span>
        <div className="flex-1"><p className="font-bold">{card.duplicate ? 'Already saved' : card.reversal ? 'Reversed' : card.added ? 'Customer added' : 'Saved'} · {card.customer.name}</p>
          {card.amount_paise && <p className="text-sm text-muted">{credit ? 'Credit' : 'Payment'} {inr(card.amount_paise)}</p>}{card.date_label && <p className="text-sm text-muted">{card.date_label}{card.time_label ? ` · ${card.time_label}` : ''}</p>}</div>
        <div className="text-right"><p className="text-xs text-muted">Balance now</p><p className="font-display text-2xl font-extrabold">{inr(card.balance_paise)}</p></div>
      </div>
      {card.offer && <><p className="mt-3 text-sm font-semibold">This payment settles a reminder. Mark it complete?</p><Decision busy={busy} actions={actions} yes="Mark complete" no="Not now" /></>}
    </Card>
  )
  if (card.kind === 'balance') return (
    <Card className={`${wrap} flex items-center gap-3`}><Avatar name={card.customer.name} /><p className="flex-1 font-display text-xl font-extrabold">{card.customer.name}</p>
      <p className={`font-display text-3xl font-extrabold ${card.balance_paise > 0 ? 'text-brick' : 'text-forest'}`}>{card.balance_paise > 0 ? inr(card.balance_paise) : 'Clear'}</p></Card>
  )
  if (card.kind === 'summary') return (
    <Card className={`${wrap} grid grid-cols-2 gap-3 text-center`}>
      <div><p className="text-xs font-bold uppercase text-muted">Credit given</p><p className="font-display text-2xl font-extrabold text-brick">{inr(card.credit_paise)}</p></div>
      <div><p className="text-xs font-bold uppercase text-muted">Payments received</p><p className="font-display text-2xl font-extrabold text-forest">{inr(card.payment_paise)}</p></div>
    </Card>
  )
  if (card.kind === 'typechoice') return (
    <Card className={wrap}>
      <p className="text-lg"><b>{card.customer.name}</b> · <b>{inr(card.amount_paise)}</b></p>
      <p className="text-sm text-muted mb-3">Which one is it? I will not guess with money.</p>
      <div className="grid gap-3">
        <Btn onClick={() => actions.chooseType('payment')} disabled={busy} className="text-lg"><Icon n="check" sw={3} /> Payment mili (they paid you)</Btn>
        <Btn tone="soft" onClick={() => actions.chooseType('credit')} disabled={busy} className="text-lg">Udhaar diya (you gave credit)</Btn>
        <Btn tone="brick" onClick={actions.cancel} disabled={busy}><Icon n="x" /> Cancel</Btn>
      </div>
    </Card>
  )
  if (card.kind === 'newcustomer') return (
    <Card className={wrap}>
      <div className="flex items-center gap-3"><Avatar name={card.name} /><p className="flex-1 font-display text-2xl font-extrabold">{card.name} <Chip tone="good">NEW</Chip></p></div>
      <Decision busy={busy} actions={actions} yes="Add customer" />
    </Card>
  )
  if (card.kind === 'total') return (
    <Card className={`${wrap} text-center`}><p className="text-xs font-bold uppercase text-muted">Total outstanding</p><p className="font-display text-4xl font-extrabold text-brick">{inr(card.total_paise)}</p><p className="text-sm text-muted">{card.count} customers</p></Card>
  )
  if (card.kind === 'followup') {
    const T = { create: 'Set payment reminder', reschedule: 'Move reminder', priority: 'Change priority', cancel: 'Cancel reminder', complete: 'Mark reminder complete' }[card.mode]
    return (
      <Card className={wrap}>
        <div className="flex items-center gap-3">
          <Avatar name={card.customer.name} />
          <div className="flex-1 min-w-0"><p className="font-display text-2xl font-extrabold truncate">{card.customer.name}</p><Chip tone="warn">{T}</Chip></div>
          {card.amount_paise ? <p className="font-display text-2xl font-extrabold">{inr(card.amount_paise)}</p> : null}
        </div>
        <p className="mt-3 flex items-center gap-2 text-lg font-semibold"><Icon n="calendar" className="w-5 h-5 text-forest" />{dmy(card.date)}{card.time ? ` · ${hmLabel(card.time)}` : ''}
          {card.priority && <Chip tone={PRIO[card.priority][0]}>{PRIO[card.priority][1]} priority</Chip>}</p>
        <p className="text-sm text-muted mt-1">Owes now {inr(Math.max(card.balance_paise, 0))}. A reminder never changes the balance.</p>
        <Decision busy={busy} actions={actions} yes="Confirm · सही है" />
      </Card>
    )
  }
  if (card.kind === 'optionchoice') return (
    <Card className={wrap}>
      <p className="text-sm font-bold text-muted mb-3">{card.field === 'date' ? 'Which date?' : 'Morning or evening?'}</p>
      <div className="grid gap-3">{card.options.map((o) => <Btn key={o.value} tone="soft" onClick={() => actions.option(o.value)} disabled={busy} className="text-lg">{o.label}</Btn>)}</div>
      <Btn tone="brick" onClick={actions.cancel} disabled={busy} className="w-full mt-3"><Icon n="x" /> Cancel</Btn>
    </Card>
  )
  if (card.kind === 'commitchoice') return (
    <Card className={wrap}>
      <p className="text-sm font-bold text-muted mb-3">Which reminder?</p>
      <div className="grid gap-3">{card.options.map((o) => <Btn key={o.id} tone="soft" onClick={() => actions.choose(o.id)} disabled={busy} className="text-lg">{o.name}</Btn>)}</div>
      <Btn tone="brick" onClick={actions.cancel} disabled={busy} className="w-full mt-3"><Icon n="x" /> Cancel</Btn>
    </Card>
  )
  if (card.kind === 'list') return (
    <Card className={wrap}>
      <h4 className="font-display text-lg font-extrabold">{card.title} <Chip>{card.items.length}</Chip></h4>
      {card.items.length ? (
        <ul className="divide-y divide-line">{card.items.slice(0, 6).map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={c.customer_name} size="w-9 h-9 text-sm" />
            <span className="min-w-0 flex-1"><span className="block font-bold truncate">{c.customer_name}</span><span className="text-xs text-muted">{dmy(c.due_date)} · {URG[c.urgency]?.[1]}</span></span>
            <Chip tone={PRIO[c.priority][0]}>{PRIO[c.priority][1]}</Chip>
            <span className="font-display font-extrabold">{inr(c.amount_paise ?? Math.max(c.balance_paise, 0))}</span>
          </li>))}</ul>
      ) : <p className="text-muted py-2">Nothing here.</p>}
    </Card>
  )
  if (card.kind === 'report') {
    const r = card.report
    return (
      <Card className={`${wrap} grid grid-cols-3 gap-2 text-center`}>
        <div><p className="text-[11px] font-bold uppercase text-muted">Credit given</p><p className="font-display text-xl font-extrabold text-brick">{inr(r.credit_paise)}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-muted">Payments</p><p className="font-display text-xl font-extrabold text-forest">{inr(r.payment_paise)}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-muted">Outstanding</p><p className="font-display text-xl font-extrabold">{inr(r.outstanding_paise)}</p></div>
      </Card>
    )
  }
  if (card.kind === 'cancelled') return <Card className={`${wrap} text-center text-muted font-semibold`}>Cancelled. Nothing was saved.</Card>
  if (card.kind === 'error') return <Card className={`${wrap} !bg-brick-soft text-brick font-semibold`}>{card.detail ? `Not saved: ${card.detail}` : 'Nothing was saved.'}</Card>
  return null
}

function LangSwitch({ lang, setLang }) {
  const main = LANGS.slice(0, 3), more = LANGS.slice(3)
  return (
    <div role="radiogroup" aria-label="Language" className="flex flex-nowrap justify-center items-center gap-1.5 sm:gap-2 max-w-full">
      {main.map((l) => (
        <button key={l.code} role="radio" aria-checked={lang === l.code} onClick={() => setLang(l.code)}
          className={`min-h-11 px-3 sm:px-4 rounded-full font-bold text-sm sm:text-base border transition ${lang === l.code ? 'bg-forest text-white border-forest' : 'bg-card border-line hover:bg-mint'}`}>
          {l.short}{l.level === 'beta' && <span className="ml-1 text-[9px] uppercase opacity-70">beta</span>}
        </button>
      ))}
      <select aria-label="More languages" value={more.some((m) => m.code === lang) ? lang : ''} onChange={(e) => e.target.value && setLang(e.target.value)}
        className="min-h-11 w-24 sm:w-28 rounded-full border border-line bg-card px-2 font-bold text-sm">
        <option value="" disabled>More…</option>
        {more.map((l) => <option key={l.code} value={l.code}>{l.label} (beta)</option>)}
      </select>
    </div>
  )
}

// A small, dismissible first-use guide: one entry, one question. Not a tutorial.
function Tips({ tips, busy, actions }) {
  return (
    <section className="w-full max-w-md bg-mint/60 border border-forest/15 rounded-3xl p-4 animate-rise" aria-label="How to use Khata Bol">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-xl font-extrabold">Pehli baar? Two things to try</h2>
        <button onClick={tips.dismiss} aria-label="Hide this guide" className="w-11 h-11 -mt-2 -mr-2 grid place-items-center text-muted hover:text-ink"><Icon n="x" /></button>
      </div>
      <ol className="mt-2 space-y-3">
        <li className="flex gap-3"><span className="w-7 h-7 shrink-0 rounded-full bg-forest text-white grid place-items-center text-sm font-bold">1</span>
          <span>Tap the green mic and say <b>“Ramesh ko 500 rupaye udhaar diye”</b>. It reads it back; say <b>“haan”</b> to save.</span></li>
        <li className="flex gap-3"><span className="w-7 h-7 shrink-0 rounded-full bg-forest text-white grid place-items-center text-sm font-bold">2</span>
          <span>Then ask <b>“Ramesh ka kitna baaki hai?”</b> Khata Bol answers from your saved entries.</span></li>
      </ol>
      <div className="flex gap-2 mt-3">
        <Btn tone="soft" disabled={busy} onClick={() => actions.say('Ramesh ko 500 rupaye udhaar diye')} className="flex-1 min-h-11 text-sm">Show me (as text)</Btn>
        <Btn tone="soft" onClick={tips.dismiss} className="min-h-11 text-sm">Got it</Btn>
      </div>
    </section>
  )
}

// Today's collections at a glance. Urgency (overdue / due today) is computed from dates; priority is the shopkeeper's own choice.
function Collections({ data, actions }) {
  const r = data.report
  if (!r) return null
  const live = (a) => a.filter((c) => !c.settled && !c.linked_reversed)
  const overdue = live(r.overdue), due = live(r.due_today), upcoming = live(r.upcoming)
  const high = [...overdue, ...due, ...upcoming].filter((c) => c.priority === 'high')
  const top = [...overdue, ...due].slice(0, 3)
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-extrabold">Collections</h3>
        <button onClick={() => actions.openTab('reminders')} className="min-h-11 px-2 text-sm font-bold text-forest">All reminders →</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <Chip tone={due.length ? 'warn' : 'plain'}>Due today {due.length}</Chip>
        <Chip tone={overdue.length ? 'bad' : 'plain'}>Overdue {overdue.length}</Chip>
        <Chip tone={high.length ? 'bad' : 'plain'}>High priority {high.length}</Chip>
      </div>
      {top.length ? (
        <ul className="divide-y divide-line">{top.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <Avatar name={c.customer_name} size="w-9 h-9 text-sm" />
            <span className="min-w-0 flex-1"><span className="block font-bold truncate">{c.customer_name}</span><span className="text-xs text-muted">{dmy(c.due_date)}{c.urgency === 'overdue' ? ` · ${c.days_overdue}d late` : ''}</span></span>
            <Chip tone={PRIO[c.priority][0]}>{PRIO[c.priority][1]}</Chip>
            <span className="font-display font-extrabold">{inr(c.amount_paise ?? Math.max(c.balance_paise, 0))}</span>
          </li>))}</ul>
      ) : <p className="text-muted">Nothing due right now.</p>}
      {upcoming[0] && <p className="text-xs text-muted mt-2">Next: {upcoming[0].customer_name}, {dmy(upcoming[0].due_date)}</p>}
    </Card>
  )
}

// Optional input for people who dictate with their own tool (for example Wispr Flow). It is a plain text box: Khata Bol
// does not connect to Wispr Flow, cannot tell which tool produced the text, and never saves anything without a confirmation.
function Dictation({ busy, actions }) {
  const [t, setT] = useState('')
  return (
    <details className="w-full max-w-md bg-card border border-line rounded-2xl px-4">
      <summary className="min-h-12 flex items-center font-bold cursor-pointer">Dictate with Wispr Flow (optional)</summary>
      <div className="pb-3">
        <p className="text-sm text-muted">If you have Wispr Flow, click the box and dictate with your own Wispr Flow shortcut. This uses <b>Wispr Flow's microphone, not Khata Bol's</b>, and Khata Bol is not connected to Wispr Flow's service: it only reads the text that appears. Nothing is saved until you confirm.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (t.trim()) { actions.dictated(t.trim()); setT('') } }} className="mt-2 grid gap-2">
          <textarea value={t} onChange={(e) => setT(e.target.value)} rows={2} aria-label="Dictation input" placeholder="Click here, then dictate: “Ramesh ko 500 rupaye udhaar diye”"
            className="w-full bg-paper border border-line rounded-xl px-3 py-2 text-base outline-none" />
          <Btn tone="soft" disabled={busy || !t.trim()}>Use this text</Btn>
        </form>
      </div>
    </details>
  )
}
