import { useEffect, useState } from 'react'

export const inr = (paise) => (paise < 0 ? '−' : '') + '₹' + (Math.abs(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export function when(iso) {
  const d = new Date(iso), m = Math.round((Date.now() - d) / 6e4)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const P = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
}

export function Icon({ n, className = 'w-5 h-5', sw = 2 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[n] }} />
  )
}

export function Avatar({ name, size = 'w-11 h-11 text-base' }) {
  const h = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span className={`${size} shrink-0 rounded-full grid place-items-center font-extrabold`}
      style={{ background: `hsl(${h} 45% 88%)`, color: `hsl(${h} 45% 24%)` }}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  )
}

const TONE = { good: 'bg-mint text-forest', warn: 'bg-amber-soft text-amber', bad: 'bg-brick-soft text-brick', plain: 'bg-paper text-muted border border-line' }
export const Chip = ({ tone = 'plain', children }) => (
  <span className={`${TONE[tone]} inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap`}>{children}</span>
)

export const Card = ({ className = '', children, ...p }) => (
  <section {...p} className={`bg-card border border-line rounded-3xl p-4 shadow-[0_1px_0_rgba(20,35,27,.04),0_10px_28px_-14px_rgba(20,35,27,.22)] ${className}`}>{children}</section>
)

export function Btn({ tone = 'forest', className = '', ...p }) {
  const t = {
    forest: 'bg-forest text-white hover:bg-forest-deep',
    soft: 'bg-card text-ink border border-line hover:bg-mint',
    brick: 'bg-card text-brick border-2 border-brick/30 hover:bg-brick-soft',
  }[tone]
  return <button {...p} className={`${t} rounded-2xl font-bold px-5 py-3.5 inline-flex items-center justify-center gap-2 transition active:scale-[.97] disabled:opacity-40 ${className}`} />
}

// The big mic. Reads its own mic level so only this component re-renders at animation speed.
export function Orb({ mode, onClick, label }) {
  const [lvl, setLvl] = useState(0)
  const listening = mode === 'listening'
  useEffect(() => {
    if (!listening) return setLvl(0)
    let stop = false, raf, stream, ctx
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (stop) return stream.getTracks().forEach((t) => t.stop())
        ctx = new AudioContext()
        const an = ctx.createAnalyser(); an.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(an)
        const buf = new Uint8Array(an.fftSize)
        const tick = () => {
          an.getByteTimeDomainData(buf)
          let m = 0
          for (const v of buf) m = Math.max(m, Math.abs(v - 128))
          setLvl((l) => l * 0.6 + Math.min(1, m / 80) * 0.4)
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch { /* the level meter is decoration only */ }
    })()
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); ctx?.close() }
  }, [listening])

  const core = listening
    ? 'bg-[radial-gradient(circle_at_30%_25%,#F58A7E,#B3261E_70%)]'
    : mode === 'processing' || mode === 'saving'
      ? 'bg-ink'
      : 'bg-[radial-gradient(circle_at_30%_25%,#3FA66B,#14532D_60%,#0C3B20)]'
  const t = performance.now() / 140
  return (
    <div className="relative grid place-items-center w-56 h-56 sm:w-64 sm:h-64">
      {listening && [0, 0.8, 1.6].map((d) => (
        <span key={d} className="absolute inset-6 rounded-full bg-brick/40 animate-ripple" style={{ animationDelay: `${d}s` }} />
      ))}
      {(mode === 'processing' || mode === 'saving') && <span className="absolute inset-3 rounded-full border-4 border-ink/10 border-t-forest animate-spin" />}
      <button
        data-mic
        onClick={onClick}
        aria-label={label}
        className={`${core} ${mode === 'speaking' ? 'animate-speak' : ''} text-white relative w-44 h-44 sm:w-52 sm:h-52 rounded-full grid place-items-center shadow-[0_18px_40px_-10px_rgba(20,83,45,.6),inset_0_-8px_18px_rgba(0,0,0,.18)] transition-transform active:scale-95`}
        style={{ transform: `scale(${1 + lvl * 0.14})` }}
      >
        <Icon n={listening ? 'stop' : mode === 'speaking' ? 'volume' : 'mic'} className="w-20 h-20 sm:w-24 sm:h-24" sw={1.6} />
      </button>
      {listening && (
        <div className="absolute -bottom-2 flex items-end gap-1 h-8" aria-hidden="true">
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} className="w-1.5 rounded-full bg-brick" style={{ height: `${Math.max(12, Math.min(100, 14 + lvl * 110 * (0.55 + 0.45 * Math.sin(t + i * 0.9))))}%` }} />
          ))}
        </div>
      )}
    </div>
  )
}
