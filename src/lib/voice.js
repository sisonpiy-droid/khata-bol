// The voice conversation loop: listen -> understand -> speak -> listen. It owns every timer, recognizer and utterance,
// so a late event can never touch a newer turn (generation guard) and dispose() leaves nothing running.
// All browser pieces are injected, so the real loop is tested in Node with a simulated recognizer
// (the real microphone path lives in speech.js and is not exercised there).
import { initial, reduce } from './machine.js'

export const LOW_CONFIDENCE = 0.45 // below this the words are probably wrong: ask again instead of acting
export const MSG = {
  denied: 'Microphone is blocked. Click the lock icon in the address bar, set Microphone to Allow, then reload this page.',
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
  'no-mic': 'No microphone was found. Plug in or enable a microphone, or type below.',
  network: 'Speech recognition needs an internet connection. Check your network, or type below.',
  lang: 'This browser cannot recognise that language. Choose Hindi or English, or type below.',
  unsupported: 'This browser has no speech recognition. Please use Chrome, or type below.',
  other: 'Speech recognition failed. Try again, or type below.',
}
export const OFFLINE = 'Maaf kijiye, server se connect nahi ho paaya. Kuch save nahi hua.'
export const AGAIN = 'Maaf kijiye, dobara boliye.'

/**
 * deps: converse(body)->Promise, listen(lang,onInterim)->{promise:{text,confidence},stop}, speak(text)->Promise,
 *       cancelSpeech(), getLang(), getReplyLang(), supported()->bool, sleep(ms), hidden()->bool,
 *       refresh() (reload dashboard data), onChange(snapshot), quietMs (wait after speech before opening the mic)
 */
