// Optional AI layer. Everything here is an enhancement: with no keys the deterministic parser (nlu.js) runs alone.
// The model only turns words into a structured guess; it never sees balances or touches the database.
const MODEL = process.env.ANTHROPIC_MODEL || 'the-model-id'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const CODES = 'hi-IN en-IN kn-IN ta-IN te-IN mr-IN bn-IN gu-IN pa-guru-IN ml-IN ur-IN en-US'

export const aiConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY)
export const sttConfigured = () => !!process.env.GEMINI_API_KEY

const PARSE = `You convert one spoken command from an Indian kirana (grocery) shopkeeper's udhaar (credit) ledger into JSON.
The text is a speech-to-text transcript in ANY language (Hindi, Hinglish, English, Kannada, Tamil, Telugu, Marathi, Bengali, ...), native script or romanised, possibly with recognition errors.
Reply with ONLY this JSON object, no markdown:
{"intent":"credit"|"payment"|"balance"|"summary"|"reverse"|"unknown","customer":string|null,"amount":number|null}
- credit: the customer took goods on udhaar / the shopkeeper lent. payment: the customer paid money back.
- balance: asks how much a customer owes (customer may be null if they mean "the same person"). summary: asks for today's accounts. reverse: asks to undo/delete the previous entry.
- customer: the person's name romanised in Latin script, Title Case, honorifics dropped. amount: plain rupees as a number (convert number words from any language: sau=100, hazaar=1000, nooru=100, ...).
- Use unknown if the text is none of these. Use null for anything not stated. Never invent a name or amount.`

async function callLlm(system, content) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(15000),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.error?.message || `Anthropic HTTP ${r.status}`)
    return (d.content || []).map((b) => b.text || '').join('')
  }
  const r = await fetch(`${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: content }] }],
      generationConfig: { maxOutputTokens: 2048 }, // headroom: thinking tokens share the budget
    }),
    signal: AbortSignal.timeout(15000),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d?.error?.message || `Gemini HTTP ${r.status}`)
  return (d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('')
}

function parseJson(text) {
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/)
  try { return m ? JSON.parse(m[0]) : null } catch { return null }
}

// -> {intent, customer, amountPaise} validated, or null when the model is off, down, or unsure.
export async function aiParse(text) {
  if (!aiConfigured()) return null
  try {
    const o = parseJson(await callLlm(PARSE, String(text).slice(0, 500)))
    if (!o || !['credit', 'payment', 'balance', 'summary', 'reverse'].includes(o.intent)) return null
    const customer = typeof o.customer === 'string' && o.customer.trim() ? o.customer.trim().slice(0, 60) : null
    const amount = Number(o.amount)
    return { intent: o.intent, customer, amountPaise: amount > 0 ? Math.round(amount * 100) : null }
  } catch {
    return null
  }
}

// Optional better recognizer: audio in, transcript out (any language).
export async function transcribe(dataUrl) {
  const m = String(dataUrl ?? '').match(/^data:(audio\/[\w.+-]+)(?:;[^,]*)?;base64,(.+)$/)
  if (!m) throw Object.assign(new Error('send a data:audio/... base64 string'), { status: 400 })
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('GEMINI_API_KEY is not set'), { status: 501 })
  const r = await fetch(`${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: m[1], data: m[2] } },
        { text: `Transcribe this speech exactly as spoken. The speaker is an Indian shopkeeper talking about customers, money and credit (udhaar); any language, possibly mixed (Hinglish). Keep names as heard. Reply ONLY JSON: {"text": string, "lang": one of [${CODES}]}. If there is no speech, text is "".` },
      ] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(25000),
  })
  const d = await r.json()
  if (!r.ok) throw Object.assign(new Error(d?.error?.message || `Gemini HTTP ${r.status}`), { status: 502 })
  const o = parseJson((d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('')) || {}
  return { text: String(o.text ?? '').trim() }
}
