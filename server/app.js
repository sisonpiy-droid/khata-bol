import 'dotenv/config'
import express from 'express'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5'

const PARSE = `You convert one spoken command from an Indian kirana (grocery) shopkeeper's udhaar (credit) ledger into JSON.
The text is a speech-to-text transcript in ANY language (Hindi, Hinglish, English, Bengali, Gujarati, Punjabi, Tamil, Telugu, Kannada, Malayalam, Marathi, Urdu, ...), in native script or romanised, possibly with recognition errors or several languages mixed.

Reply with ONLY this JSON object, no markdown, no commentary:
{"intent":"entry"|"balance_query"|"undo"|"correction"|"unknown","entries":[{"customer":string,"amount":number,"type":"credit"|"payment"}],"customer":string|null,"amount":number|null,"type":"credit"|"payment"|null}

Rules:
- intent "entry": one or MORE customers took goods on udhaar (type "credit") or paid money back (type "payment"). Put every one in "entries", in spoken order. Also copy the first entry into customer/amount/type.
  credit cues: udhaar liya, udhar, le gaye, baaki likh do, ne liya, ko udhaar diya, on credit, kadan, appu, sala, dhar, baki.
  payment cues: wapas diye, chuka diye, jama kiya, de diye, paid, returned, thirumbi, tirigi, vapas, ferat, fira.
  "Sunita ne pachaas wapas diye" = payment 50. "Ramesh ne do sau ka udhaar liya" = credit 200. "Ramesh 200 udhaar, Sunita 50 wapas" = two entries.
- intent "balance_query": asks how much a customer owes ("Ramesh ka kitna baaki hai?"). Put the name in "customer", entries = []. If they ask about everybody ("total kitna baaki hai", "who owes me"), customer = null.
- intent "undo": asks to delete/cancel the last entry ("last wala hatao", "undo", "cancel that").
- intent "correction": fixes the last entry ("galat, 300 tha", "sorry, it was 300", "actually payment"). Put the corrected amount in "amount" (null if unchanged) and "type" (null if unchanged); entries = [].
- intent "unknown": anything else, or customer/amount missing.
- "customer": the person's name as spoken, ALWAYS romanised in Latin script, Title Case. Drop honorifics (ji, bhai, anna, amma, madam, sahab).
- "amount": plain number of rupees. Convert number words from any language, e.g. ek=1, do=2, paanch=5, das=10, bees=20, pachaas=50, sau=100, derh sau=150, do sau=200, dhai sau=250, teen sau=300, saade teen sau=350, paanch sau=500, hazaar=1000, dhai hazaar=2500; Tamil nooru=100, irunooru=200, aimbadhu=50; Telugu noora=100, renduvandalu=200, veyyi=1000; Marathi pannas=50, donshe=200; Kannada nooru=100, aivattu=50; Bengali ek sho=100, poncash=50; Gujarati so=100, pachas=50; Punjabi sau=100, pachaas=50; Malayalam nooru=100, aimbathu=50. Digits stay as digits.`

const SCAN = `You are reading a photo of a shopkeeper's paper udhaar ledger (khata): handwritten or printed, in any language or script, possibly messy.
List every customer line with an amount. Reply with ONLY this JSON, no markdown:
{"entries":[{"customer":string,"amount":number,"type":"credit"|"payment"}]}
- "customer": name romanised in Latin script, Title Case.
- "amount": number in rupees (digits; convert Devanagari/Tamil/other numerals).
- type "credit" = amount the customer owes / took on udhaar (default). type "payment" only if the line is clearly marked paid / jama / returned.
- Skip headings, dates, totals and anything unreadable. If nothing is readable, return {"entries":[]}.`

const SAY = {
  readback: 'Read back each entry to the shopkeeper as a short statement (type credit = customer took goods on credit/udhaar; payment = customer paid money back), e.g. "Ramesh, 200 rupees udhaar." Then end by asking if that is correct.',
  balance: 'Say that {name} still owes {amount} rupees.',
  clear: 'Say that {name} has nothing pending (account is clear).',
  saved: 'Say it is noted / saved.',
  pick: 'Ask which one the shopkeeper means: a or b (names exactly as given).',
  head: "Say 'this week's summary'.",
  none: 'Say there are no customers yet.',
  nf: 'Say there is no customer named {name}.',
  unclear: "Say sorry, I didn't understand, please say it again.",
  summary: "Give a short spoken summary starting with 'this week's summary'. For each row (name, balance) say how much they owe, or that they are clear if balance is 0 or less. Biggest dues first.",
  total: 'Say the total pending across all customers is {amount} rupees and {count} customers still owe money.',
  undone: 'Say the last entry (name, amount, type) was removed.',
  fixed: 'Say the last entry was corrected: now {name}, {amount} rupees, type credit (udhaar) or payment (paid back).',
  warn: 'In ONE short sentence, warn the shopkeeper that {name} already owes {balance} rupees, and if oldestDays is given, that the oldest unpaid amount is that many days old.',
  scan: 'Say the photo was read: count entries found totalling total rupees. Ask whether to add them.',
  remind: 'Write a polite, friendly payment reminder message from a shopkeeper to customer {name}, saying {amount} rupees is pending and asking them to pay when convenient. Two short sentences, no emojis.',
}

async function claude({ system, content, max_tokens = 400 }) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set in .env'), { status: 500 })
  const r = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens, system, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(25000),
  })
  const data = await r.json()
  if (!r.ok) throw Object.assign(new Error(data?.error?.message || `Anthropic HTTP ${r.status}`), { status: 502 })
  return (data.content || []).map((b) => b.text || '').join('')
}

