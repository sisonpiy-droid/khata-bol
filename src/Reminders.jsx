import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { Avatar, Btn, Card, Chip, Icon, PRIO, URG, dmy, hmLabel, inr } from './ui.jsx'

const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

// A polite message the shopkeeper can copy or share by hand. Khata Bol never sends anything to a customer itself.
function message(c, lang, shop) {
  const owed = inr(Math.max(c.balance_paise, 0)), when = dmy(c.due_date)
  const text = lang.startsWith('en')
    ? `Hello ${c.customer_name}, a gentle reminder that ${owed} is pending. Please pay by ${when}. Thank you!`
    : `Namaste ${c.customer_name} ji, aapke ${owed} baaki hain. Kripya ${when} tak chuka dein. Dhanyavaad.`
  return shop ? `${text} — ${shop}` : text
}

function Item({ c, lang, shop, busy, onChange, onError }) {
  const [edit, setEdit] = useState(false)
  const [date, setDate] = useState(c.due_date)
  const [time, setTime] = useState(c.due_time ?? '')
  const [sure, setSure] = useState(false)
  const [copied, setCopied] = useState(false)
  const run = async (fn) => { try { await fn(); onChange() } catch (e) { onError(e.message) } }
  const [utone, ulabel] = URG[c.urgency] ?? ['plain', c.status]
  const open = c.status === 'open'
  const text = message(c, lang, shop)
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text })
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    } catch { /* cancelled */ }
  }
  return (
    <li className={`bg-card border rounded-3xl p-4 ${c.urgency === 'overdue' ? 'border-brick/40' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <Avatar name={c.customer_name} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-extrabold truncate">{c.customer_name}</p>
          <p className="text-sm text-muted">{dmy(c.due_date)}{c.due_time ? ` · ${hmLabel(c.due_time)}` : ''}{c.days_overdue ? ` · ${c.days_overdue} day${c.days_overdue > 1 ? 's' : ''} late` : ''}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-extrabold">{inr(c.amount_paise ?? Math.max(c.balance_paise, 0))}</p>
          <p className="text-[11px] text-muted">{c.amount_paise ? 'expected' : 'owes now'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <Chip tone={utone}>{ulabel}</Chip>
        <Chip tone={PRIO[c.priority][0]}>{PRIO[c.priority][1]} priority (your choice)</Chip>
        {c.late && <Chip tone="warn">Paid after due date</Chip>}
      </div>
      {open && c.settled && <p className="mt-2 bg-mint rounded-xl px-3 py-2 text-sm font-semibold text-forest">{c.customer_name} has paid everything. Mark this complete?</p>}
      {open && c.linked_reversed && <p className="mt-2 bg-amber-soft rounded-xl px-3 py-2 text-sm font-semibold text-amber">The credit this followed was reversed. Check whether you still need it.</p>}
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={() => run(() => api.completeFollowup(c.id))} disabled={busy} className="text-sm"><Icon n="check" className="w-4 h-4" sw={3} /> Complete</Btn>
          <Btn tone="soft" onClick={() => setEdit(!edit)} className="text-sm"><Icon n="calendar" className="w-4 h-4" /> Reschedule</Btn>
          <Btn tone="soft" onClick={share} className="text-sm"><Icon n="copy" className="w-4 h-4" /> {copied ? 'Copied' : navigator.share ? 'Share message' : 'Copy message'}</Btn>
          <Btn tone="brick" onClick={() => (sure ? run(() => api.cancelFollowup(c.id)) : (setSure(true), setTimeout(() => setSure(false), 3000)))} className="text-sm">{sure ? 'Tap again to cancel' : 'Cancel'}</Btn>
        </div>
      )}
      {open && (
        <div className="mt-3 flex items-center gap-2 flex-wrap" role="group" aria-label="Priority">
          <span className="text-xs font-bold uppercase text-muted">Priority</span>
          {['high', 'medium', 'low'].map((p) => (
            <button key={p} aria-pressed={c.priority === p} onClick={() => c.priority !== p && run(() => api.updateFollowup(c.id, { priority: p }))}
              className={`min-h-11 px-4 rounded-full text-sm font-bold border ${c.priority === p ? 'bg-forest text-white border-forest' : 'bg-card border-line hover:bg-mint'}`}>{PRIO[p][1]}</button>
          ))}
        </div>
      )}
      {edit && (
        <form className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => api.updateFollowup(c.id, { dueDate: date, dueTime: time || null })).then(() => setEdit(false)) }}>
          <label className="text-xs font-bold text-muted">New date<input type="date" min={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink" required /></label>
          <label className="text-xs font-bold text-muted">Time (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink" /></label>
          <Btn>Save</Btn>
        </form>
      )}
    </li>
  )
}

function Group({ title, tone, items, empty, ...rest }) {
  return (
    <section aria-label={title}>
      <h3 className="font-display text-xl font-extrabold mb-2">{title} <Chip tone={items.length ? tone : 'plain'}>{items.length}</Chip></h3>
      {items.length ? <ul className="flex flex-col gap-3">{items.map((c) => <Item key={c.id} c={c} {...rest} />)}</ul> : <p className="text-muted mb-2">{empty}</p>}
    </section>
  )
}

export default function Reminders({ customers, lang, shop, version, onChanged, notify }) {
  const [open, setOpen] = useState([])
  const [done, setDone] = useState([])
  const [sort, setSort] = useState('due')
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ customerId: '', dueDate: todayIst(), dueTime: '', priority: 'medium', amount: '' })

  const load = useCallback(async () => {
    try { const [o, d] = await Promise.all([api.followups('open', sort), api.followups('completed', 'due')]); setOpen(o); setDone(d); setErr(null) }
    catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [sort])
  useEffect(() => { load() }, [load, version])
  const changed = () => { load(); onChanged() }

  async function add(e) {
    e.preventDefault(); setErr(null)
    try {
      const amountPaise = form.amount ? Math.round(parseFloat(form.amount) * 100) : null
      const r = await api.addFollowup({ customerId: Number(form.customerId), dueDate: form.dueDate, dueTime: form.dueTime || null, priority: form.priority, amountPaise })
      if (r.duplicate) setErr('This customer already has a reminder for that day. Nothing new was added.')
      else { setAdding(false); setForm({ ...form, amount: '' }) }
      changed()
    } catch (e2) { setErr(e2.message) }
  }

  const common = { lang, shop, onChange: changed, onError: setErr }
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-3xl font-extrabold mr-auto">Reminders</h2>
        <label className="text-sm font-bold text-muted flex items-center gap-2">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 bg-card border border-line rounded-full px-3 text-ink">
            <option value="due">Due date</option><option value="amount">Amount</option><option value="priority">Priority</option>
          </select>
        </label>
        <Btn onClick={() => setAdding(!adding)}><Icon n={adding ? 'x' : 'calendar'} /> {adding ? 'Close' : 'Add'}</Btn>
      </div>
      <p className="text-sm text-muted -mt-3">Say it instead: “Ramesh ko Friday tak payment karni hai”. Reminders never change a balance.</p>

      {notify.supported && notify.permission !== 'granted' && (
        <Card className="flex items-start gap-3">
          <Icon n="bell" className="w-5 h-5 text-forest mt-0.5 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-bold">{notify.permission === 'denied' ? 'Browser notifications are blocked' : 'Get a pop-up when a payment is due'}</p>
            <p className="text-muted">{notify.permission === 'denied' ? 'Everything due is still listed on this page. Allow notifications in your browser settings if you want pop-ups.' : 'Works only while Khata Bol is open in this browser. It cannot remind you when the site is closed. Due items are always listed here either way.'}</p>
            {notify.permission !== 'denied' && <Btn tone="soft" onClick={notify.ask} className="mt-2 !py-2 text-sm">Allow notifications</Btn>}
          </div>
        </Card>
      )}

      {err && <Card role="alert" className="!bg-brick-soft text-brick font-semibold flex justify-between gap-2"><span>{err}</span><button onClick={() => setErr(null)} aria-label="Dismiss" className="min-w-11 min-h-11 grid place-items-center"><Icon n="x" /></button></Card>}

      {adding && (
        <Card>
          <form onSubmit={add} className="grid gap-3">
            <label className="text-xs font-bold text-muted">Customer
              <select required value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className="mt-1 w-full min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink">
                <option value="" disabled>Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-muted">Date<input type="date" required min={todayIst()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="mt-1 w-full min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink" /></label>
              <label className="text-xs font-bold text-muted">Time (optional)<input type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} className="mt-1 w-full min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink" /></label>
              <label className="text-xs font-bold text-muted">Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="mt-1 w-full min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <label className="text-xs font-bold text-muted">Expected ₹ (optional)<input type="number" inputMode="decimal" min="1" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1 w-full min-h-12 bg-paper border border-line rounded-xl px-3 text-base text-ink" /></label>
            </div>
            <Btn><Icon n="check" sw={3} /> Save reminder</Btn>
          </form>
        </Card>
      )}

      {loading ? <Card className="animate-pulse"><div className="h-24 rounded-2xl bg-line/50" /></Card> : (
        <>
          <Group title="Overdue" tone="bad" items={open.filter((c) => c.urgency === 'overdue')} empty="Nothing overdue." {...common} />
          <Group title="Due today" tone="warn" items={open.filter((c) => c.urgency === 'due_today')} empty="No payments due today." {...common} />
          <Group title="Upcoming" tone="plain" items={open.filter((c) => c.urgency === 'upcoming')} empty="Nothing coming up." {...common} />
          <Group title="Completed" tone="good" items={done.slice(0, 10)} empty="Nothing completed yet." {...common} />
        </>
      )}
    </div>
  )
}
