import 'dotenv/config'
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb, isPersistent } from './db.js'
import * as L from './ledger.js'
import { converse, clock } from './dialog.js'
import * as F from './follow.js'
import { dailyReport, weeklyReport } from './reports.js'
import { isYmd } from './dates.js'
import { aiConfigured, sttConfigured, transcribe } from './llm.js'

const STATUS = { not_found: 404, forbidden: 403, conflict: 409, busy: 503 }
// Anonymous demo sessions, not accounts: limits keep one visitor from hogging the server or the optional AI quota.
const PER_SESSION = Number(process.env.KHATA_RATE_PER_MIN) || 120
const PER_IP = PER_SESSION * 5
const PER_SESSION_AUDIO = 20

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

function limiter(max) {
  const hits = new Map()
  setInterval(() => hits.clear(), 60_000).unref()
  return (key) => { const n = (hits.get(key) ?? 0) + 1; hits.set(key, n); return n <= max }
}

export function createApp(db = openDb()) {
  const app = express()
  app.disable('x-powered-by')
  if (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL || process.env.TRUST_PROXY) app.set('trust proxy', 1) // real client IP behind the platform proxy
  app.use((_req, res, next) => {
    res.set({ 'Permissions-Policy': 'microphone=(self)', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP })
    next()
  })
  app.use('/api/transcribe', express.json({ limit: '8mb' })) // audio is transcribed and discarded, never stored
  app.use(express.json({ limit: '16kb' }))

  // Deploy readiness: proves the process is up and the database answers.
  const health = (_req, res) => {
    try { db.prepare('SELECT 1').get(); res.json({ ok: true, persistent: isPersistent() }) }
    catch { res.status(503).json({ ok: false }) }
  }
  app.get('/health', health)
  app.get('/api/health', health)

  // Each visitor's browser keeps a random session id; it selects that visitor's private demo shop.
  const sid = (req) => String(req.get('x-session') ?? req.body?.session ?? '')
  const okSession = (id) => /^[\w-]{8,64}$/.test(id)
  const perIp = limiter(PER_IP), perSession = limiter(PER_SESSION), perAudio = limiter(PER_SESSION_AUDIO)
  app.use('/api', (req, res, next) => {
    const s = sid(req)
    if (!perIp(req.ip) || (okSession(s) && !perSession(s)) || (req.path === '/transcribe' && okSession(s) && !perAudio(s)))
      return res.status(429).json({ error: 'Too many requests. Please slow down for a minute.' })
    next()
  })

  const route = (method, path, fn) =>
    app[method](path, async (req, res) => {
      try { res.json(await fn(req)) }
      catch (e) {
        if (e instanceof L.LedgerError) return res.status(STATUS[e.code] ?? 400).json({ error: e.message })
        if (e.status) return res.status(e.status).json({ error: e.message })
        console.error(e)
        res.status(500).json({ error: 'Internal error' })
      }
    })
  const bad = (m) => Object.assign(new Error(m), { status: 400 })

  route('get', '/api/config', (req) => {
    const ai = aiConfigured(), stt = sttConfigured() // the UI shows "AI enhancement not configured" when ai is false
    const s = sid(req)
    const shop = s ? L.getShop(db, L.shopFor(db, s)) : null
    return { shop: shop?.name ?? 'Sharma Kirana Store', demo: shop ? !!shop.is_demo : true, ai, stt }
  })
  route('get', '/api/state', (req) => {
    const shopId = L.shopFor(db, sid(req))
    const report = dailyReport(db, shopId, clock.now())
    return { shop: L.getShop(db, shopId), stats: L.stats(db, shopId), customers: L.listCustomers(db, shopId), recent: L.history(db, shopId, { limit: 12 }), today: { credit_paise: report.credit_paise, payment_paise: report.payment_paise, count: report.entries }, report }
  })
  route('get', '/api/history', (req) => {
    const shopId = L.shopFor(db, sid(req))
    const c = req.query.customerId
    if (c !== undefined && !/^\d{1,12}$/.test(String(c))) throw bad('Invalid customer')
    return L.history(db, shopId, { customerId: c === undefined ? null : Number(c), limit: 100 }) // always filtered by this visitor's shop
  })

  // ---- reports (computed from stored rows on every call; nothing is cached or estimated)
  route('get', '/api/reports/daily', (req) => {
    const day = req.query.date
    if (day !== undefined && !isYmd(String(day))) throw bad('Invalid date')
    return dailyReport(db, L.shopFor(db, sid(req)), clock.now(), day === undefined ? null : String(day))
  })
  route('get', '/api/reports/weekly', (req) => weeklyReport(db, L.shopFor(db, sid(req)), clock.now()))

  // ---- payment commitments / reminders. Always scoped to the caller's own shop; they never touch balances.
  const ID = /^[\w-]{8,64}$/
  const num = (v) => (v === undefined || v === null ? null : Number.isInteger(v) ? v : (() => { throw bad('Amount must be a whole number of paise') })())
  const str = (v, max) => (v === undefined || v === null ? null : typeof v === 'string' && v.length <= max ? v : (() => { throw bad('Invalid text') })())
  const cid = (req) => { if (!ID.test(String(req.params.id))) throw bad('Invalid id'); return String(req.params.id) }
  route('get', '/api/followups', (req) => {
    const status = ['open', 'completed', 'cancelled', 'all'].includes(req.query.status) ? req.query.status : 'open'
    const sort = ['due', 'amount', 'priority'].includes(req.query.sort) ? req.query.sort : 'due'
    return F.listCommitments(db, L.shopFor(db, sid(req)), { status, sort, now: clock.now() })
  })
  route('post', '/api/followups', (req) => {
    const b = req.body ?? {}
    if (!ID.test(String(b.key))) throw bad('Missing key')
    if (!Number.isInteger(b.customerId)) throw bad('Choose a customer')
    return F.createCommitment(db, { shopId: L.shopFor(db, sid(req)), customerId: b.customerId, dueDate: String(b.dueDate), dueTime: str(b.dueTime, 5), amountPaise: num(b.amountPaise), priority: b.priority ?? 'medium', note: str(b.note, 200), key: String(b.key), now: clock.now() })
  })
  route('post', '/api/followups/:id/update', (req) => {
    const b = req.body ?? {}
    const patch = {}
    if (b.dueDate !== undefined) patch.dueDate = String(b.dueDate)
    if (b.dueTime !== undefined) patch.dueTime = str(b.dueTime, 5)
    if (b.priority !== undefined) patch.priority = String(b.priority)
    if (b.amountPaise !== undefined) patch.amountPaise = num(b.amountPaise)
    if (b.note !== undefined) patch.note = str(b.note, 200)
    return F.updateCommitment(db, { shopId: L.shopFor(db, sid(req)), id: cid(req), now: clock.now(), ...patch })
  })
  route('post', '/api/followups/:id/complete', (req) => F.closeCommitment(db, { shopId: L.shopFor(db, sid(req)), id: cid(req), status: 'completed', now: clock.now() }))
  route('post', '/api/followups/:id/cancel', (req) => F.closeCommitment(db, { shopId: L.shopFor(db, sid(req)), id: cid(req), status: 'cancelled', now: clock.now() }))
  route('get', '/api/followups/:id/history', (req) => F.commitmentHistory(db, L.shopFor(db, sid(req)), cid(req)))

  // ---- in-app notifications: the open app asks what is due and confirms delivery once. Nothing is sent while the app is closed.
  route('get', '/api/notifications/due', (req) => F.dueNotifications(db, L.shopFor(db, sid(req)), clock.now()))
  route('post', '/api/notifications/ack', (req) => {
    const b = req.body ?? {}
    if (!ID.test(String(b.commitmentId)) || typeof b.key !== 'string' || b.key.length > 40) throw bad('Invalid notification')
    return F.ackNotification(db, { shopId: L.shopFor(db, sid(req)), commitmentId: String(b.commitmentId), key: b.key, now: clock.now() })
  })
  route('post', '/api/converse', (req) => converse(db, { ...req.body, session: sid(req) }))
  route('post', '/api/transcribe', (req) => {
    if (!okSession(sid(req))) throw bad('Invalid session')
    return transcribe(req.body?.audio)
  })
  route('post', '/api/reset-demo', (req) => { L.resetDemo(db, L.shopFor(db, sid(req))); return { ok: true } }) // only this visitor's own shop

  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  if (existsSync(dist)) { // one process serves the built frontend and the API on the same domain
    app.use(express.static(dist))
    app.get(/^(?!\/api|\/health).*/, (_req, res) => res.sendFile(`${dist}/index.html`))
  }

  // Malformed or oversized bodies get a clean JSON error, never a stack trace.
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' })
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
    console.error(err)
    res.status(500).json({ error: 'Internal error' })
  })
  return app
}
