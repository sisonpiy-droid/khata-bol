import { Avatar, Btn, Card, Chip, Icon, Orb, ago, inr } from './ui.jsx'
import { chaseList, portfolio } from './lib/insights.js'

const CAPTION = {
  idle: ['माइक दबाएँ और बोलें', 'Tap the mic and speak'],
  thinking: ['समझ रहा हूँ…', 'Understanding'],
  pick: ['कौन सा?', 'Which customer?'],
  confirm: ['क्या यह सही है?', 'Is this right?'],
  manual: ['हाथ से लिखें', 'Enter it manually'],
}

export default function Home(p) {
  const { stage, interim, dbg, pending, options, message, hands, demo, data, how } = p
  const { customers } = data
  const cap = stage === 'listening' ? [interim || 'सुन रहा हूँ…', 'Listening'] : hands && stage === 'idle' ? ['Hands-free चालू', 'Just speak, I keep listening'] : CAPTION[stage] || CAPTION.idle
  const showHeard = dbg.transcript && ['thinking', 'pick', 'confirm'].includes(stage)

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
      <div className="flex flex-col items-center gap-4">
        {demo && (
          <div className="flex items-center gap-3 bg-ink text-paper rounded-full pl-4 pr-2 py-1.5 text-sm font-bold animate-rise">
            <span className="w-2 h-2 rounded-full bg-saffron animate-pulse" /> Auto-demo running
            <button onClick={p.onCancel} className="bg-paper/15 hover:bg-paper/25 rounded-full px-3 py-1">Stop</button>
          </div>
        )}
        <Orb stage={stage} hands={hands} onClick={p.onMic} />
        <div className="text-center min-h-14 max-w-md">
          <p className="font-display text-2xl sm:text-3xl font-extrabold leading-tight">{cap[0]}</p>
          {cap[1] && stage !== 'listening' && <p className="text-muted mt-1">{cap[1]}</p>}
        </div>

        {showHeard && (
          <p className="w-full max-w-md text-center bg-card border border-line rounded-2xl px-4 py-3 text-lg text-ink-soft italic animate-rise">
            “{dbg.transcript}”
          </p>
        )}

        {stage === 'pick' && (
          <Card className="w-full max-w-md animate-rise">
            <p className="text-sm font-bold text-muted mb-3">कौन सा ग्राहक? Which one?</p>
            <div className="grid grid-cols-2 gap-3">
              {options.map((c) => (
                <button key={c.id} onClick={() => p.onTap(c)} className="flex items-center gap-3 bg-amber-soft hover:brightness-95 rounded-2xl p-3 text-left font-bold text-lg active:scale-95 transition">
                  <Avatar name={c.name} /> {c.name}
                </button>
              ))}
            </div>
            <Btn tone="brick" onClick={p.onCancel} className="w-full mt-3"><Icon n="x" /> Cancel</Btn>
          </Card>
        )}

        {stage === 'confirm' && pending && (
          <Card className="w-full max-w-md animate-rise !p-0 overflow-hidden">
            <div className="flex justify-between items-center px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-muted">
              <span>खाता पर्ची · Slip</span><span>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="max-h-72 overflow-auto px-5 divide-y divide-dashed divide-line">
              {pending.map((e, i) => (
                <div key={i} className="py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={e.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-xl font-extrabold truncate">{e.name} {e.isNew && <Chip tone="good">NEW</Chip>}</p>
                      <p className="text-sm text-muted">{e.type === 'credit' ? 'उधार · udhaar' : 'वापस · paid back'}</p>
                    </div>
                    <p className={`font-display text-3xl font-extrabold ${e.type === 'credit' ? 'text-brick' : 'text-leaf'}`}>{e.type === 'credit' ? '+' : '−'}{inr(e.amount)}</p>
                  </div>
                  {e.warn && (
                    <p className="mt-2 flex items-start gap-2 bg-amber-soft text-saffron-deep rounded-xl px-3 py-2 text-sm font-semibold">
                      <Icon n="alert" className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Already owes {inr(e.warn.balance)}. Suggested limit {inr(e.warn.limit)}{e.warn.oldestDays >= 7 && `, oldest unpaid ${e.warn.oldestDays} days`}.</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-3 p-4 bg-paper/60 mt-2">
              <Btn tone="leaf" onClick={() => p.onTap('yes')} className="text-xl py-4"><Icon n="check" className="w-6 h-6" sw={3} /> सही है · Confirm</Btn>
              <Btn tone="brick" onClick={() => p.onTap('no')} className="py-4" aria-label="Not right"><Icon n="x" className="w-6 h-6" sw={3} /></Btn>
            </div>
          </Card>
        )}

        {stage === 'manual' && p.manual}

        <div aria-live="polite" className="w-full max-w-md">
          {message?.text && (
            <div key={message.text} className={`animate-stamp flex items-start gap-3 rounded-2xl p-4 border ${message.kind === 'ok' ? 'bg-leaf-soft border-leaf/20' : 'bg-brick-soft border-brick/20'}`}>
              <span className={`mt-0.5 grid place-items-center w-7 h-7 rounded-full text-white shrink-0 ${message.kind === 'ok' ? 'bg-leaf' : 'bg-brick'}`}>
                <Icon n={message.kind === 'ok' ? 'check' : 'alert'} className="w-4 h-4" sw={3} />
              </span>
              <p className="flex-1 text-lg font-semibold leading-snug">{message.text}</p>
              {message.undo > 0 && (
                <button onClick={p.onUndo} className="shrink-0 inline-flex items-center gap-1 text-sm font-bold bg-card border border-line rounded-full px-3 py-1.5 hover:bg-amber-soft"><Icon n="undo" className="w-4 h-4" /> Undo</button>
              )}
            </div>
          )}
        </div>

        {stage === 'idle' && (
          <form onSubmit={(e) => { e.preventDefault(); p.onType() }} className="w-full max-w-md flex gap-2">
            <input value={p.typed} onChange={(e) => p.setTyped(e.target.value)} placeholder='Or type: "Ramesh ne 200 ka udhaar liya"'
              className="flex-1 min-w-0 bg-card border border-line rounded-2xl px-4 py-3 text-base placeholder:text-muted/70" />
            <Btn tone="soft" aria-label="Send" className="!px-4"><Icon n="send" /></Btn>
          </form>
        )}

        <div className="flex flex-wrap justify-center gap-2 max-w-md">
          <Pill icon="headphones" on={hands} onClick={p.toggleHands}>Hands-free</Pill>
          <Pill icon="camera" disabled={stage !== 'idle'} onClick={p.scan}>Scan khata</Pill>
          <Pill icon="file" onClick={p.summary}>Summary</Pill>
          <Pill icon="pen" onClick={p.openManual}>Manual</Pill>
          <Pill icon="play" onClick={p.runDemo} accent>Auto-demo</Pill>
        </div>

        {how && (
          <Card className="w-full max-w-md animate-rise">
            <div className="flex items-center justify-between gap-1 text-sm font-bold flex-wrap">
              {[['Heard', !!dbg.transcript], ['Understood', !!dbg.parsed], ['Matched', !!pending || message?.kind === 'ok'], ['Saved', message?.kind === 'ok' && !pending]].map(([l, ok], i) => (
                <span key={l} className="flex items-center gap-1">
                  {i > 0 && <span className="w-4 h-px bg-line" />}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? 'bg-leaf text-white' : 'bg-paper text-muted'}`}>{ok && <Icon n="check" className="w-3.5 h-3.5" sw={3} />}{l}</span>
                </span>
              ))}
            </div>
            <pre className="mt-3 bg-ink text-leaf-soft rounded-xl p-3 text-xs overflow-auto whitespace-pre-wrap max-h-52">{JSON.stringify({ lang: p.lang, engine: p.engine, ...dbg }, null, 2)}</pre>
          </Card>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        {!customers.length ? <Welcome {...p} /> : <Dashboard data={data} open={p.openCustomer} />}
      </aside>
    </div>
  )
}

const Pill = ({ icon, on, accent, children, ...p }) => (
  <button {...p} className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold border transition active:scale-95 disabled:opacity-40 ${
    on ? 'bg-leaf text-white border-leaf' : accent ? 'bg-ink text-paper border-ink' : 'bg-card border-line hover:bg-amber-soft'}`}>
    <Icon n={icon} className="w-4 h-4" /> {children}
  </button>
)

function Welcome(p) {
  return (
    <Card>
      <h2 className="font-display text-2xl font-extrabold">Namaste! 🙏</h2>
      <p className="text-muted mt-1">Speak your khata. No typing, in your language.</p>
      <ol className="mt-4 space-y-3">
        {[['mic', 'Tap the mic and say "Ramesh ne do sau ka udhaar liya"'], ['check', 'I read it back. Say "haan" or tap Confirm'], ['send', 'Send a polite WhatsApp reminder in one tap']].map(([ic, t], i) => (
          <li key={i} className="flex items-center gap-3"><span className="grid place-items-center w-9 h-9 rounded-full bg-amber-soft text-saffron-deep shrink-0"><Icon n={ic} className="w-4 h-4" /></span><span className="font-medium">{t}</span></li>
        ))}
      </ol>
      <div className="grid gap-2 mt-5">
        <Btn tone="ink" onClick={p.runDemo}><Icon n="play" /> Watch the auto-demo</Btn>
        <Btn tone="soft" onClick={p.seed}><Icon n="sprout" /> Load a sample shop</Btn>
        <Btn tone="soft" onClick={p.scan}><Icon n="camera" /> Scan my paper khata</Btn>
      </div>
    </Card>
  )
}

function Dashboard({ data, open }) {
  const { customers, txns } = data
  const pf = portfolio(customers, txns)
  const chase = chaseList(customers, txns)
  const nameOf = (id) => customers.find((c) => c.id === id)?.name ?? '?'
  const recent = [...txns].sort((a, b) => b.ts - a.ts).slice(0, 5)
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Outstanding" value={inr(pf.owed)} big />
        <Stat label="Overdue 14d+" value={inr(pf.overdue)} tone={pf.overdue ? 'text-brick' : ''} />
        <Stat label="Owe you" value={`${pf.owing}`} />
      </div>
      {chase.length > 0 && (
        <Card>
          <h3 className="font-display text-lg font-extrabold mb-1">पहले किससे मांगें <span className="text-muted font-sans text-sm font-semibold">· Chase first</span></h3>
          {chase.map(({ c, balance, oldestDays }) => (
            <button key={c.id} onClick={() => open(c.id)} className="w-full flex items-center gap-3 py-2.5 text-left rounded-xl hover:bg-paper px-1">
              <Avatar name={c.name} size="w-10 h-10" />
              <span className="flex-1 min-w-0"><span className="block font-bold truncate">{c.name}</span><span className="text-xs text-muted">{oldestDays ? `${oldestDays} days unpaid` : 'new'}</span></span>
              <span className="font-display text-xl font-extrabold text-brick">{inr(balance)}</span>
            </button>
          ))}
        </Card>
      )}
      <Card>
        <h3 className="font-display text-lg font-extrabold mb-1">आज का हिसाब <span className="text-muted font-sans text-sm font-semibold">· Recent</span></h3>
        {recent.length === 0 && <p className="text-muted py-2">Nothing yet.</p>}
        {recent.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2">
            <Avatar name={nameOf(t.cid)} size="w-8 h-8 text-sm" />
            <span className="flex-1 min-w-0 truncate font-semibold">{nameOf(t.cid)}</span>
            <span className="text-xs text-muted">{ago(t.ts)}</span>
            <span className={`font-bold ${t.type === 'credit' ? 'text-brick' : 'text-leaf'}`}>{t.type === 'credit' ? '+' : '−'}{inr(t.amount)}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

const Stat = ({ label, value, big, tone = '' }) => (
  <div className={`${big ? 'bg-ink text-paper' : 'bg-card border border-line'} rounded-2xl p-3`}>
    <p className={`text-[11px] font-bold uppercase tracking-wide ${big ? 'text-paper/70' : 'text-muted'}`}>{label}</p>
    <p className={`font-display text-xl sm:text-2xl font-extrabold leading-tight mt-0.5 ${tone}`}>{value}</p>
  </div>
)