export function createVoice(deps) {
  const quietMs = deps.quietMs ?? 450
  let vm = initial, gen = 0, alive = true, stopListening = null
  const snap = { heard: null, interim: '', reply: null, err: null, retry: null, pid: null }
  const emit = () => deps.onChange?.({ ...snap, mode: vm.name, dlg: vm.dlg, canRetry: !!snap.retry })
  const send = (e) => { vm = reduce(vm, e); emit(); return vm }
  const busy = () => vm.name === 'processing' || vm.name === 'saving'
  const quiet = () => deps.sleep(quietMs)

  // Anything the user does on purpose cancels in-flight listening and speech. `gen` makes older continuations harmless.
  function interrupt() {
    gen++
    deps.cancelSpeech(); stopListening?.(); stopListening = null
    if (vm.name === 'speaking' || vm.name === 'listening') send({ type: 'STOP' })
  }

  async function turn(body, voice = false) {
    if (!alive || busy()) return // one request at a time: a double tap cannot double-submit
    if (!voice) interrupt() // a spoken turn arrives while we are 'listening'; taps interrupt whatever is going on
    const g = gen
    send({ type: voice ? 'HEARD' : body.action === 'confirm' ? 'CONFIRM' : 'TYPED' })
    if (!busy()) return
    if (body.text != null) snap.heard = body.text
    snap.err = null; snap.retry = null; emit()
    let r
    try {
      r = await deps.converse({ ...body, lang: deps.getLang(), reply: deps.getReplyLang(), pid: body.pid ?? snap.pid })
    } catch {
      if (!alive) return
      snap.err = OFFLINE; snap.retry = { body, voice } // never pretend it was saved; the same body (same pending id) is safe to resend
      send({ type: 'FAIL' }); send({ type: 'STOP' })
      return deps.speak(OFFLINE)
    }
    if (!alive) return
    snap.reply = r; snap.pid = r.pid ?? null // always show what the server really did, even if the user moved on meanwhile
    send({ type: 'REPLY', next: r.state }); deps.refresh?.()
    if (g !== gen) { send({ type: 'STOP' }); return } // the user moved on while we waited: show the result, say nothing
    if (r.say) await deps.speak(r.say)
    if (!alive || g !== gen || vm.name !== 'speaking') return // interrupted: whoever interrupted owns the state now
    send({ type: 'SPOKEN' })
    if (r.expect && !deps.hidden()) { // the app asked a question: listen for the answer once its own voice has stopped
      await quiet()
      if (alive && g === gen && vm.name === r.state) listenOnce(0)
    }
  }

  async function listenOnce(attempt = 0) {
    if (!alive) return
    if (!deps.supported()) { snap.err = MSG.unsupported; emit(); return }
    deps.cancelSpeech()
    if (send({ type: 'LISTEN' }).name !== 'listening') return
    const g = ++gen
    snap.interim = ''; snap.err = null; emit()
    const l = deps.listen(deps.getLang(), (t) => { if (alive && g === gen) { snap.interim = t; emit() } })
    stopListening = l.stop
    let heard
    try {
      heard = await l.promise
    } catch (e) {
      if (!alive || g !== gen || e.message === 'aborted') return
      if (e.message === 'no-speech' && vm.dlg !== 'idle' && attempt < 1) return reask(g, attempt)
      snap.err = MSG[e.message] ?? MSG.other
      send({ type: 'FAIL' }); return
    }
    if (!alive || g !== gen) return // a late recognition result must not start a turn
    stopListening = null
    if (heard.confidence != null && heard.confidence < LOW_CONFIDENCE && attempt < 1) { // probably misheard: show it, never act on it
      snap.heard = heard.text
      return reask(g, attempt)
    }
    turn({ text: heard.text }, true)
  }

  async function reask(g, attempt) {
    send({ type: 'SAY' })
    await deps.speak(AGAIN)
    if (!alive || g !== gen || vm.name !== 'speaking') return
    send({ type: 'SPOKEN' }); await quiet()
    if (alive && g === gen && vm.name === vm.dlg && !deps.hidden()) listenOnce(attempt + 1)
  }

  return {
    get state() { return { ...snap, mode: vm.name, dlg: vm.dlg, canRetry: !!snap.retry } },
    tapMic() {
      if (vm.name === 'listening') { gen++; stopListening?.(); stopListening = null; send({ type: 'STOP' }); return }
      if (busy()) return
      if (vm.name === 'speaking') interrupt() // talk over the app: stop its voice, then listen
      listenOnce(0)
    },
    submitText: (text) => turn({ text }, false),
    confirm: () => turn({ action: 'confirm', pid: snap.pid }),
    cancel: () => turn({ action: 'cancel' }),
    choose: (id) => turn({ action: 'choose', choice: id }),
    chooseType: (t) => turn({ action: 'type', choice: t }),
    reverse: (txnId) => turn({ action: 'reverse', txnId }),
    retry() { const r = snap.retry; if (r) { snap.retry = null; turn(r.body, false) } },
    // The tab went to the background: stop the microphone and the voice. The pending entry stays on the server.
    hidden: interrupt,
    // Page (re)loaded: show an unfinished entry again without speaking or listening (browsers need a tap first).
    async resume() {
      try {
        const r = await deps.converse({ action: 'status', lang: deps.getLang(), reply: deps.getReplyLang() })
        if (!alive || r.state === 'idle') return
        snap.reply = r; snap.pid = r.pid ?? null
        vm = { name: r.state, dlg: r.state }; emit()
      } catch { /* offline: the banner explains it */ }
    },
    // The language changed: re-ask a pending question in the new language. Never saves anything by itself.
    async languageChanged() {
      interrupt()
      if (vm.dlg !== 'idle') await turn({ action: 'status' }, false)
    },
    // Demo reset: forget everything shown (the server wiped the conversation too).
    clear() { interrupt(); Object.assign(snap, { heard: null, interim: '', reply: null, err: null, retry: null, pid: null }); vm = initial; emit() },
    dispose() { alive = false; gen++; deps.cancelSpeech(); stopListening?.(); stopListening = null },
  }
}
