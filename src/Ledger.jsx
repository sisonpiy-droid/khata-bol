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

const SORTS = { owed: 'Most owed', recent: 'Recent', name: 'A to Z' }
const FILTERS = [['all', 'All'], ['owing', 'Owing'], ['clear', 'Clear']]

const ago = (iso) => {
  if (!iso) return 'No entries yet'
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5)
  return d <= 0 ? 'Active today' : d === 1 ? 'Last entry yesterday' : `Last entry ${d} days ago`
}

function Pill({ on, children, ...p }) {
  return <button {...p} aria-pressed={on} className={`min-h-11 px-4 rounded-full font-bold text-sm border ${on ? 'bg-forest text-white border-forest' : 'bg-card text-forest border-line hover:bg-mint'}`}>{children}</button>
}

function Summary({ label, value, tone = '' }) {
  return (
    <div className="bg-card border border-line rounded-2xl p-3 text-center">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className={`font-display text-xl font-extrabold ${tone}`}>{value}</p>
    </div>
  )
}

export default function Ledger({ data, onReverse, actions, shop }) {
  const [sel, setSel] = useState(null)
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('owed')
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (sel) api.history(sel.id).then(setRows).catch(() => setRows([])) }, [sel, data])

  const all = data.customers
  const owing = all.filter((c) => c.balance_paise > 0)
  const list = all
    .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => filter === 'all' || (filter === 'owing' ? c.balance_paise > 0 : c.balance_paise <= 0))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'recent' ? (b.last_ts ?? '').localeCompare(a.last_ts ?? '') : b.balance_paise - a.balance_paise)

  if (sel) {
    const c = all.find((x) => x.id === sel.id) ?? sel
    const live = rows.filter((r) => !r.reversed && r.type !== 'reversal')
    const credit = live.filter((r) => r.type === 'credit').reduce((s, r) => s + r.amount_paise, 0)
    const paid = live.filter((r) => r.type === 'payment').reduce((s, r) => s + r.amount_paise, 0)
    const msg = `Namaste ${c.name} ji, ${shop || 'hamari dukaan'} ka ${inr(c.balance_paise)} baaki hai. Kripya jald de dein. Dhanyavaad 🙏`
    const share = async () => {
      try { if (navigator.share) await navigator.share({ text: msg }); else { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 2000) } } catch { /* user cancelled the share sheet */ }
    }
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <button onClick={() => setSel(null)} className="self-start inline-flex items-center gap-2 min-h-11 font-bold text-forest"><Icon n="back" /> All customers</button>
        <Card className="flex items-center gap-4">
          <Avatar name={c.name} size="w-14 h-14 text-xl" />
          <div className="flex-1 min-w-0"><h2 className="font-display text-3xl font-extrabold truncate">{c.name}</h2><p className="text-muted text-sm">{ago(c.last_ts)}</p></div>
          <p className={`font-display text-3xl font-extrabold ${c.balance_paise > 0 ? 'text-brick' : 'text-forest'}`}>{c.balance_paise > 0 ? inr(c.balance_paise) : 'Clear'}</p>
        </Card>
        <div className="grid grid-cols-3 gap-2">
          <Summary label="Credit given" value={inr(credit)} tone="text-brick" />
          <Summary label="Paid back" value={inr(paid)} tone="text-forest" />
          <Summary label="Entries" value={live.length} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => actions.hear(`${c.name} ka kitna baaki hai?`)}><Icon n="volume" /> Hear balance</Btn>
          <Btn tone="soft" onClick={() => actions.hear(`${c.name} ka reminder kal laga do`)}><Icon n="bell" /> Remind me tomorrow</Btn>
          {c.balance_paise > 0 && <Btn tone="soft" onClick={share}><Icon n="copy" /> {copied ? 'Copied' : navigator.share ? 'Share message' : 'Copy message'}</Btn>}
        </div>
        <Card>
          <h3 className="font-display text-lg font-extrabold">History</h3>
          <p className="text-muted text-sm">Nothing is ever deleted. Mistakes are reversed, not erased.</p>
          <ul className="divide-y divide-line">{rows.map((r) => <HistoryRow key={r.id} row={r} showName={false} onReverse={onReverse} />)}</ul>
          {!rows.length && <p className="text-muted py-4 text-center">No entries yet.</p>}
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3">
      <h2 className="font-display text-3xl font-extrabold">Customers</h2>
      {all.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Summary label="Customers" value={all.length} />
          <Summary label="Owing" value={owing.length} tone={owing.length ? 'text-brick' : ''} />
          <Summary label="Total due" value={inr(owing.reduce((s, c) => s + c.balance_paise, 0))} tone="text-brick" />
        </div>
      )}
      <label className="flex items-center gap-2 bg-card border border-line rounded-2xl px-4 min-h-12">
        <Icon n="search" className="w-5 h-5 text-muted shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search customers" className="flex-1 min-w-0 bg-transparent py-3 outline-none" />
        {q && <button onClick={() => setQ('')} aria-label="Clear search" className="min-w-11 min-h-11 grid place-items-center text-muted"><Icon n="x" className="w-4 h-4" /></button>}
      </label>
      {all.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([k, l]) => <Pill key={k} on={filter === k} onClick={() => setFilter(k)}>{l}</Pill>)}
          <label className="ml-auto flex items-center gap-2 text-sm font-bold text-muted">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 rounded-full border border-line bg-card px-3 text-ink">
              {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      )}
      {!list.length && (
        <Card className="text-center py-8 flex flex-col items-center gap-3">
          <span className="w-14 h-14 rounded-full bg-mint text-forest grid place-items-center"><Icon n="users" className="w-7 h-7" /></span>
          <p className="font-display text-xl font-extrabold">{all.length ? 'No customer matches' : 'No customers yet'}</p>
          <p className="text-muted max-w-xs">{all.length ? 'Try another name or filter.' : 'Customers are added when you record their first entry. Tap the mic and say “Ramesh ko 500 rupaye udhaar diye”.'}</p>
          {!all.length && <Btn onClick={() => actions.openTab('home')}><Icon n="mic" /> Add by voice</Btn>}
        </Card>
      )}
      {list.map((c) => (
        <button key={c.id} onClick={() => setSel(c)} className="flex items-center gap-4 bg-card border border-line rounded-3xl p-4 text-left hover:bg-mint/50 active:scale-[.99] transition">
          <Avatar name={c.name} size="w-12 h-12 text-lg" />
          <span className="flex-1 min-w-0">
            <span className="block font-display text-xl font-extrabold truncate">{c.name}</span>
            <span className="block text-xs text-muted">{ago(c.last_ts)}</span>
          </span>
          <span className={`font-display text-2xl font-extrabold ${c.balance_paise > 0 ? 'text-brick' : 'text-forest'}`}>{c.balance_paise > 0 ? inr(c.balance_paise) : <Icon n="check" className="w-7 h-7" sw={3} />}</span>
        </button>
      ))}
    </div>
  )
}
