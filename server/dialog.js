// The conversation state machine. Server-side, explicit, and stored in the database, never "remembered by the model".
//   idle -> awaiting_clarification (name/amount missing or ambiguous) -> awaiting_confirmation -> idle
// Money only moves in commit(), after an explicit yes, with an idempotency key fixed when the entry was first understood.
import { randomUUID } from 'node:crypto'
import * as L from './ledger.js'
import { parse } from './nlu.js'
import { matchCustomer, score } from './match.js'
import { aiParse, aiConfigured } from './llm.js'
import { say as T } from './say.js'

const fresh = () => ({ state: 'idle', customerId: null, lastTxnId: null, pending: null })
const CONTEXT_WORDS = /\b(ab|abhi|unhone|usne|woh|wo|same|him|her|them)\b/
const MIN_PAISE = 100
const BIG_PAISE = 500000 // Rs 5,000: ask the shopkeeper to double-check
const PENDING_TTL = 5 * 60 * 1000 // an unanswered question is dropped, never confirmed late

function loadCtx(db, id) {
  const row = db.prepare('SELECT ctx FROM conversations WHERE id = ?').get(id)
  return row ? JSON.parse(row.ctx) : fresh()
}
const saveCtx = (db, id, ctx) =>
  db.prepare('INSERT OR REPLACE INTO conversations (id, ctx, updated_at) VALUES (?, ?, ?)').run(id, JSON.stringify(ctx), new Date().toISOString())

const blank = { isYes: false, isNo: false, isCancel: false, isBalance: false, isSummary: false, isReverse: false, hasCredit: false, hasPayment: false, amountPaise: null, nameRef: null, recognised: true }

export async function converse(db, { session, text = '', action = null, choice = null, txnId = null, lang = 'hi-IN', reply: replyLang = null }) {
  const tl = replyLang || lang // language the answer is written in (the client picks one it can speak)
  if (!/^[\w-]{8,64}$/.test(String(session))) throw new L.LedgerError('Invalid session')
  const shopId = L.shopFor(db, session) // each visitor session has its own private shop
  const ctx = loadCtx(db, session)
  let expired = false
  if (ctx.pending && Date.now() - (ctx.at ?? 0) > PENDING_TTL) { ctx.pending = null; ctx.state = 'idle'; expired = true }
  const customers = L.listCustomers(db, shopId)
  if (action === 'greet') return { say: T(tl, 'greet'), state: ctx.state, expect: null, card: null }

  let f
  if (action === 'confirm') f = { ...blank, isYes: true }
  else if (action === 'cancel') f = { ...blank, isCancel: true }
  else if (action === 'choose') f = { ...blank, nameRef: { status: 'match', customer: customers.find((c) => c.id === Number(choice)) } }
  else if (action === 'reverse') { ctx.pending = null; ctx.state = 'idle'; f = { ...blank, isReverse: true, reverseId: txnId } }
  else {
    f = parse(String(text).slice(0, 500), customers)
    if (!f.recognised || (!f.hasCredit && !f.hasPayment && !f.isBalance && !f.isSummary && !f.isReverse && !f.isYes && !f.isNo && !f.isCancel && ctx.state === 'idle')) {
      const ai = await aiParse(text)
      if (ai) f = fromAi(ai, customers)
      else if (!f.recognised && !/^(hi|en)/.test(lang) && !aiConfigured())
        return { say: T(tl, 'ai_needed'), state: ctx.state, expect: ctx.state === 'idle' ? null : 'clarify', card: { kind: 'error' } }
    }
  }
  if (f.nameRef?.status === 'match' && !f.nameRef.customer) f.nameRef = null // stale choice id
  const reply = expired && f.isYes && !f.hasCredit && !f.hasPayment
    ? { say: T(tl, 'expired'), state: 'idle', expect: null, card: { kind: 'cancelled' } }
    : step(db, ctx, f, tl, customers, shopId)
  if (ctx.pending) ctx.at = Date.now()
  saveCtx(db, session, ctx)
  return reply
}

function fromAi(ai, customers) {
  const f = { ...blank, amountPaise: ai.amountPaise, nameRef: ai.customer ? matchCustomer(ai.customer, customers) : null }
  if (f.nameRef?.status === 'new') f.nameRef.name = ai.customer
  Object.assign(f, { hasCredit: ai.intent === 'credit', hasPayment: ai.intent === 'payment', isBalance: ai.intent === 'balance', isSummary: ai.intent === 'summary', isReverse: ai.intent === 'reverse' })
  return f
}

