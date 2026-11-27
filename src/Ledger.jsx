import { useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { Avatar, Btn, Card, Chip, Icon, inr, when } from './ui.jsx'

const KIND = { credit: ['Udhaar', 'text-brick'], payment: ['Payment', 'text-forest'], reversal: ['Reversal', 'text-muted'] }

export function HistoryRow({ row, onReverse, showName = true }) {
  const [label, color] = KIND[row.type]
  const sign = row.delta_paise > 0 ? '+' : '−'
  return (
    <li className={`flex items-center gap-3 py-3 ${row.reversed ? 'opacity-60' : ''}`}>
      {showName && <Avatar name={row.customer_name} size="w-10 h-10 text-sm" />}
      <div className="min-w-0 flex-1">
        <p className="font-bold truncate">{showName ? row.customer_name : label} {row.synthetic ? <Chip>demo</Chip> : null}</p>
        <p className="text-xs text-muted">{showName ? `${label} · ` : ''}{when(row.ts)}{row.reversed ? ' · reversed' : ''}</p>
      </div>
      <div className="text-right">
        <p className={`font-display text-lg font-extrabold ${color} ${row.reversed ? 'line-through' : ''}`}>{sign}{inr(row.amount_paise)}</p>
        <p className="text-xs text-muted">balance {inr(row.balance_after_paise)}</p>
      </div>
      {onReverse && row.type !== 'reversal' && !row.reversed && (
        <button onClick={() => onReverse(row.id)} aria-label="Reverse this entry" title="Reverse this entry"
          className="w-11 h-11 shrink-0 grid place-items-center rounded-full border border-line hover:bg-brick-soft text-muted hover:text-brick"><Icon n="undo" className="w-4 h-4" /></button>
      )}
    </li>
  )
}

export default function Ledger({ data, onReverse }) {
  const [sel, setSel] = useState(null)
  const [rows, setRows] = useState([])
  useEffect(() => { if (sel) api.history(sel.id).then(setRows).catch(() => setRows([])) }, [sel, data])
  const [q, setQ] = useState('')
  const customers = [...data.customers].filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => b.balance_paise - a.balance_paise)

  if (sel) {
    const c = data.customers.find((x) => x.id === sel.id) ?? sel
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <button onClick={() => setSel(null)} className="self-start inline-flex items-center gap-2 font-bold text-forest"><Icon n="back" /> All customers</button>
        <Card className="flex items-center gap-4">
          <Avatar name={c.name} size="w-14 h-14 text-xl" />
          <div className="flex-1"><h2 className="font-display text-3xl font-extrabold">{c.name}</h2><p className="text-muted text-sm">Complete history, nothing is ever deleted</p></div>
          <p className={`font-display text-3xl font-extrabold ${c.balance_paise > 0 ? 'text-brick' : 'text-forest'}`}>{c.balance_paise > 0 ? inr(c.balance_paise) : 'Clear'}</p>
        </Card>
        <Card><ul className="divide-y divide-line">{rows.map((r) => <HistoryRow key={r.id} row={r} showName={false} onReverse={onReverse} />)}</ul>
          {!rows.length && <p className="text-muted py-4 text-center">No entries yet.</p>}</Card>
      </div>
    )
  }
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3">
      <h2 className="font-display text-3xl font-extrabold">Customers</h2>
      <label className="flex items-center gap-2 bg-card border border-line rounded-2xl px-4 min-h-12">
        <Icon n="search" className="w-5 h-5 text-muted shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search customers" className="flex-1 min-w-0 bg-transparent py-3 outline-none" />
      </label>
      {!customers.length && <Card className="text-center text-muted py-8">{data.customers.length ? 'No customer with that name.' : 'No customers yet. Say an entry, for example “Ramesh ko 500 rupaye udhaar diye”.'}</Card>}
      {customers.map((c) => (
        <button key={c.id} onClick={() => setSel(c)} className="flex items-center gap-4 bg-card border border-line rounded-3xl p-4 text-left hover:bg-mint/50 active:scale-[.99] transition">
          <Avatar name={c.name} size="w-12 h-12 text-lg" />
          <span className="flex-1 font-display text-xl font-extrabold truncate">{c.name}</span>
          <span className={`font-display text-2xl font-extrabold ${c.balance_paise > 0 ? 'text-brick' : 'text-forest'}`}>{c.balance_paise > 0 ? inr(c.balance_paise) : <Icon n="check" className="w-7 h-7" sw={3} />}</span>
        </button>
      ))}
    </div>
  )
}
