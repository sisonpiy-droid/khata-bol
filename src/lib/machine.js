// The voice UI's state machine as data: every legal move is listed, anything else is ignored.
// `dlg` is the server's dialogue state (idle | awaiting_clarification | awaiting_confirmation); "DLG" means return to it.
// "speaking" never allows LISTEN, so the microphone cannot transcribe the app's own voice.
export const initial = { name: 'idle', dlg: 'idle' }

const T = {
  idle: { LISTEN: 'listening', TYPED: 'processing' },
  listening: { HEARD: 'processing', SAY: 'speaking', FAIL: 'error', STOP: 'DLG' },
  processing: { REPLY: 'speaking', FAIL: 'error', STOP: 'DLG' },
  speaking: { SPOKEN: 'DLG', STOP: 'DLG' },
  awaiting_clarification: { LISTEN: 'listening', TYPED: 'processing' },
  awaiting_confirmation: { LISTEN: 'listening', TYPED: 'processing', CONFIRM: 'saving' },
  saving: { REPLY: 'speaking', FAIL: 'error', STOP: 'DLG' },
  error: { LISTEN: 'listening', TYPED: 'processing', STOP: 'DLG' },
}

// event: {type, next?}. REPLY carries the server's new dialogue state.
export function reduce(state, event) {
  const to = T[state.name]?.[event.type]
  if (!to) return state
  const dlg = event.type === 'REPLY' ? event.next ?? 'idle' : state.dlg
  return { name: to === 'DLG' ? dlg : to, dlg }
}
