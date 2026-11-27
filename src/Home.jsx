import { Avatar, Btn, Card, Chip, Icon, Orb, inr } from './ui.jsx'
import { HistoryRow } from './Ledger.jsx'

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

export default function Home({ data, cfg, mode, dlg, heard, interim, reply, err, hint, typed, setTyped, actions }) {
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

        {hint && <p className="max-w-md text-center text-sm text-amber bg-amber-soft rounded-xl px-3 py-2">{hint}</p>}
        {err && (
          <Card role="alert" className="w-full max-w-md !bg-brick-soft !border-brick/20 flex gap-3 items-start animate-rise">
            <Icon n="alert" className="text-brick shrink-0 mt-0.5" /><p className="font-semibold text-brick">{err}</p>
          </Card>
        )}

        {heard && (
          <p className="w-full max-w-md bg-card border border-line rounded-2xl px-4 py-3 animate-rise">
            <span className="block text-xs font-bold uppercase tracking-wider text-muted">You said</span>
            <span className="text-lg">“{heard}”</span>
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

        <div className="w-full max-w-md">
          <p className="text-xs font-bold uppercase tracking-wider text-muted mb-2 text-center">Try saying · tap to run as text</p>
          <div className="flex flex-wrap justify-center gap-2">
            {TRY.map((t) => <button key={t} disabled={busy} onClick={() => actions.say(t)} className="text-sm bg-card border border-line rounded-full px-3 py-1.5 hover:bg-mint disabled:opacity-40">“{t}”</button>)}
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat big label="Total outstanding" value={inr(data.stats.outstanding_paise)} />
          <Stat label="Customers with dues" value={data.stats.owing_count} />
          <Stat label="Credit given today" value={inr(data.today.credit_paise)} tone="text-brick" />
          <Stat label="Payments today" value={inr(data.today.payment_paise)} tone="text-forest" />
        </div>
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display text-lg font-extrabold">Recent entries</h3>
            {cfg.demo && <button onClick={actions.reset} className="inline-flex items-center gap-1 text-xs font-bold text-muted hover:text-brick"><Icon n="refresh" className="w-3.5 h-3.5" /> Reset demo data</button>}
          </div>
          <ul className="divide-y divide-line">{data.recent.slice(0, 8).map((r) => <HistoryRow key={r.id} row={r} onReverse={actions.reverse} />)}</ul>
          {!data.recent.length && <p className="text-muted py-3">No entries yet. Press the mic and say one.</p>}
        </Card>
      </aside>
    </div>
  )
}

const Stat = ({ label, value, big, tone = '' }) => (
  <div className={`${big ? 'col-span-2 bg-forest text-white' : 'bg-card border border-line'} rounded-2xl p-4`}>
    <p className={`text-[11px] font-bold uppercase tracking-wide ${big ? 'text-white/70' : 'text-muted'}`}>{label}</p>
    <p className={`font-display ${big ? 'text-4xl' : 'text-2xl'} font-extrabold leading-tight mt-0.5 ${tone}`}>{value}</p>
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
          <Chip tone={credit ? 'bad' : 'good'}>{credit ? 'Credit · udhaar' : 'Repayment'}</Chip></div>
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
          <button key={c.id} onClick={() => actions.choose(c.id)} disabled={busy} className="flex items-center gap-3 bg-mint hover:brightness-95 rounded-2xl p-3 text-left font-bold text-lg active:scale-95 transition disabled:opacity-40"><Avatar name={c.name} />{c.name}</button>
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
        <div className="flex-1"><p className="font-bold">{card.duplicate ? 'Already saved' : card.reversal ? 'Reversed' : 'Saved'} · {card.customer.name}</p>
          {card.amount_paise && <p className="text-sm text-muted">{credit ? 'Credit' : 'Payment'} {inr(card.amount_paise)}</p>}</div>
        <div className="text-right"><p className="text-xs text-muted">Balance now</p><p className="font-display text-2xl font-extrabold">{inr(card.balance_paise)}</p></div>
      </div>
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
  if (card.kind === 'cancelled') return <Card className={`${wrap} text-center text-muted font-semibold`}>Cancelled. Nothing was saved.</Card>
  if (card.kind === 'error') return <Card className={`${wrap} !bg-brick-soft text-brick font-semibold`}>{card.detail ? `Not saved: ${card.detail}` : 'Nothing was saved.'}</Card>
  return null
}
