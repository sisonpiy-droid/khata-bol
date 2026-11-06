export const SR = window.SpeechRecognition || window.webkitSpeechRecognition

// One-shot recognition. Rejects with Error whose message is: denied | no-speech | unsupported | aborted | other
export function listen(lang, onInterim) {
  let rec
  const promise = new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('unsupported'))
    rec = new SR()
    rec.lang = lang
    rec.interimResults = true
    rec.maxAlternatives = 1
    let final = ''
    rec.onresult = (e) => {
      let t = ''
      for (const r of e.results) t += r[0].transcript
      if (e.results[e.results.length - 1].isFinal) final = t
      onInterim?.(t)
    }
    rec.onerror = (e) => {
      const m = { 'not-allowed': 'denied', 'service-not-allowed': 'denied', 'no-speech': 'no-speech', aborted: 'aborted' }
      reject(new Error(m[e.error] || 'other'))
    }
    rec.onend = () => (final ? resolve(final) : reject(new Error('no-speech')))
    rec.start()
  })
  return { promise, stop: () => rec?.abort() }
}

// Resolves when finished (or after a safety timeout; Chrome sometimes never fires onend).
export function speak(text, lang) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve()
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-') === lang)
    if (v) u.voice = v
    const done = () => { clearTimeout(t); resolve() }
    const t = setTimeout(done, 4000 + text.length * 120)
    u.onend = u.onerror = done
    speechSynthesis.speak(u)
  })
}

// Any-language recognition: record with a simple silence detector, send to /api/transcribe (Gemini).
// Same shape as listen(); onLang(code) receives the detected language.
export function listenAudio(onInterim, onLang) {
  let stopped = false, finish = () => {}
  const promise = new Promise(async (resolve, reject) => {
    let stream, ctx
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      return reject(new Error(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : 'other'))
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
        if (j.lang) onLang?.(j.lang)
        onInterim?.(j.text)
        resolve(j.text)
      } catch {
        reject(new Error('server'))
      }
    }
    rec.start()
  })
  return { promise, stop: () => { stopped = true; finish() } }
}
