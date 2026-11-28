import { useEffect, useRef, useState } from 'react'
import { api } from './lib/api.js'
import { Btn, Icon } from './ui.jsx'

// Asks only for a name and a shop name, then turns the demo into an empty shop of the visitor's own.
export default function NewAccount({ onClose, onDone }) {
  const [owner, setOwner] = useState('')
  const [shop, setShop] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const first = useRef(null)
  useEffect(() => {
    first.current?.focus()
    const esc = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [busy, onClose])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try { await api.newAccount({ owner, shop }); onDone() }
    catch (x) { setErr(x.message); setBusy(false) }
  }
  const field = 'w-full min-h-12 rounded-2xl border border-line bg-white px-4 text-lg focus:outline-2 focus:outline-forest'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onClick={() => !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="na-title" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-card rounded-3xl p-6 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <h2 id="na-title" className="font-display text-2xl font-extrabold flex-1">Create your account</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="min-w-11 min-h-11 grid place-items-center text-muted"><Icon n="x" /></button>
        </div>
        <p className="text-muted -mt-2">Your shop starts empty: no customers, no entries. The sample demo data is removed.</p>
        <label className="flex flex-col gap-1 font-bold">Your name
          <input ref={first} value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={60} required autoComplete="name" placeholder="e.g. Ramesh Sharma" className={`${field} font-normal`} />
        </label>
        <label className="flex flex-col gap-1 font-bold">Shop name
          <input value={shop} onChange={(e) => setShop(e.target.value)} maxLength={60} required placeholder="e.g. Sharma Kirana Store" className={`${field} font-normal`} />
        </label>
        {err && <p role="alert" className="text-brick font-semibold">{err}</p>}
        <div className="flex gap-2 justify-end">
          <Btn type="button" tone="soft" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn type="submit" disabled={busy || !owner.trim() || !shop.trim()}>{busy ? 'Creating…' : 'Create shop'}</Btn>
        </div>
      </form>
    </div>
  )
}
