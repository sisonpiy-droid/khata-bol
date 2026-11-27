export const SR = window.SpeechRecognition || window.webkitSpeechRecognition

const ERRORS = {
  'not-allowed': 'denied', 'service-not-allowed': 'denied', 'no-speech': 'no-speech', aborted: 'aborted',
  'audio-capture': 'no-mic', network: 'network', 'language-not-supported': 'lang',
}

// One-shot recognition -> {text, confidence 0..1}. Rejects with Error whose message is one of:
// denied | no-mic | network | lang | no-speech | unsupported | aborted | other
export function listen(lang, onInterim, maxMs = 15000) {
  let rec
  const promise = new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('unsupported'))
    rec = new SR()
    rec.lang = lang
    rec.interimResults = true
    rec.maxAlternatives = 1
    let final = '', confidence = null, failed = false
    const guard = setTimeout(() => rec.abort(), maxMs) // a hung recognizer must not leave the mic hot
    rec.onresult = (e) => {
      let t = ''
      for (const r of e.results) t += r[0].transcript
      const last = e.results[e.results.length - 1]
      if (last.isFinal) { final = t.trim(); confidence = last[0].confidence > 0 ? last[0].confidence : null } // some Android builds report 0 for "unknown"
      onInterim?.(t)
    }
    rec.onerror = (e) => { failed = true; clearTimeout(guard); reject(new Error(ERRORS[e.error] || 'other')) }
    rec.onend = () => { clearTimeout(guard); if (!failed) final ? resolve({ text: final, confidence }) : reject(new Error('no-speech')) }
    try { rec.start() } catch { clearTimeout(guard); reject(new Error('other')) }
  })
  return { promise, stop: () => rec?.abort() }
}

const norm = (v) => v.lang.replace('_', '-')
const voices = () => new Promise((resolve) => {
  const v = speechSynthesis.getVoices()
  if (v.length) return resolve(v)
  const t = setTimeout(() => resolve(speechSynthesis.getVoices()), 800) // Chrome fills the list asynchronously
  speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); resolve(speechSynthesis.getVoices()) }, { once: true })
})
const pick = (vs, lang) => vs.find((v) => norm(v) === lang) ?? vs.find((v) => norm(v).startsWith(lang.slice(0, 2)))

export async function hasVoice(lang) {
  return !!window.speechSynthesis && !!pick(await voices(), lang)
}

// Resolves when finished (or after a safety timeout; Chrome sometimes never fires onend).
// With no voice for the language it falls back to an English voice rather than staying silent.
export async function speak(text, lang) {
  if (!window.speechSynthesis || !text) return
  const vs = await voices()
  return new Promise((resolve) => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = pick(vs, lang) ?? pick(vs, 'en-IN')
    u.lang = v ? norm(v) : lang
    if (v) u.voice = v
    u.rate = 0.95
    const done = () => { clearTimeout(t); resolve() }
    const t = setTimeout(done, 4000 + text.length * 120)
    u.onend = u.onerror = done
    speechSynthesis.speak(u)
  })
}

// Optional better recognizer: record with a simple silence detector, send to /api/transcribe (Gemini).
// Same shape as listen(), confidence unknown.
export function listenAudio(onInterim) {
  let stopped = false, finish = () => {}
  const promise = new Promise(async (resolve, reject) => {
    let stream, ctx
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      return reject(new Error(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : e.name === 'NotFoundError' ? 'no-mic' : 'other'))
    }
    const rec = new MediaRecorder(stream), chunks = []
    ctx = new AudioContext()
    const an = ctx.createAnalyser(); an.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    const t0 = Date.now(); let heard = false, quietSince = Date.now()
    finish = () => rec.state !== 'inactive' && rec.stop()
    const tick = setInterval(() => {
      an.getByteTimeDomainData(buf)
      const level = Math.max(...buf.map((v) => Math.abs(v - 128)))
      if (level > 14) { heard = true; quietSince = Date.now(); onInterim?.('🎙 …') }
      const now = Date.now()
      if ((heard && now - quietSince > 1300) || (!heard && now - t0 > 7000) || now - t0 > 20000) finish()
    }, 100)
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = async () => {
      clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); ctx.close()
      if (stopped) return reject(new Error('aborted'))
      if (!heard) return reject(new Error('no-speech'))
      try {
        const blob = new Blob(chunks, { type: rec.mimeType })
        const audio = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(blob) })
        const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio }) })
        const j = await r.json()
        if (!r.ok) throw new Error('server')
        if (!j.text) return reject(new Error('no-speech'))
        onInterim?.(j.text)
        resolve({ text: j.text, confidence: null })
      } catch {
        reject(new Error('server'))
      }
    }
    rec.start()
  })
  return { promise, stop: () => { stopped = true; finish() } }
}
