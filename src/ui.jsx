import { useEffect, useState } from 'react'

export const inr = (n) => (n < 0 ? '−' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN')

export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 6e4)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

const P = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  sprout: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
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
      style={{ background: `hsl(${h} 60% 88%)`, color: `hsl(${h} 50% 28%)` }}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  )
}

const TONE = { good: 'bg-leaf-soft text-leaf', mid: 'bg-amber-soft text-saffron-deep', bad: 'bg-brick-soft text-brick' }
export const Chip = ({ tone = 'mid', children }) => (
  <span className={`${TONE[tone]} inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold`}>{children}</span>
)

export const Card = ({ className = '', children }) => (
  <section className={`bg-card border border-line rounded-3xl p-4 shadow-[0_1px_0_rgba(27,34,54,.04),0_8px_24px_-12px_rgba(27,34,54,.18)] ${className}`}>{children}</section>
)

export function Btn({ tone = 'ink', className = '', ...p }) {
  const t = {
    ink: 'bg-ink text-paper hover:bg-ink-soft',
    leaf: 'bg-leaf text-white hover:brightness-110',
    brick: 'bg-card text-brick border-2 border-brick/30 hover:bg-brick-soft',
    soft: 'bg-card text-ink border border-line hover:bg-amber-soft',
    saffron: 'bg-saffron text-ink hover:brightness-105',
  }[tone]
  return <button {...p} className={`${t} rounded-2xl font-bold px-5 py-3.5 inline-flex items-center justify-center gap-2 transition active:scale-[.97] disabled:opacity-40 ${className}`} />
}

export function ScoreRing({ score, tone }) {
  const c = { good: '#17713F', mid: '#D9680B', bad: '#B3261E' }[tone]
  const r = 30, len = 2 * Math.PI * r
  return (
    <div className="relative w-20 h-20 shrink-0">
      <svg viewBox="0 0 72 72" className="-rotate-90 w-full h-full">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#E8DDC5" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={c} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - score / 100)} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-display text-2xl font-extrabold">{score}</span>
    </div>
  )
}

// The big mic. Listens to the mic level on its own so only this component re-renders at animation speed.
export function Orb({ stage, hands, onClick }) {
  const [lvl, setLvl] = useState(0)
  const listening = stage === 'listening'
  const thinking = stage === 'thinking'
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
      } catch { /* level meter is decoration only */ }
    })()
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); ctx?.close() }
  }, [listening])

  const core = listening
    ? 'bg-[radial-gradient(circle_at_30%_25%,#F58A7E,#B3261E_70%)] text-white'
    : thinking
      ? 'bg-ink text-paper'
      : hands
        ? 'bg-[radial-gradient(circle_at_30%_25%,#6FD39B,#17713F_70%)] text-white'
        : 'bg-[radial-gradient(circle_at_30%_25%,#FFC864,#F0901A_55%,#D9680B)] text-ink'
  const t = performance.now() / 140
  return (
    <div className="relative grid place-items-center w-56 h-56 sm:w-64 sm:h-64">
      {listening && [0, 0.8, 1.6].map((d) => (
        <span key={d} className="absolute inset-6 rounded-full bg-brick/40 animate-ripple" style={{ animationDelay: `${d}s` }} />
      ))}
      {thinking && <span className="absolute inset-3 rounded-full border-4 border-ink/15 border-t-saffron animate-spin" />}
      <button
        onClick={onClick}
        aria-label={listening ? 'Stop' : 'Speak'}
        className={`${core} relative w-44 h-44 sm:w-52 sm:h-52 rounded-full grid place-items-center shadow-[0_18px_40px_-10px_rgba(217,104,11,.55),inset_0_-8px_18px_rgba(0,0,0,.12)] transition-transform active:scale-95`}
        style={{ transform: `scale(${1 + lvl * 0.14})` }}
      >
        <Icon n={listening ? 'stop' : 'mic'} className="w-20 h-20 sm:w-24 sm:h-24" sw={1.7} />
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
