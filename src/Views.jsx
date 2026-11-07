import { useState } from 'react'
import { trust } from './lib/insights.js'
import { phrase } from './lib/i18n.js'
import { Avatar, Btn, Card, Chip, Icon, ScoreRing, inr } from './ui.jsx'

const fmt = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function exportCsv(customers, txns) {
  const name = (id) => customers.find((c) => c.id === id)?.name ?? ''
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`
  const rows = ['customer,date,type,amount', ...[...txns].sort((a, b) => a.ts - b.ts).map((t) => [q(name(t.cid)), new Date(t.ts).toISOString().slice(0, 10), t.type, t.amount].join(','))]
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })), download: 'khata.csv' })
  a.click(); URL.revokeObjectURL(a.href)
}

const waLink = (phone, msg) => {
  const d = phone.replace(/\D/g, '')
  return `https://wa.me/${d.length === 10 ? '91' + d : d}?text=${encodeURIComponent(msg)}` // bare 10-digit assumed India
}

export function CustomerList({ customers, txns, open, settings, setSettings }) {
  const [q, setQ] = useState('')
  const rows = customers
    .map((c) => ({ c, t: trust(txns, c.id) }))
    .filter(({ c }) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.t.balance - a.t.balance)
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl font-extrabold">ग्राहक <span className="text-muted font-sans text-base font-semibold">· Customers</span></h2>
        {customers.length > 0 && <Btn tone="soft" className="!py-2 !px-3 text-sm" onClick={() => exportCsv(customers, txns)}><Icon n="download" className="w-4 h-4" /> CSV</Btn>}
      </div>
      {customers.length > 3 && (
        <label className="flex items-center gap-2 bg-card border border-line rounded-2xl px-4 py-3">
          <Icon n="search" className="w-5 h-5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" className="flex-1 bg-transparent outline-none text-base" />
        </label>
      )}
      {!rows.length && <Card className="text-center text-muted py-10">{customers.length ? 'No match.' : 'No customers yet. Speak an entry, scan your khata, or load the sample shop from Home.'}</Card>}
      {rows.map(({ c, t }) => (
        <button key={c.id} onClick={() => open(c.id)} className="flex items-center gap-4 bg-card border border-line rounded-3xl p-4 text-left hover:bg-amber-soft/50 active:scale-[.99] transition animate-rise">
          <Avatar name={c.name} size="w-12 h-12 text-lg" />
          <span className="flex-1 min-w-0">
            <span className="block font-display text-xl font-extrabold truncate">{c.name}</span>
            <span className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Chip tone={t.tone}>{t.label} · {t.score}</Chip>
              {t.oldestDays > 0 && <span className="text-xs text-muted">{t.oldestDays}d unpaid</span>}
            </span>
          </span>
          <span className={`font-display text-2xl font-extrabold ${t.balance > 0 ? 'text-brick' : 'text-leaf'}`}>{t.balance > 0 ? inr(t.balance) : <Icon n="check" className="w-7 h-7" sw={3} />}</span>
        </button>
      ))}
      <Card className="mt-2">
        <h3 className="font-display text-lg font-extrabold">Your shop <span className="text-muted font-sans text-sm font-semibold">· added to reminders</span></h3>
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          <input value={settings.shop} onChange={(e) => setSettings({ shop: e.target.value })} placeholder="Shop name" className="bg-paper border border-line rounded-xl px-3 py-3" />
          <input value={settings.upi} onChange={(e) => setSettings({ upi: e.target.value.trim() })} placeholder="UPI ID (shop@upi)" className="bg-paper border border-line rounded-xl px-3 py-3" />
        </div>
      </Card>
    </div>
  )
}

export function CustomerDetail({ c, txns, lang, settings, back, setPhone }) {
  const mine = txns.filter((x) => x.cid === c.id).sort((a, b) => a.ts - b.ts)
  let run = 0
  const rows = mine.map((x) => ({ ...x, run: (run += x.type === 'credit' ? x.amount : -x.amount) })).reverse()
  const t = trust(txns, c.id)
  const b = t.balance

  async function remind() {
    let msg = await phrase(lang, 'remind', { name: c.name, amount: b })
    if (settings.upi) {
      const pay = `upi://pay?pa=${encodeURIComponent(settings.upi)}&pn=${encodeURIComponent(settings.shop || 'Shop')}&am=${b}&cu=INR`
      msg += `\n\nUPI: ${settings.upi}\n${pay}`
    }
    if (settings.shop) msg += `\n— ${settings.shop}`
    window.open(waLink(c.phone, msg), '_blank')
  }

  function statement() {
    const lines = mine.slice(-12).map((x) => `${fmt(x.ts)}  ${x.type === 'credit' ? 'udhaar +' : 'jama −'}${inr(x.amount)}`)
    const msg = `${settings.shop || 'Khata'} · ${c.name}\n${lines.join('\n')}\nBalance: ${inr(b)}${settings.upi ? `\nUPI: ${settings.upi}` : ''}`
    window.open(waLink(c.phone, msg), '_blank')
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <button onClick={back} className="self-start inline-flex items-center gap-2 font-bold text-ink-soft"><Icon n="back" /> Customers</button>
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={c.name} size="w-16 h-16 text-2xl" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-3xl font-extrabold truncate">{c.name}</h2>
            <p className={`font-display text-3xl font-extrabold ${b > 0 ? 'text-brick' : 'text-leaf'}`}>{b > 0 ? inr(b) : 'Clear'}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-4 bg-paper rounded-2xl p-3">
          <ScoreRing score={t.score} tone={t.tone} />
          <div className="text-sm space-y-0.5">
            <p><Chip tone={t.tone}>{t.label}</Chip> <span className="text-muted">khata score</span></p>
            <p>Suggested credit limit <b>{inr(t.limit)}</b></p>
            <p className="text-muted">{t.avgDays != null ? `Usually pays in ~${t.avgDays} days` : 'No repayment history yet'}{t.oldestDays > 0 && ` · oldest due ${t.oldestDays}d`}</p>
          </div>
        </div>
        <input value={c.phone} onChange={(e) => setPhone(c.id, e.target.value)} inputMode="tel" placeholder="WhatsApp number (optional)" className="mt-3 w-full bg-paper border border-line rounded-xl px-4 py-3" />
        <div className="grid sm:grid-cols-2 gap-2 mt-3">
          {b > 0 && <Btn tone="leaf" onClick={remind}><Icon n="send" /> Send reminder</Btn>}
          <Btn tone="soft" onClick={statement} className={b > 0 ? '' : 'sm:col-span-2'}><Icon n="file" /> Send statement</Btn>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="grid grid-cols-[64px_1fr_1fr_1fr] px-4 py-2 bg-amber-soft text-xs font-bold uppercase tracking-wide text-saffron-deep">
          <span>Date</span><span className="text-right">उधार</span><span className="text-right">जमा</span><span className="text-right">बाकी</span>
        </div>
        {rows.length === 0 && <p className="p-6 text-center text-muted">No entries yet.</p>}
        {rows.map((x) => (
          <div key={x.id} className="grid grid-cols-[64px_1fr_1fr_1fr] px-4 py-3 border-t border-line/70 text-[15px]">
            <span className="text-muted">{fmt(x.ts)}</span>
            <span className="text-right font-bold text-brick">{x.type === 'credit' ? inr(x.amount) : ''}</span>
            <span className="text-right font-bold text-leaf">{x.type === 'payment' ? inr(x.amount) : ''}</span>
            <span className="text-right font-semibold">{inr(x.run)}</span>
          </div>
        ))}
      </Card>
    </div>
  )
}
