// The conversation state machine. Server-side, explicit, and stored in the database, never "remembered by the model".
//   idle -> awaiting_clarification (customer / amount / direction missing or uncertain) -> awaiting_confirmation -> idle
// Money only moves in commit(), after an explicit yes for THE pending entry (its id travels with every reply),
// using an idempotency key fixed when the entry was first understood. One request per session runs at a time.
//
// Product rules (documented, tested):
//  * Nothing is saved without an explicit yes. Uncertain direction ("Ramesh ne 200 diye") or customer is asked, never guessed.
//  * A repayment larger than what the customer owes is allowed only after an explicit warning and yes; the excess is an advance.
//  * A name that is only a plausible match to an existing customer must be chosen: existing one or "naya customer".
//  * An unanswered question expires after 5 minutes and is never confirmed late.
import { randomUUID } from 'node:crypto'
import * as L from './ledger.js'
import { parse } from './nlu.js'
import { matchCustomer, score } from './match.js'
import { aiParse, aiConfigured } from './llm.js'
import { say as T } from './say.js'
import * as F from './follow.js'
import { answer } from './answers.js'
import { isHm, isYmd, istHm, istYmd, label, timeLabel } from './dates.js'

// Tests replace this to fix "now"; production always uses the real clock.
export const clock = { now: () => new Date() }

const MIN_PAISE = 100
const BIG_PAISE = 500000 // Rs 5,000: ask the shopkeeper to double-check
const PENDING_TTL = 5 * 60 * 1000
const CONTEXT_WORDS = /\b(ab|abhi|unhone|usne|woh|wo|same|him|her|them)\b/
const ID_RE = /^[\w-]{8,64}$/
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/
const ACTIONS = new Set(['greet', 'status', 'confirm', 'cancel', 'choose', 'type', 'reverse', 'option', 'briefing'])

const fresh = () => ({ state: 'idle', customerId: null, lastTxnId: null, pending: null })
const rup = (paise) => String(Math.round(Math.abs(paise)) / 100)
const byName = (a, b) => a.name.localeCompare(b.name)

function loadCtx(db, id) {
  const row = db.prepare('SELECT ctx FROM conversations WHERE id = ?').get(id)
  return row ? JSON.parse(row.ctx) : fresh()
}
const saveCtx = (db, id, ctx) =>
  db.prepare('INSERT OR REPLACE INTO conversations (id, ctx, updated_at) VALUES (?, ?, ?)').run(id, JSON.stringify(ctx), new Date().toISOString())

const blank = {
  isYes: false, isNo: false, isCancel: false, isBalance: false, isSummary: false, isReverse: false, hasCredit: false, hasPayment: false, amountPaise: null, nameRef: null, recognised: true,
  report: null, isFollowUp: false, followEdit: false, cancelFollowUp: false, setPriority: false, priority: null, pronoun: false,
  when: { date: null, rolled: false, dateOptions: null, time: null, timeOptions: null, daypart: null }, // button actions carry no spoken date
}

// Trust boundary: everything from the client is checked here, whatever route it arrived by.
function clean(b) {
  const bad = (m = 'Invalid request') => new L.LedgerError(m)
  if (!b || typeof b !== 'object') throw bad()
  if (!ID_RE.test(String(b.session))) throw bad('Invalid session')
  const text = b.text == null ? '' : typeof b.text === 'string' ? b.text.slice(0, 500) : (() => { throw bad() })()
  const action = b.action == null ? null : ACTIONS.has(b.action) ? b.action : (() => { throw bad() })()
  const lang = b.lang == null ? 'hi-IN' : LANG_RE.test(b.lang) ? b.lang : (() => { throw bad() })()
  const reply = b.reply == null ? null : LANG_RE.test(b.reply) ? b.reply : (() => { throw bad() })()
  const pid = b.pid == null ? null : ID_RE.test(String(b.pid)) ? String(b.pid) : (() => { throw bad() })()
  const txnId = b.txnId == null ? null : ID_RE.test(String(b.txnId)) ? String(b.txnId) : (() => { throw bad() })()
  let choice = b.choice ?? null
  if (action === 'choose' && !(Number.isInteger(choice) && choice >= 0)) throw bad()
  if (action === 'type' && !['credit', 'payment'].includes(choice)) throw bad()
  if (action === 'option' && !/^(\d{4}-\d{2}-\d{2}|[0-2]\d:[0-5]\d)$/.test(String(choice))) throw bad()
  if (action === 'reverse' && !txnId) throw bad()
  return { session: String(b.session), text, action, lang, reply, pid, txnId, choice }
}

