import 'dotenv/config'
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb, isPersistent } from './db.js'
import * as L from './ledger.js'
import { converse } from './dialog.js'
import { aiConfigured, sttConfigured, transcribe } from './llm.js'

const STATUS = { not_found: 404, forbidden: 403, conflict: 409, busy: 503 }

export function createApp(db = openDb()) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.set({ 'Permissions-Policy': 'microphone=(self)', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
    next()
  })
  app.use(express.json({ limit: '8mb' }))

  // Deploy readiness: proves the process is up and the database answers.
  const health = (_req, res) => {
    try { db.prepare('SELECT 1').get(); res.json({ ok: true, persistent: isPersistent() }) }
    catch { res.status(503).json({ ok: false }) }
  }
  app.get('/health', health)
  app.get('/api/health', health)

  // Each visitor's browser keeps a random session id; it selects that visitor's private demo shop.
  const sid = (req) => String(req.get('x-session') ?? req.body?.session ?? '')
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
  route('get', '/api/history', (req) => L.history(db, L.shopFor(db, sid(req)), { customerId: req.query.customerId ? Number(req.query.customerId) : null, limit: 100 }))
  route('post', '/api/converse', (req) => converse(db, { ...req.body, session: sid(req) }))
  route('post', '/api/transcribe', (req) => transcribe(req.body?.audio))
  route('post', '/api/reset-demo', (req) => { L.resetDemo(db, L.shopFor(db, sid(req))); return { ok: true } })

  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  if (existsSync(dist)) { // one process serves the built frontend and the API on the same domain
    app.use(express.static(dist))
    app.get(/^(?!\/api|\/health).*/, (_req, res) => res.sendFile(`${dist}/index.html`))
  }
  return app
}
