import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { Avatar, Btn, Card, Chip, Icon, PRIO, URG, dmy, hmLabel, inr } from './ui.jsx'

const Metric = ({ label, value, tone = '', big }) => (
  <div className={`${big ? 'col-span-2 bg-forest text-white' : 'bg-card border border-line'} rounded-2xl p-4`}>
    <p className={`text-[11px] font-bold uppercase tracking-wide ${big ? 'text-white/70' : 'text-muted'}`}>{label}</p>
    <p className={`font-display ${big ? 'text-4xl' : 'text-2xl'} font-extrabold leading-tight mt-0.5 ${tone}`}>{value}</p>
  </div>
)

function Rows({ items, empty }) {
  if (!items.length) return <p className="text-muted py-2">{empty}</p>
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.id} className="flex items-center gap-3 py-3">
          <Avatar name={c.customer_name} size="w-10 h-10 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{c.customer_name}</p>
            <p className="text-xs text-muted">{dmy(c.due_date)}{c.due_time ? ` · ${hmLabel(c.due_time)}` : ''}{c.settled ? ' · balance already paid' : ''}</p>
          </div>
          <Chip tone={PRIO[c.priority][0]}>{PRIO[c.priority][1]}</Chip>
          <span className="font-display text-lg font-extrabold w-24 text-right">{inr(c.amount_paise ?? Math.max(c.balance_paise, 0))}</span>
        </li>
      ))}
    </ul>
  )
}