// One request at a time per session: two taps or two tabs can never interleave a read-modify-write of the same conversation.
const locks = new Map()
function withLock(key, fn) {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
  locks.set(key, next)
  next.finally(() => { if (locks.get(key) === next) locks.delete(key) }).catch(() => {})
  return next
}

export async function converse(db, body) {
  const b = clean(body)
  return withLock(b.session, () => run(db, b))
}

async function run(db, { session, text, action, choice, txnId, lang, reply: replyLang, pid }) {
  const tl = replyLang || lang // language the answer is written in (the client picks one it can speak)
  const shopId = L.shopFor(db, session) // each visitor session has its own private shop
  let ctx = loadCtx(db, session)
  let expired = false
  if (ctx.pending && Date.now() - (ctx.at ?? 0) > PENDING_TTL) { ctx.pending = null; ctx.state = 'idle'; expired = true }
  const customers = L.listCustomers(db, shopId)
  const now = clock.now()
  if (action === 'greet') return { say: T(tl, 'greet'), state: ctx.state, expect: null, card: null, pid: ctx.pending?.id ?? null }

  let f
  if (action === 'confirm') f = { ...blank, isYes: true }
  else if (action === 'cancel') f = { ...blank, isCancel: true }
  else if (action === 'status') f = { ...blank, statusOnly: true }
  else if (action === 'type') f = { ...blank, chooseType: choice }
  else if (action === 'choose') f = choice === 0 ? { ...blank, chooseNew: true, chooseIdx: 0 } : { ...blank, chooseIdx: choice, nameRef: { status: 'match', customer: customers.find((c) => c.id === choice) } }
  else if (action === 'option') f = { ...blank, chooseOption: String(choice) }
  else if (action === 'briefing') f = { ...blank, report: { kind: 'briefing' } }
  else if (action === 'reverse') { ctx.pending = null; ctx.state = 'idle'; f = { ...blank, isReverse: true, reverseId: txnId } }
  else {
    f = parse(text, customers, { now })
    const hasIntent = f.report || f.isFollowUp || f.followEdit || f.cancelFollowUp || f.setPriority || f.hasCredit || f.hasPayment || f.isBalance || f.isReverse || f.isYes || f.isNo || f.isCancel || f.isAddCustomer
    if (!f.recognised || (!hasIntent && ctx.state === 'idle')) {
      // Optional AI sees only the spoken sentence, never customers or balances, and its guess still needs a confirmed read-back.
      const ai = await aiParse(text)
      if (ai) f = fromAi(ai, customers)
      else if (!f.recognised && !/^(hi|en)/.test(lang) && !aiConfigured())
        return { say: T(tl, 'ai_needed'), state: ctx.state, expect: ctx.state === 'idle' ? null : 'clarify', card: { kind: 'error' }, pid: ctx.pending?.id ?? null }
    }
    f.said = text
  }
  if (f.nameRef?.status === 'match' && !f.nameRef.customer) f.nameRef = null // stale choice id
  // The client says which pending entry it is answering. If that is not the current one, the answer must not apply.
  if (pid && ctx.pending && ctx.pending.id !== pid && (f.isYes || action === 'confirm' || action === 'choose' || action === 'type')) f.stale = true

  const reply = expired && f.isYes && !f.hasCredit && !f.hasPayment
    ? { say: T(tl, 'expired'), state: 'idle', expect: null, card: { kind: 'cancelled' } }
    : step(db, ctx, f, tl, customers, shopId, now)
  if (ctx.pending) ctx.at = Date.now()
  saveCtx(db, session, ctx)
  return { ...reply, pid: ctx.pending?.id ?? null }
}

function fromAi(ai, customers) {
  const f = { ...blank, viaAi: true, amountPaise: ai.amountPaise, nameRef: ai.customer ? matchCustomer(ai.customer, customers) : null }
  if (f.nameRef && f.nameRef.status === 'new') f.nameRef.name = ai.customer
  Object.assign(f, { hasCredit: ai.intent === 'credit', hasPayment: ai.intent === 'payment', isBalance: ai.intent === 'balance', isSummary: ai.intent === 'summary', isReverse: ai.intent === 'reverse' })
  return f
}

