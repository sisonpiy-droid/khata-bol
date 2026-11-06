import { balanceOf } from './lib/store.js'
import { stats } from './lib/insights.js'
import { phrase } from './lib/i18n.js'

const fmt = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export function CustomerList({ customers, txns, open, settings, setSettings }) {
  const rows = customers.map((c) => ({ c, b: balanceOf(txns, c.id) })).sort((a, b) => b.b - a.b)
  return (
    <div className="flex flex-col gap-3">
      {!rows.length && <p className="text-xl text-stone-400 text-center mt-6">कोई ग्राहक नहीं. No customers yet.<br />Tap "Sample data" or "Scan khata" on the home screen.</p>}
      {rows.map(({ c, b }) => (
        <button key={c.id} onClick={() => open(c.id)} className="flex justify-between items-center bg-stone-900 border border-stone-700 rounded-2xl p-5 text-left">
          <span className="text-2xl font-bold">{c.name}</span>
          <span className={`text-3xl font-black ${b > 0 ? 'text-red-400' : 'text-green-400'}`}>{b > 0 ? `₹${b}` : '✓'}</span>
        </button>
      ))}
      <div className="bg-stone-900 rounded-2xl p-4 flex flex-col gap-2 mt-2">
        <p className="text-stone-400 text-sm">Reminders carry your UPI details</p>
        <input value={settings.shop} onChange={(e) => setSettings({ shop: e.target.value })} placeholder="Shop name" className="bg-stone-800 rounded-xl p-3 text-lg" />
        <input value={settings.upi} onChange={(e) => setSettings({ upi: e.target.value.trim() })} placeholder="UPI ID (e.g. shop@upi)" className="bg-stone-800 rounded-xl p-3 text-lg" />
      </div>
    </div>
  )
}

export function CustomerDetail({ c, txns, lang, settings, back, setPhone }) {
  const mine = txns.filter((x) => x.cid === c.id).sort((a, b) => a.ts - b.ts)
  let run = 0
  const rows = mine.map((x) => ({ ...x, run: (run += x.type === 'credit' ? x.amount : -x.amount) })).reverse()
  const b = run
  const s = stats(txns, c.id)

  async function remind() {
    const digits = c.phone.replace(/\D/g, '')
    const to = digits.length === 10 ? '91' + digits : digits // bare 10-digit assumed India
    let msg = await phrase(lang, 'remind', { name: c.name, amount: b })
    if (settings.upi) {
      const pay = `upi://pay?pa=${encodeURIComponent(settings.upi)}&pn=${encodeURIComponent(settings.shop || 'Shop')}&am=${b}&cu=INR`
      msg += `\n\nUPI: ${settings.upi}\n${pay}`
    }
    if (settings.shop) msg += `\n— ${settings.shop}`
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={back} className="text-left text-lg text-amber-400">← Back</button>
      <div className="flex justify-between items-baseline">
        <h2 className="text-3xl font-black">{c.name}</h2>
        <span className={`text-4xl font-black ${b > 0 ? 'text-red-400' : 'text-green-400'}`}>{b > 0 ? `₹${b}` : '✓ clear'}</span>
      </div>
      {(s.avgDays != null || s.oldestDays > 0) && (
        <p className="text-stone-300">
          {s.avgDays != null && <>Usually pays in ~{s.avgDays} days. </>}
          {s.oldestDays > 0 && <span className={s.oldestDays >= 14 ? 'text-amber-300' : ''}>Oldest unpaid: {s.oldestDays} days.</span>}
        </p>
      )}
      <input value={c.phone} onChange={(e) => setPhone(c.id, e.target.value)} inputMode="tel" placeholder="📞 WhatsApp number (optional)" className="bg-stone-800 rounded-xl p-3 text-lg" />
      {b > 0 && <button onClick={remind} className="bg-green-600 rounded-2xl text-2xl font-bold py-4">💬 Send reminder</button>}
      <div className="divide-y divide-stone-800">
        {rows.map((x) => (
          <div key={x.id} className="flex justify-between py-3 text-lg">
            <span className="text-stone-400 w-16">{fmt(x.ts)}</span>
            <span className={`font-bold ${x.type === 'credit' ? 'text-red-400' : 'text-green-400'}`}>{x.type === 'credit' ? '+' : '−'}₹{x.amount}</span>
            <span className="text-stone-300 w-20 text-right">₹{x.run}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
