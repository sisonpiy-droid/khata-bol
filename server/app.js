import 'dotenv/config'
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb, isPersistent } from './db.js'
import * as L from './ledger.js'
import { converse } from './dialog.js'
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
  if (process.env.RAILWAY_ENVIRONMENT || process.env.TRUST_PROXY) app.set('trust proxy', 1) // real client IP behind the platform proxy
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
    return { shop: L.getShop(db, shopId), stats: L.stats(db, shopId), customers: L.listCustomers(db, shopId), recent: L.history(db, shopId, { limit: 12 }), today: L.todaySummary(db, shopId) }
  })
  route('get', '/api/history', (req) => {
    const shopId = L.shopFor(db, sid(req))
    const c = req.query.customerId
    if (c !== undefined && !/^\d{1,12}$/.test(String(c))) throw bad('Invalid customer')
    return L.history(db, shopId, { customerId: c === undefined ? null : Number(c), limit: 100 }) // always filtered by this visitor's shop
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