function step(db, ctx, f, lang, customers, shopId, now) {
  const out = (key, v, extra = {}) => ({ say: T(lang, key, v), state: ctx.state, expect: ctx.state === 'idle' ? null : ctx.state === 'awaiting_confirmation' ? 'confirm' : 'clarify', card: null, ...extra })
  const bal = (id) => L.balanceOf(db, id)
  const nameOf = (id) => customers.find((c) => c.id === id)?.name ?? L.entryById(db, shopId, ctx.lastTxnId)?.customer_name ?? ''
  const finish = (key, v, extra) => { ctx.state = 'idle'; ctx.pending = null; return out(key, v, extra) }
  const cancel = () => finish('cancelled', {}, { card: { kind: 'cancelled' } })
  const unclear = () => { const r = prompt(); return { ...r, say: `${T(lang, 'unclear')} ${r.say}` } }

  function resolveName(p, ref) {
    p.candidates = null; p.customerId = null; p.newName = null
    if (ref.status === 'match') p.customerId = ref.customer.id
    else if (ref.status === 'ambiguous') p.candidates = ref.candidates.map((c) => ({ id: c.id, name: c.name })).sort(byName)
    else if (ref.status === 'maybe') p.candidates = [...ref.candidates.map((c) => ({ id: c.id, name: c.name })), { id: 0, name: `${ref.name} (naya customer)`, isNew: true, newName: ref.name }]
    else p.newName = ref.name
  }
  // The user answered "which one?": accept a tap (handled earlier as nameRef), the spoken name, or "naya".
  function pickCandidate(p, f) {
    const c = p.candidates, fresh = c.find((x) => x.isNew)
    const choose = (x) => { p.candidates = null; if (x.isNew) { p.customerId = null; p.newName = x.newName } else { p.customerId = x.id; p.newName = null } return true }
    if (f.chooseNew) return fresh ? choose(fresh) : false
    if (f.nameRef?.status === 'match' && c.some((x) => x.id === f.nameRef.customer.id)) return choose(c.find((x) => x.id === f.nameRef.customer.id))
    const toks = f.tokens ?? []
    if (fresh && toks.some((t) => t === 'naya' || t === 'new')) return choose(fresh)
    const best = toks.flatMap((t) => c.map((x) => ({ x, s: score(t, x.isNew ? x.newName : x.name) }))).sort((a, b) => b.s - a.s)
    const top = best[0], second = best.find((y) => y.x !== top?.x)
    return top && top.s >= 0.6 && (!second || top.s > second.s) ? choose(top.x) : false // identical names cannot be told apart by voice: buttons
  }
  const settle = (p) => { p.missing = !p.customerId && !p.newName ? 'customer' : p.amountPaise == null ? 'amount' : p.type == null ? 'type' : null }
  const badAmount = (p) => {
    if (p.amountPaise != null && (!Number.isInteger(p.amountPaise) || p.amountPaise < MIN_PAISE || p.amountPaise > L.MAX_PAISE)) { p.amountPaise = null; return true }
    return false
  }
  const reAskAmount = (p) => { p.missing = 'amount'; ctx.state = 'awaiting_clarification'; return out('invalid_amount') }
  const optionsCard = (cands, extra = {}) => ({ kind: 'choice', options: cands.map((c) => ({ id: c.id, name: c.name, isNew: !!c.isNew, balance_paise: c.id ? bal(c.id) : null })), ...extra })
  const choiceReply = (cands, extra) => {
    ctx.state = 'awaiting_clarification'
    const names = cands.map((c) => c.name)
    const dup = new Set(names).size < names.length // identical names: tell them apart by what they owe
    const spoken = cands.map((c) => (dup && c.id ? `${c.name} (${rup(bal(c.id))} rupaye baaki)` : c.name))
    return out('clarify_customer', { names: spoken }, { card: optionsCard(cands, extra) })
  }

  // Ask the next question for whatever is pending. Pure: only builds a reply.
  function prompt(prefix = false) {
    const p = ctx.pending
    if (p.kind === 'follow') return fprompt(prefix)
    if (p.kind === 'reversal') {
      ctx.state = 'awaiting_confirmation'
      const e = L.entryById(db, shopId, p.txnId)
      const r = out('reverse_ask', { name: e.customer_name, type: e.type, amount: e.amount_paise }, { card: { kind: 'reversal', entry: { customer_name: e.customer_name, type: e.type, amount_paise: e.amount_paise, ts: e.ts } } })
      return p.more ? { ...r, say: r.say + T(lang, 'reverse_more', { n: p.more }) } : r
    }
    if (p.kind === 'balance') {
      if (p.candidates) return choiceReply(p.candidates)
      ctx.state = 'awaiting_clarification'; return out('ask_customer_for_balance')
    }
    if (p.kind === 'customer') {
      if (p.candidates) return choiceReply(p.candidates)
      ctx.state = 'awaiting_confirmation'
      return out('ask_new_customer', { name: p.newName }, { card: { kind: 'newcustomer', name: p.newName } })
    }
    settle(p)
    if (p.missing === 'customer') {
      if (p.candidates) return choiceReply(p.candidates, { type: p.type, amount_paise: p.amountPaise })
      ctx.state = 'awaiting_clarification'; return out('clarify_name')
    }
    const name = p.customerId ? nameOf(p.customerId) : p.newName
    if (p.missing === 'amount') { ctx.state = 'awaiting_clarification'; return out('clarify_amount', { name }) }
    if (p.missing === 'type') {
      ctx.state = 'awaiting_clarification'
      return out('clarify_type', { name, amount: p.amountPaise }, { card: { kind: 'typechoice', customer: { name }, amount_paise: p.amountPaise } })
    }
    ctx.state = 'awaiting_confirmation'
    const owed = p.customerId ? Math.max(bal(p.customerId), 0) : 0
    const current = p.customerId ? bal(p.customerId) : 0
    const over = p.type === 'payment' && p.amountPaise > owed ? p.amountPaise - owed : 0
    const big = p.amountPaise >= BIG_PAISE
    const v = { name, amount: p.amountPaise, type: p.type, isNew: !p.customerId }
    const r = out(prefix ? 'corrected' : `confirm_${p.type}`, v, {
      card: { kind: 'pending', type: p.type, amount_paise: p.amountPaise, large: big, overpay_paise: over, viaAi: !!p.viaAi, customer: { id: p.customerId, name, isNew: !p.customerId, balance_paise: current }, after_paise: current + (p.type === 'credit' ? p.amountPaise : -p.amountPaise) },
    })
    return { ...r, say: (over ? T(lang, 'overpay', { name, owed, extra: over }) : '') + r.say + (big ? T(lang, 'large_amount') : '') }
  }

  function startTxn(f) {
    const p = { kind: 'txn', id: randomUUID(), type: f.weakPayment ? null : f.hasPayment ? 'payment' : 'credit', amountPaise: f.amountPaise, customerId: null, newName: null, candidates: null, missing: null, said: f.said ?? null, viaAi: !!f.viaAi }
    if (f.nameRef) resolveName(p, f.nameRef)
    else if (ctx.customerId && CONTEXT_WORDS.test(f.text ?? '')) p.customerId = ctx.customerId
    ctx.pending = p
    return badAmount(p) ? reAskAmount(p) : prompt()
  }

  function startCustomer(f) {
    if (f.nameRef.status === 'match') return finish('customer_exists', { name: f.nameRef.customer.name })
    ctx.pending = { kind: 'customer', id: randomUUID(), customerId: null, newName: null, candidates: null }
    resolveName(ctx.pending, f.nameRef)
    return prompt()
  }

  function startReverse(f) {
    const ok = (e) => e && e.type !== 'reversal' && !db.prepare('SELECT 1 FROM transactions WHERE reversed_of = ?').get(e.id)
    let target = null, more = 0
    if (f.specificReverse) { // "Kal wale 300 cancel kar do"
      const cid = f.nameRef?.status === 'match' ? f.nameRef.customer.id : null
      const rows = L.findReversible(db, shopId, { amountPaise: f.reverseAmountPaise, dayOffset: f.reverseWhen, customerId: cid })
      if (!rows.length) return finish('reverse_notfound', { amount: f.reverseAmountPaise, when: f.reverseWhen === -1 ? (lang.startsWith('en') ? 'yesterday' : 'kal') : f.reverseWhen === 0 ? (lang.startsWith('en') ? 'today' : 'aaj') : '' }, { card: { kind: 'error' } })
      target = rows[0]; more = rows.length - 1
    } else if (f.reverseId) {
      const e = L.entryById(db, shopId, f.reverseId)
      target = ok(e) ? e : null
    } else {
      const last = ctx.lastTxnId && L.entryById(db, shopId, ctx.lastTxnId)
      target = ok(last) ? last : L.lastReversible(db, shopId)
    }
    if (!target) return finish('reverse_none')
    ctx.pending = { kind: 'reversal', id: randomUUID(), txnId: target.id, more }
    return prompt()
  }

  function shopTotal() {
    const owing = customers.map((c) => bal(c.id)).filter((b) => b > 0)
    const total = owing.reduce((s, b) => s + b, 0)
    return finish('total', { total, count: owing.length }, { card: { kind: 'total', total_paise: total, count: owing.length } })
  }

  function answerBalance(f) {
    let c = null
    if (!f.nameRef) {
      if (f.wantsTotal && (!f.contextual || !ctx.customerId)) return shopTotal() // "total batao" = everyone; "ab total batao" = this customer
      c = ctx.customerId ? customers.find((x) => x.id === ctx.customerId) : null
      if (!c) { ctx.pending = { kind: 'balance', id: randomUUID() }; return prompt() }
    } else if (f.nameRef.status === 'new') {
      return finish('not_found', { name: f.nameRef.name }, { card: { kind: 'error' } })
    } else if (f.nameRef.status === 'match') c = f.nameRef.customer
    else { // ambiguous or only plausible: never guess whose balance to read out
      ctx.pending = { kind: 'balance', id: randomUUID(), candidates: f.nameRef.candidates.map((x) => ({ id: x.id, name: x.name })).sort(byName) }
      return prompt()
    }
    ctx.customerId = c.id
    const b = bal(c.id)
    return finish('balance', { name: c.name, balance: b }, { card: { kind: 'balance', customer: { id: c.id, name: c.name }, balance_paise: b } })
  }

  // Reports and briefings: every figure comes from database queries (answers.js), the wording from say.js.
  function reportReply(rep) {
    const a = answer(db, shopId, rep, now)
    return finish(a.key, a.vars, { card: a.card })
  }
  const answerSummary = () => reportReply({ kind: 'daily' })

  // ---------------- payment commitments and reminders ----------------
  const today = istYmd(now), nowHm = istHm(now)
  const openOf = (cid) => F.listCommitments(db, shopId, { now }).filter((c) => c.customer_id === cid)
  const cLabel = (c) => `${label(c.due_date)}${c.due_time ? ` ${timeLabel(c.due_time)}` : ''}${c.amount_paise ? ` · ₹${rup(c.amount_paise)}` : ''}`

  // Merge what was just said about the date/time into the draft. A past date or time is refused and asked again, never moved silently.
  function applyWhen(p, w) {
    if (w.date) { p.date = w.date; p.dateOptions = null; p.rolled = !!w.rolled }
    else if (w.dateOptions) { p.date = null; p.dateOptions = w.dateOptions }
    if (w.time) { p.time = w.time; p.timeOptions = null }
    else if (w.timeOptions) { p.time = null; p.timeOptions = w.timeOptions }
    p.pastMsg = null
    if (p.date && p.date < today) { p.pastMsg = label(p.date); p.date = null }
    else if (p.date === today && p.time && p.time < nowHm) { p.pastMsg = `${label(p.date)} ${timeLabel(p.time)}`; p.date = null; p.time = null }
  }

  // What is still missing? One question at a time: customer, which reminder, date, time. null = ready to confirm.
  function fsettle(p) {
    if (!p.customerId) return 'customer'
    if (p.mode !== 'create' && !p.targetId) {
      const t = openOf(p.customerId)
      if (!t.length) { if (p.mode === 'reschedule') p.mode = 'create'; else return 'none' } // "Ramesh ka reminder kal kar do" with none yet: offer to create it
      else if (t.length === 1) p.targetId = t[0].id
      else { p.targets = t.map((c) => ({ id: c.id, label: cLabel(c) })); return 'target' }
    }
    if (p.mode === 'create' || p.mode === 'reschedule') {
      if (!p.date) return p.dateOptions ? 'dateopt' : 'date'
      if (p.timeOptions && !p.time) return 'timeopt'
    }
    return null
  }

  function fprompt(prefix = false) {
    const p = ctx.pending
    p.missing = fsettle(p)
    const name = p.customerId ? nameOf(p.customerId) : ''
    const ask = (key, v, extra) => { ctx.state = 'awaiting_clarification'; return out(key, v, extra) }
    if (p.missing === 'customer') return p.candidates ? choiceReply(p.candidates) : ask('clarify_name')
    if (p.missing === 'none') return finish('no_followup', { name })
    if (p.missing === 'target') return ask('ask_which_follow', { name }, { card: { kind: 'commitchoice', options: p.targets.map((t, i) => ({ id: i, name: t.label })) } })
    if (p.missing === 'date') { const r = ask('ask_date', { name }); return p.pastMsg ? { ...r, say: `${T(lang, 'date_past', { date: p.pastMsg })} ${r.say}` } : r }
    if (p.missing === 'dateopt') return ask('ask_option', {}, { card: { kind: 'optionchoice', field: 'date', options: p.dateOptions } })
    if (p.missing === 'timeopt') return ask('ask_option', {}, { card: { kind: 'optionchoice', field: 'time', options: p.timeOptions } })
    ctx.state = 'awaiting_confirmation'
    const target = p.targetId ? F.listCommitments(db, shopId, { now }).find((c) => c.id === p.targetId) : null
    const date = p.date ?? target?.due_date ?? null
    const v = { name, date: date ? label(date) : '', time: p.time ? timeLabel(p.time) : null, amount: p.amountPaise, priority: p.priority }
    const key = { create: 'confirm_follow', reschedule: 'confirm_resched', priority: 'confirm_priority', cancel: 'confirm_cancel_follow', complete: 'confirm_complete_follow' }[p.mode]
    const r = out(key, v, { card: { kind: 'followup', mode: p.mode, customer: { id: p.customerId, name }, date, time: p.time, amount_paise: p.amountPaise ?? target?.amount_paise ?? null, priority: p.priority ?? target?.priority ?? null, balance_paise: bal(p.customerId) } })
    return prefix ? { ...r, say: T(lang, 'understood') + r.say } : r
  }

  function startFollow(f, mode) {
    const p = { kind: 'follow', id: randomUUID(), mode, customerId: null, candidates: null, targetId: null, targets: null, date: null, dateOptions: null, rolled: false, time: null, timeOptions: null, pastMsg: null,
      amountPaise: f.amountPaise ?? null, priority: f.priority ?? (mode === 'create' ? 'medium' : null), said: f.said ?? null, linkLast: !!f.pronoun, missing: null }
    const ctxWord = f.pronoun || CONTEXT_WORDS.test(f.text ?? '')
    if (f.nameRef) {
      if (f.nameRef.status === 'new') return finish('not_found', { name: f.nameRef.name }, { card: { kind: 'error' } }) // never invent a customer for a reminder
      resolveName(p, f.nameRef)
      if (p.candidates) p.candidates = p.candidates.filter((c) => !c.isNew)
    } else if (mode !== 'create' && ctxWord && ctx.lastCommitmentId) { // "Isko high priority kar do" right after setting a reminder
      const c = F.listCommitments(db, shopId, { now }).find((x) => x.id === ctx.lastCommitmentId)
      if (c) { p.customerId = c.customer_id; p.targetId = c.id }
    }
    if (!p.customerId && !p.candidates && ctxWord && ctx.customerId) p.customerId = ctx.customerId // "Iski payment Friday ko due hai"
    applyWhen(p, f.when)
    ctx.pending = p
    return fprompt()
  }

  function commit() {
    const p = ctx.pending
    try {
      if (p.kind === 'reversal') {
        const r = L.reverseTxn(db, { shopId, txnId: p.txnId, key: p.id })
        ctx.customerId = r.txn.customer_id; ctx.lastTxnId = null
        const name = L.entryById(db, shopId, r.txn.id).customer_name
        return finish(r.duplicate ? 'duplicate' : 'reverse_done', { name, balance: r.balance_paise }, { changed: true, card: { kind: 'saved', reversal: true, customer: { id: r.txn.customer_id, name }, balance_paise: r.balance_paise } })
      }
      if (p.kind === 'follow') {
        const name = nameOf(p.customerId)
        if (p.mode === 'create') {
          let txnId = null // link to the credit just recorded only when "iski/isko" was said and it is the same customer's live entry
          if (p.linkLast && ctx.lastTxnId) {
            const e = L.entryById(db, shopId, ctx.lastTxnId)
            if (e && e.customer_id === p.customerId && e.type === 'credit' && !db.prepare('SELECT 1 FROM transactions WHERE reversed_of = ?').get(e.id)) txnId = e.id
          }
          const r = F.createCommitment(db, { shopId, customerId: p.customerId, dueDate: p.date, dueTime: p.time, amountPaise: p.amountPaise, priority: p.priority ?? 'medium', txnId, key: p.id, now })
          ctx.customerId = p.customerId; ctx.lastCommitmentId = r.commitment.id
          const v = { name, date: label(r.commitment.due_date), time: r.commitment.due_time ? timeLabel(r.commitment.due_time) : null }
          return finish(r.duplicate ? 'follow_duplicate' : 'follow_saved', v, { changed: !r.duplicate, card: { kind: 'saved', followup: true, customer: { id: p.customerId, name }, date_label: v.date, time_label: v.time, balance_paise: bal(p.customerId) } })
        }
        const c = p.mode === 'reschedule' ? F.updateCommitment(db, { shopId, id: p.targetId, dueDate: p.date, dueTime: p.time ?? null, now })
          : p.mode === 'priority' ? F.updateCommitment(db, { shopId, id: p.targetId, priority: p.priority, now })
            : F.closeCommitment(db, { shopId, id: p.targetId, status: p.mode === 'cancel' ? 'cancelled' : 'completed', now })
        ctx.customerId = c.customer_id; ctx.lastCommitmentId = p.mode === 'cancel' ? null : c.id
        const v = { name, date: label(c.due_date), time: c.due_time ? timeLabel(c.due_time) : null, priority: p.mode === 'priority' ? c.priority : null, late: p.mode === 'complete' && istYmd(now) > c.due_date }
        const key = { reschedule: 'follow_updated', priority: 'follow_updated', cancel: 'follow_cancelled', complete: 'follow_completed' }[p.mode]
        return finish(key, v, { changed: true, card: { kind: 'saved', followup: true, customer: { id: c.customer_id, name }, date_label: v.date, balance_paise: bal(c.customer_id) } })
      }
      if (p.kind === 'customer') {
        const r = L.createCustomer(db, { shopId, name: p.newName, key: p.id })
        ctx.customerId = r.customer.id
        return finish(r.duplicate ? 'customer_exists' : 'customer_added', { name: r.customer.name }, { changed: !r.duplicate, card: { kind: 'saved', added: true, customer: r.customer, balance_paise: L.balanceOf(db, r.customer.id) } })
      }
      const r = L.commitEntry(db, { shopId, customerId: p.customerId, newName: p.newName, type: p.type, amountPaise: p.amountPaise, key: p.id, said: p.said })
      const cid = r.txn.customer_id
      const name = r.customer?.name ?? L.entryById(db, shopId, r.txn.id).customer_name
      ctx.customerId = cid; ctx.lastTxnId = r.txn.id
      const resp = finish(r.duplicate ? 'duplicate' : `done_${p.type}`, { name, amount: p.amountPaise, balance: r.balance_paise },
        { changed: !r.duplicate, card: { kind: 'saved', type: p.type, amount_paise: p.amountPaise, customer: { id: cid, name }, balance_paise: r.balance_paise, duplicate: r.duplicate } })
      // A payment that settles a specific reminder (balance cleared, or the promised amount covered): offer to complete it, never do it silently.
      if (!r.duplicate && p.type === 'payment') {
        const settles = openOf(cid).filter((c) => r.balance_paise <= 0 || (c.amount_paise && p.amountPaise >= c.amount_paise))
        if (settles.length === 1) {
          const c = settles[0]
          ctx.pending = { kind: 'follow', id: randomUUID(), mode: 'complete', customerId: cid, targetId: c.id, candidates: null, targets: null, date: null, dateOptions: null, time: null, timeOptions: null, pastMsg: null, amountPaise: null, priority: null, said: null, linkLast: false, missing: null }
          ctx.state = 'awaiting_confirmation'
          return { ...resp, say: resp.say + T(lang, 'complete_offer', { name, date: label(c.due_date) }), state: 'awaiting_confirmation', expect: 'confirm', card: { ...resp.card, offer: true } }
        }
      }
      return resp
    } catch (e) {
      // Never pretend it was saved. Keep the pending entry so a retry uses the same idempotency key.
      return { ...out('save_failed'), card: { kind: 'error', detail: e.message } }
    }
  }

  // ---------------- something is pending ----------------
  const p = ctx.pending
  if (p) {
    if (f.stale) { const r = prompt(); return { ...r, say: `${T(lang, 'stale')} ${r.say}` } }
    if (f.statusOnly) return prompt()
    if (f.specificReverse) { ctx.pending = null; return startReverse(f) }
    if (f.report) { const keep = ctx.pending; const a = reportReply(f.report); ctx.pending = keep; const re = prompt(); return { ...re, say: `${a.say} ${re.say}` } } // answer the question, then repeat the open one
    // A full new reminder command that names a different customer is a NEW draft (new id); "Nahi, Suresh" is a correction of the open one.
    const otherCustomer = f.nameRef && f.nameRef.status !== 'new' && !(f.nameRef.status === 'match' && f.nameRef.customer.id === p.customerId)
    const followCmd = f.cancelFollowUp || f.setPriority || f.followEdit || (f.isFollowUp && (p.kind !== 'follow' || otherCustomer))
    if (followCmd) { ctx.pending = null; return startFollow(f, f.cancelFollowUp ? 'cancel' : f.setPriority ? 'priority' : f.followEdit ? 'reschedule' : 'create') }
    if (f.isCancel || (f.isNo && f.amountPaise == null && !f.nameRef && !f.when.date && !f.when.dateOptions && !f.priority)) return cancel()
    if (f.isReverse) { ctx.pending = null; return startReverse(f) }
    const newCommand = (f.hasCredit || f.hasPayment) && f.nameRef && f.amountPaise != null && !f.isNo
    if (!newCommand) {
      if (p.kind === 'reversal') return f.isYes ? commit() : unclear()
      if (p.kind === 'follow') {
        const m = p.missing
        if (p.candidates) { // which customer? the draft (dates, priority) is kept, any chosen reminder is dropped
          if (!pickCandidate(p, f)) return unclear()
          p.candidates = null; p.targetId = null; p.targets = null
          return fprompt()
        }
        if (f.nameRef && f.nameRef.status !== 'new' && !(f.nameRef.status === 'match' && f.nameRef.customer.id === p.customerId)) { // a different customer is named: nothing silently follows them
          resolveName(p, f.nameRef); p.targetId = null; p.targets = null
          if (p.candidates) p.candidates = p.candidates.filter((c) => !c.isNew)
          return fprompt(true)
        }
        if (m === 'customer') return unclear()
        if (m === 'target') {
          if (f.chooseIdx == null || !p.targets[f.chooseIdx]) return unclear()
          p.targetId = p.targets[f.chooseIdx].id
          return fprompt()
        }
        if (m === 'date' || m === 'dateopt') {
          const v = f.chooseOption && isYmd(f.chooseOption) ? f.chooseOption : f.when.date
          if (v && (m === 'date' || p.dateOptions.some((o) => o.value === v))) { applyWhen(p, { date: v }); if (f.when.time || f.when.timeOptions) applyWhen(p, f.when); return fprompt() }
          if (f.when.dateOptions) { applyWhen(p, { dateOptions: f.when.dateOptions }); return fprompt() }
          return unclear()
        }
        if (m === 'timeopt') {
          const v = f.chooseOption && isHm(f.chooseOption) ? f.chooseOption : f.when.time ?? (f.when.daypart ? p.timeOptions[f.when.daypart === 'am' ? 0 : 1].value : null)
          if (v && p.timeOptions.some((o) => o.value === v)) { applyWhen(p, { time: v }); return fprompt() }
          return unclear()
        }
        if (f.isYes) return commit() // confirmation stage
        let changed = false // "nahi, Friday ko": adjust the draft and ask again
        if (f.when.date || f.when.dateOptions || f.when.time || f.when.timeOptions) { applyWhen(p, f.when); changed = true }
        if (f.priority && p.mode !== 'cancel' && p.mode !== 'complete') { p.priority = f.priority; changed = true }
        if (f.amountPaise != null && p.mode === 'create') { p.amountPaise = f.amountPaise; changed = true }
        return changed ? fprompt(true) : unclear()
      }
      if (p.kind === 'balance') {
        if (p.candidates && pickCandidate(p, f)) { const c = p.customerId; ctx.pending = null; return answerBalance({ nameRef: { status: 'match', customer: customers.find((x) => x.id === c) } }) }
        if (!p.candidates && f.nameRef) { ctx.pending = null; return answerBalance(f) }
        return unclear()
      }
      if (p.kind === 'customer') {
        if (p.candidates) {
          if (!pickCandidate(p, f)) return unclear()
          if (p.customerId) return finish('customer_exists', { name: nameOf(p.customerId) })
          return prompt()
        }
        return f.isYes ? commit() : unclear()
      }
      // ---- a transaction ----
      if (ctx.state === 'awaiting_confirmation') {
        if (f.isYes) return commit()
        let changed = false
        if (f.amountPaise != null) { p.amountPaise = f.amountPaise; changed = true }
        if (f.nameRef) { resolveName(p, f.nameRef); changed = true }
        if (changed) return badAmount(p) ? reAskAmount(p) : prompt(true)
        if (f.isBalance || f.isSummary) { const keep = ctx.pending; const a = f.isSummary ? answerSummary() : answerBalance(f); ctx.pending = keep; const re = prompt(); return { ...re, say: `${a.say} ${re.say}` } }
        return unclear()
      }
      // awaiting_clarification
      if (p.missing === 'customer') {
        if (p.candidates) { if (!pickCandidate(p, f)) return unclear() }
        else if (f.nameRef) resolveName(p, f.nameRef)
        else return unclear()
        if (f.amountPaise != null && p.amountPaise == null) p.amountPaise = f.amountPaise
        return badAmount(p) ? reAskAmount(p) : prompt()
      }
      if (p.missing === 'amount') {
        if (f.amountPaise == null) return out('clarify_amount', { name: p.customerId ? nameOf(p.customerId) : p.newName })
        p.amountPaise = f.amountPaise
        return badAmount(p) ? reAskAmount(p) : prompt()
      }
      if (p.missing === 'type') {
        const t = f.chooseType ?? (f.hasPayment && !f.weakPayment ? 'payment' : f.hasCredit ? 'credit' : null) // a bare "haan" does not pick a direction
        if (!t) return unclear()
        p.type = t
        return prompt()
      }
    }
    ctx.pending = null // a complete new command replaces the half-finished one
  }

  // ---------------- idle ----------------
  if (f.statusOnly) return { say: '', state: 'idle', expect: null, card: null }
  if (f.report) return reportReply(f.report)
  if (f.cancelFollowUp) return startFollow(f, 'cancel')
  if (f.setPriority) return startFollow(f, 'priority')
  if (f.followEdit) return startFollow(f, 'reschedule')
  if (f.isFollowUp) return startFollow(f, 'create')
  if (f.isReverse) return startReverse(f)
  if (f.isSummary) return answerSummary()
  if (f.isAddCustomer) return startCustomer(f)
  if (f.hasCredit || f.hasPayment) return startTxn(f)
  if (f.isBalance) return answerBalance(f)
  if (f.isYes || f.isNo || f.isCancel) return finish('nothing_pending')
  return finish('unclear')
}
