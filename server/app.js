import 'dotenv/config'
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import * as L from './ledger.js'
import { converse } from './dialog.js'
import { aiConfigured, sttConfigured, transcribe } from './llm.js'

export function createApp(db = openDb()) {
  L.ensureDemo(db)
  const app = express()
  app.use(express.json({ limit: '8mb' }))
  const route = (method, path, fn) =>
    app[method](path, async (req, res) => {
      try { res.json(await fn(req)) }
      catch (e) {
        const status = e instanceof L.LedgerError ? { not_found: 404, forbidden: 403, conflict: 409 }[e.code] ?? 400 : e.status || 500
        res.status(status).json({ error: e.message })
      }
    })

  route('get', '/api/config', () => ({
    shop: L.getShop(db).name, demo: !!L.getShop(db).is_demo,
    ai: aiConfigured(), stt: sttConfigured(), // the UI shows "AI enhancement not configured" when ai is false
  }))
  route('get', '/api/state', () => ({
    shop: L.getShop(db), stats: L.stats(db), customers: L.listCustomers(db), recent: L.history(db, { limit: 12 }), today: L.todaySummary(db),
  }))
  route('get', '/api/history', (req) => L.history(db, { customerId: req.query.customerId ? Number(req.query.customerId) : null, limit: 100 }))
  route('post', '/api/converse', (req) => converse(db, req.body ?? {}))
  route('post', '/api/transcribe', (req) => transcribe(req.body?.audio))
  route('post', '/api/reset-demo', () => { L.resetDemo(db); return { ok: true } })

  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  if (existsSync(dist)) { // Docker / single-process deploys serve the built frontend too
    app.use(express.static(dist))
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dist}/index.html`))
  }
  return app
}