function step(db, ctx, f, lang, customers, shopId) {
  const out = (key, v, extra = {}) => ({ say: T(lang, key, v), state: ctx.state, expect: ctx.state === 'idle' ? null : ctx.state === 'awaiting_confirmation' ? 'confirm' : 'clarify', card: null, ...extra })
  const nameOf = (id) => customers.find((c) => c.id === id)?.name ?? L.entryById(db, shopId, ctx.lastTxnId)?.customer_name ?? ''

  const finish = (key, v, extra) => { ctx.state = 'idle'; ctx.pending = null; return out(key, v, extra) }
  const unclear = () => (ctx.pending ? { ...prompt(), say: `${T(lang, 'unclear')} ${prompt().say}` } : finish('unclear'))
  const cancel = () => finish('cancelled', {}, { card: { kind: 'cancelled' } })

  function resolveName(p, ref) {
    p.candidates = null
    if (ref.status === 'match') { p.customerId = ref.customer.id; p.newName = null }
    else if (ref.status === 'ambiguous') { p.customerId = null; p.newName = null; p.candidates = ref.candidates.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)) }
    else { p.customerId = null; p.newName = ref.name }
  }
  const settle = (p) => { p.missing = !p.customerId && !p.newName ? 'customer' : p.amountPaise == null ? 'amount' : null }
  const badAmount = (p) => {
    if (p.amountPaise != null && (p.amountPaise < MIN_PAISE || p.amountPaise > L.MAX_PAISE)) { p.amountPaise = null; return true }
    return false
  }

  const reAskAmount = (p) => { p.missing = 'amount'; ctx.state = 'awaiting_clarification'; return out('invalid_amount') }

  // Ask the next question for whatever is pending. Pure: only builds a reply.
  function prompt(prefix = false) {
    const p = ctx.pending
    if (p.kind === 'reversal') {
      ctx.state = 'awaiting_confirmation'
      const e = L.entryById(db, shopId, p.txnId)
      return out('reverse_ask', { name: e.customer_name, type: e.type, amount: e.amount_paise }, { card: { kind: 'reversal', entry: { customer_name: e.customer_name, type: e.type, amount_paise: e.amount_paise, ts: e.ts } } })
    }
    if (p.kind === 'balance') { ctx.state = 'awaiting_clarification'; return out('ask_customer_for_balance') }
    settle(p)
    if (p.missing === 'customer') {
      ctx.state = 'awaiting_clarification'
      return p.candidates
        ? out('clarify_customer', { names: p.candidates.map((c) => c.name) }, { card: { kind: 'choice', options: p.candidates, type: p.type, amount_paise: p.amountPaise } })
        : out('clarify_name')
    }
    const name = p.customerId ? nameOf(p.customerId) : p.newName
    if (p.missing === 'amount') { ctx.state = 'awaiting_clarification'; return out('clarify_amount', { name }) }
    ctx.state = 'awaiting_confirmation'
    const bal = p.customerId ? L.balanceOf(db, p.customerId) : 0
    const v = { name, amount: p.amountPaise, type: p.type, isNew: !p.customerId }
    const big = p.amountPaise >= BIG_PAISE
    const r = out(prefix ? 'corrected' : `confirm_${p.type}`, v, {
      card: { kind: 'pending', type: p.type, amount_paise: p.amountPaise, large: big, customer: { id: p.customerId, name, isNew: !p.customerId, balance_paise: bal }, after_paise: bal + (p.type === 'credit' ? p.amountPaise : -p.amountPaise) },
    })
    return big ? { ...r, say: r.say + T(lang, 'large_amount') } : r
  }

  function startTxn(f) {
    const p = { kind: 'txn', id: randomUUID(), type: f.hasPayment ? 'payment' : 'credit', amountPaise: f.amountPaise, customerId: null, newName: null, candidates: null, missing: null }
    if (f.nameRef) resolveName(p, f.nameRef)
    else if (ctx.customerId && CONTEXT_WORDS.test(f.text ?? '')) p.customerId = ctx.customerId
    ctx.pending = p
    if (badAmount(p)) return reAskAmount(p)
    return prompt()
  }

  function startReverse(f) {
    const ok = (e) => e && e.type !== 'reversal' && !db.prepare('SELECT 1 FROM transactions WHERE reversed_of = ?').get(e.id)
    const asked = f.reverseId ? L.entryById(db, shopId, f.reverseId) : null
    const target = f.reverseId ? (ok(asked) ? asked : null) : (ok(ctx.lastTxnId && L.entryById(db, shopId, ctx.lastTxnId)) ? L.entryById(db, shopId, ctx.lastTxnId) : L.lastReversible(db, shopId))
    if (!target) return finish('reverse_none')
    ctx.pending = { kind: 'reversal', id: randomUUID(), txnId: target.id }
    return prompt()
  }

  function answerBalance(f) {
    let c = null
    if (f.nameRef) {
      if (f.nameRef.status === 'new') return finish('not_found', { name: f.nameRef.name }, { card: { kind: 'error' } })
      c = f.nameRef.status === 'match' ? f.nameRef.customer : null
      if (!c) { // ambiguous: ask, keep the question
        ctx.pending = { kind: 'balance', candidates: f.nameRef.candidates.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)) }
        ctx.state = 'awaiting_clarification'
        return out('clarify_customer', { names: ctx.pending.candidates.map((x) => x.name) }, { card: { kind: 'choice', options: ctx.pending.candidates } })
      }
    } else if (ctx.customerId) c = customers.find((x) => x.id === ctx.customerId)
    if (!c) { ctx.pending = { kind: 'balance' }; ctx.state = 'awaiting_clarification'; return out('ask_customer_for_balance') }
    ctx.customerId = c.id
    const b = L.balanceOf(db, c.id)
    return finish('balance', { name: c.name, balance: b }, { card: { kind: 'balance', customer: { id: c.id, name: c.name }, balance_paise: b } })
  }

  function answerSummary() {
    const s = L.todaySummary(db, shopId)
    return finish('summary', { credit: s.credit_paise, payment: s.payment_paise, count: s.count }, { card: { kind: 'summary', ...s } })
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
      const r = L.commitEntry(db, { shopId, customerId: p.customerId, newName: p.newName, type: p.type, amountPaise: p.amountPaise, key: p.id })
      const cid = r.txn.customer_id
      const name = r.customer?.name ?? L.entryById(db, shopId, r.txn.id).customer_name
      ctx.customerId = cid; ctx.lastTxnId = r.txn.id
      return finish(r.duplicate ? 'duplicate' : `done_${p.type}`, { name, amount: p.amountPaise, balance: r.balance_paise },
        { changed: !r.duplicate, card: { kind: 'saved', type: p.type, amount_paise: p.amountPaise, customer: { id: cid, name }, balance_paise: r.balance_paise, duplicate: r.duplicate } })
    } catch (e) {
      // Never pretend it was saved. Keep the pending entry so a retry uses the same idempotency key.
      return { ...out('save_failed'), card: { kind: 'error', detail: e.message } }
    }
  }

  // ---------------- something is pending ----------------
  const p = ctx.pending
  if (p) {
    if (f.isCancel || (f.isNo && f.amountPaise == null && !f.nameRef)) return cancel()
    if (f.isReverse) { ctx.pending = null; return startReverse(f) }
    const newCommand = (f.hasCredit || f.hasPayment) && f.nameRef && f.amountPaise != null
    if (!newCommand) {
      if (p.kind === 'reversal') return f.isYes ? commit() : unclear()
      if (p.kind === 'balance') {
        if (f.nameRef) { ctx.pending = null; return answerBalance(f) }
        return unclear()
      }
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
        if (p.candidates) {
          const best = (f.tokens ?? f.text?.split(' ') ?? []).flatMap((t) => p.candidates.map((c) => ({ c, s: score(t, c.name) }))).sort((a, b) => b.s - a.s)
          const top = best[0], second = best.find((x) => x.c.id !== top?.c.id)
          if (f.nameRef?.status === 'match' && p.candidates.some((c) => c.id === f.nameRef.customer.id)) resolveName(p, f.nameRef)
          else if (top && top.s >= 0.6 && (!second || top.s > second.s)) { p.customerId = top.c.id; p.candidates = null }
          else return unclear()
        } else if (f.nameRef) resolveName(p, f.nameRef)
        else return unclear()
        if (f.amountPaise != null && p.amountPaise == null) p.amountPaise = f.amountPaise
        return badAmount(p) ? reAskAmount(p) : prompt()
      }
      if (p.missing === 'amount') {
        if (f.amountPaise == null) return out('clarify_amount', { name: p.customerId ? nameOf(p.customerId) : p.newName })
        p.amountPaise = f.amountPaise
        return badAmount(p) ? reAskAmount(p) : prompt()
      }
    }
    ctx.pending = null // a complete new command replaces the half-finished one
  }

  // ---------------- idle ----------------
  if (f.isReverse) return startReverse(f)
  if (f.isSummary) return answerSummary()
  if (f.hasCredit || f.hasPayment) return startTxn(f)
  if (f.isBalance) return answerBalance(f)
  if (f.isYes || f.isNo || f.isCancel) return finish('nothing_pending')
  return finish('unclear')
}