function parseJson(text) {
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/)
  try { return m ? JSON.parse(m[0]) : null } catch { return null }
}

const cleanEntry = (e) => {
  const customer = typeof e?.customer === 'string' ? e.customer.trim() : ''
  const amount = Math.round(Number(e?.amount) * 100) / 100
  return customer && amount > 0 && ['credit', 'payment'].includes(e?.type) ? { customer, amount, type: e.type } : null
}

function normaliseParse(o) {
  const out = { intent: 'unknown', entries: [], customer: null, amount: null, type: null }
  if (!o || typeof o !== 'object') return out
  const customer = typeof o.customer === 'string' && o.customer.trim() ? o.customer.trim() : null
  const entries = (Array.isArray(o.entries) ? o.entries : []).map(cleanEntry).filter(Boolean).slice(0, 10)
  if (o.intent === 'entry') {
    const list = entries.length ? entries : [cleanEntry(o)].filter(Boolean)
    if (list.length) return { intent: 'entry', entries: list, ...list[0], customer: list[0].customer }
  }
  if (o.intent === 'balance_query') return { ...out, intent: 'balance_query', customer }
  if (o.intent === 'undo') return { ...out, intent: 'undo' }
  if (o.intent === 'correction') {
    const amount = Number(o.amount) > 0 ? Number(o.amount) : null
    const type = ['credit', 'payment'].includes(o.type) ? o.type : null
    if (amount || type) return { ...out, intent: 'correction', amount, type }
  }
  return out
}

export const app = express()
app.use(express.json({ limit: '8mb' }))

const route = (path, fn) =>
  app.post(path, async (req, res) => {
    try { res.json(await fn(req.body || {})) }
    catch (e) { res.status(e.status || 502).json({ error: e.message }) }
  })
const bad = (m) => Object.assign(new Error(m), { status: 400 })

route('/api/parse', async (b) => {
  const transcript = String(b.transcript ?? '').trim().slice(0, 500)
  if (!transcript) throw bad('empty transcript')
  const raw = await claude({ system: PARSE, content: transcript })
  return { ...normaliseParse(parseJson(raw)), raw }
})

route('/api/say', async (b) => {
  if (!SAY[b.kind]) throw bad('unknown kind')
  const vars = JSON.stringify(b.vars ?? {})
  if (vars.length > 4000) throw bad('too big')
  const text = await claude({
    system: `You write short spoken lines for a voice-only ledger app used by an Indian shopkeeper. Write in ${String(b.langName).slice(0, 60)}, in natural everyday spoken style, using that language's own script. Keep customer names exactly as given and write numbers as digits. Output ONLY the line(s): no quotes, no markdown, no explanation.`,
    content: `${SAY[b.kind]}\nData: ${vars}`,
  })
  return { text: text.trim() }
})

route('/api/yesno', async (b) => {
  const text = String(b.text ?? '').slice(0, 200)
  const out = await claude({
    system: 'Classify a short spoken reply (any language) to the question "is that correct?". Answer with exactly one word: yes, no, or unknown.',
    content: text,
    max_tokens: 5,
  })
  const a = out.trim().toLowerCase()
  return { answer: a.startsWith('yes') ? 'yes' : a.startsWith('no') ? 'no' : 'unknown' }
})

route('/api/scan', async (b) => {
  const m = String(b.image ?? '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/)
  if (!m) throw bad('send a data:image/... base64 string')
  const raw = await claude({
    system: SCAN,
    max_tokens: 1500,
    content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
      { type: 'text', text: 'Extract the ledger entries.' },
    ],
  })
  const o = parseJson(raw)
  return { entries: (Array.isArray(o?.entries) ? o.entries : []).map(cleanEntry).filter(Boolean).slice(0, 40), raw }
})

// Any-language speech-to-text: audio -> Gemini -> {text, lang}. Optional; the app falls back to Chrome speech.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const CODES = 'hi-IN en-IN bn-IN gu-IN pa-guru-IN mr-IN ta-IN te-IN kn-IN ml-IN ur-IN ne-NP si-LK en-US es-ES fr-FR pt-BR ar-SA id-ID sw-KE fil-PH vi-VN th-TH tr-TR ru-RU de-DE ja-JP zh-CN'

app.get('/api/config', (_req, res) => res.json({ gemini: !!process.env.GEMINI_API_KEY }))

route('/api/transcribe', async (b) => {
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('GEMINI_API_KEY is not set in .env'), { status: 500 })
  const m = String(b.audio ?? '').match(/^data:(audio\/[\w.+-]+)(?:;[^,]*)?;base64,(.+)$/)
  if (!m) throw bad('send a data:audio/... base64 string')
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
  const r = await fetch(`${base}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: m[1], data: m[2] } },
        { text: `Transcribe this speech exactly as spoken. The speaker is an Indian shopkeeper talking about customers, money and credit (udhaar); any language, possibly mixed (e.g. Hinglish). Write it in the language's own script and keep names as heard. Reply ONLY JSON: {"text": string, "lang": one of [${CODES}]}. If there is no speech, text is "".` },
      ] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2048 }, // headroom: thinking tokens share the budget
    }),
    signal: AbortSignal.timeout(25000),
  })
  const data = await r.json()
  if (!r.ok) throw Object.assign(new Error(data?.error?.message || `Gemini HTTP ${r.status}`), { status: 502 })
  const raw = (data.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('')
  const o = parseJson(raw) || {}
  return { text: String(o.text ?? '').trim(), lang: CODES.split(' ').includes(o.lang) ? o.lang : null }
})