function csv(r) {
  const rows = r.kind === 'weekly'
    ? [['Report', `Weekly ${r.from} to ${r.to}`], ['Credit given', r.credit_paise / 100], ['Payments received', r.payment_paise / 100], ['Net change in outstanding', r.net_paise / 100], ['Outstanding now', r.outstanding_paise / 100], ['Customers with dues', r.owing_count], ['Reminders completed', r.reminders_completed],
      ...r.top_customers.map((c) => [`Owes: ${c.name}`, c.balance_paise / 100])]
    : [['Report', `Daily ${r.date}`], ['Credit given', r.credit_paise / 100], ['Payments received', r.payment_paise / 100], ['Net change in outstanding', r.net_paise / 100], ['Outstanding now', r.outstanding_paise / 100], ['Customers with dues', r.owing_count]]
  const text = rows.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `khata-${r.kind}-${r.date ?? r.to}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}

export default function Reports({ actions, version }) {
  const [view, setView] = useState('daily')
  const [r, setR] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true); setErr(null)
    try { setR(view === 'daily' ? await api.daily() : await api.weekly()) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }, [view])
  useEffect(() => { setR(null); load() }, [load, version])

  const updated = r ? new Date(r.generated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 print-area">
      <div className="flex flex-wrap items-center gap-3 no-print">
        <h2 className="font-display text-3xl font-extrabold mr-auto">Reports</h2>
        <div role="tablist" className="flex bg-card border border-line rounded-full p-1">
          {[['daily', 'Daily'], ['weekly', 'Weekly']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`min-h-11 px-5 rounded-full font-bold ${view === k ? 'bg-forest text-white' : 'text-forest hover:bg-mint'}`}>{l}</button>
          ))}
        </div>
      </div>

      {err && <Card role="alert" className="!bg-brick-soft text-brick font-semibold">Could not load the report: {err}</Card>}
      {!r && !err && <Card className="animate-pulse"><div className="h-32 rounded-2xl bg-line/50" /><p className="text-muted mt-3">Calculating from your entries…</p></Card>}

      {r && (
        <>
          <p className="text-muted font-semibold">
            {r.kind === 'weekly' ? `Last 7 days · ${dmy(r.from)} to ${dmy(r.to)}` : `${r.is_today ? 'Today' : 'Day'} · ${dmy(r.date)}`}
            <span className="no-print"> · updated {updated}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Metric big label="Outstanding customer credit" value={inr(r.outstanding_paise)} />
            <Metric label="Credit given" value={inr(r.credit_paise)} tone="text-brick" />
            <Metric label="Payments received" value={inr(r.payment_paise)} tone="text-forest" />
            <Metric label="Net change in outstanding" value={`${r.net_paise > 0 ? '+' : ''}${inr(r.net_paise)}`} tone={r.net_paise > 0 ? 'text-brick' : 'text-forest'} />
            <Metric label="Customers with dues" value={r.owing_count} />
          </div>
          <p className="text-xs text-muted -mt-2">Only credit given and repayments recorded here. Khata Bol does not track sales or profit.</p>

          {r.kind === 'daily' ? (
            <>
              <Card><h3 className="font-display text-lg font-extrabold">Overdue <Chip tone={r.overdue.length ? 'bad' : 'plain'}>{r.overdue.length}</Chip></h3><Rows items={r.overdue} empty="Nothing overdue." /></Card>
              <Card><h3 className="font-display text-lg font-extrabold">Due today <Chip tone={r.due_today.length ? 'warn' : 'plain'}>{r.due_today.length}</Chip></h3><Rows items={r.due_today} empty="No payments due today." /></Card>
              <Card><h3 className="font-display text-lg font-extrabold">Coming up (7 days)</h3><Rows items={r.upcoming} empty="Nothing planned." /></Card>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Reminders completed" value={`${r.reminders_completed}${r.reminders_completed ? ` (${r.completed_on_time} on time)` : ''}`} />
                <Metric label="Overdue (customers owe)" value={inr(r.overdue_paise)} tone={r.overdue_paise ? 'text-brick' : ''} />
              </div>
              <Card>
                <h3 className="font-display text-lg font-extrabold">Collection performance</h3>
                {r.collection.expected_paise ? (
                  <>
                    <p className="mt-1">You expected <b>{inr(r.collection.expected_paise)}</b> from reminders with an amount; <b>{inr(r.collection.collected_paise)}</b> was repaid.</p>
                    <div className="h-3 rounded-full bg-line mt-3 overflow-hidden" role="img" aria-label={`${r.collection.rate_percent} percent collected`}><div className="h-full bg-forest" style={{ width: `${r.collection.rate_percent}%` }} /></div>
                    <p className="text-sm text-muted mt-1">{r.collection.rate_percent}% collected</p>
                  </>
                ) : <p className="text-muted mt-1">No reminders with an expected amount fell in this week, so there is nothing to compare yet. Say, for example, “Ramesh se 500 rupaye Friday ko lene hain”.</p>}
              </Card>
              <Card>
                <h3 className="font-display text-lg font-extrabold">Who owes the most</h3>
                {r.top_customers.length ? <ul className="divide-y divide-line">{r.top_customers.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-3"><Avatar name={c.name} size="w-10 h-10 text-sm" /><span className="flex-1 font-bold truncate">{c.name}</span><span className="font-display text-xl font-extrabold text-brick">{inr(c.balance_paise)}</span></li>
                ))}</ul> : <p className="text-muted py-2">Nobody owes anything.</p>}
              </Card>
              <Card><h3 className="font-display text-lg font-extrabold">Overdue payments <Chip tone={r.overdue.length ? 'bad' : 'plain'}>{r.overdue.length}</Chip></h3><Rows items={r.overdue} empty="Nothing overdue." /></Card>
            </>
          )}

          <div className="flex flex-wrap gap-2 no-print">
            <Btn tone="soft" onClick={load} disabled={busy}><Icon n="refresh" className={`w-5 h-5 ${busy ? "animate-spin" : ""}`} /> Refresh</Btn>
            <Btn onClick={() => actions.hear(view === 'daily' ? 'Aaj ka hisaab batao' : 'Is hafte ka hisaab batao')}><Icon n="volume" /> Hear summary</Btn>
            <Btn tone="soft" onClick={() => csv(r)}><Icon n="download" /> Download CSV</Btn>
            <Btn tone="soft" onClick={() => window.print()}><Icon n="printer" /> Print</Btn>
          </div>
        </>
      )}
    </div>
  )
}
