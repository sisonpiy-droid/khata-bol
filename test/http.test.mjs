import test from 'node:test'
import assert from 'node:assert/strict'

process.env.ANTHROPIC_API_KEY = '' // empty (not deleted) so dotenv cannot load a real key from .env
process.env.GEMINI_API_KEY = ''
process.env.KHATA_RATE_PER_MIN = '30' // the limiter reads this at load time
const { createApp } = await import('../server/app.js')
const { openDb } = await import('../server/db.js')
const L = await import('../server/ledger.js')

const A = 'visitor-http-aaaa', B = 'visitor-http-bbbb'

async function call(app, method, path, { session, body, raw } = {}) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(session ? { 'x-session': session } : {}) },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    })
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
  } finally { server.close() }
}

test('another visitor cannot read your customers or history, by id or by guessing', async () => {
  const db = openDb(':memory:'), app = createApp(db)
  const stateA = (await call(app, 'get', '/api/state', { session: A })).body
  const ramesh = stateA.customers.find((c) => c.name === 'Ramesh')
  assert.ok((await call(app, 'get', `/api/history?customerId=${ramesh.id}`, { session: A })).body.length > 0)
  const spy = await call(app, 'get', `/api/history?customerId=${ramesh.id}`, { session: B }) // B asks for A's customer id
  assert.deepEqual(spy.body, [])
  assert.equal((await call(app, 'get', '/api/history', { session: B })).body.some((h) => h.customer_id === ramesh.id), false)
  assert.equal((await call(app, 'get', '/api/state')).status, 400) // no session, no data
  assert.equal((await call(app, 'get', '/api/state', { session: 'short' })).status, 400)
})

test('reset only touches the caller\'s own shop', async () => {
  const db = openDb(':memory:'), app = createApp(db)
  await call(app, 'post', '/api/converse', { session: A, body: { text: 'Ramesh ko 500 rupaye udhaar diye' } })
  await call(app, 'post', '/api/converse', { session: A, body: { text: 'haan' } })
  await call(app, 'get', '/api/state', { session: B })
  await call(app, 'post', '/api/reset-demo', { session: B })
  const a = (await call(app, 'get', '/api/state', { session: A })).body
  assert.equal(a.customers.find((c) => c.name === 'Ramesh').balance_paise, 50000)
  assert.equal((await call(app, 'post', '/api/reset-demo')).status, 400)
})

test('bad input gets clean JSON errors, never a stack trace', async () => {
  const app = createApp(openDb(':memory:'))
  assert.deepEqual((await call(app, 'post', '/api/converse', { session: A, raw: '{oops' })).body, { error: 'Invalid JSON' })
  const big = await call(app, 'post', '/api/converse', { session: A, body: { text: 'x'.repeat(40_000) } })
  assert.equal(big.status, 413)
  assert.equal((await call(app, 'get', '/api/history?customerId=1%20OR%201=1', { session: A })).status, 400) // not an injection vector, not even accepted
  assert.equal((await call(app, 'post', '/api/converse', { session: A, body: { action: 'hack' } })).status, 400)
})

test('audio endpoint needs a session, and fails clearly without a key; headers are locked down', async () => {
  const app = createApp(openDb(':memory:'))
  assert.equal((await call(app, 'post', '/api/transcribe', { body: { audio: 'x' } })).status, 400)
  const r = await call(app, 'post', '/api/transcribe', { session: A, body: { audio: 'data:audio/webm;base64,AAAA' } })
  assert.equal(r.status, 501)
  const h = (await call(app, 'get', '/api/config', { session: A }))
  assert.equal(h.headers.get('x-powered-by'), null)
  assert.match(h.headers.get('content-security-policy'), /default-src 'self'/)
  assert.deepEqual(h.body, { shop: 'Sharma Kirana Store', demo: true, ai: false, stt: false }) // flags only, never a key
})

test('a visitor that hammers the API is rate-limited, others are not', async () => {
  const app = createApp(openDb(':memory:'))
  let limited = 0
  for (let i = 0; i < 40; i++) if ((await call(app, 'get', '/api/config', { session: A })).status === 429) limited++
  assert.ok(limited >= 5, `expected 429s, got ${limited}`)
  assert.equal((await call(app, 'get', '/api/config', { session: B })).status, 200)
  assert.equal((await call(app, 'get', '/health')).status, 200) // health checks are never limited
})

test('every SQL statement is parameterised (no string-built queries with user data)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  for (const f of readdirSync(new URL('../server/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(new URL(`../server/${f}`, import.meta.url), 'utf8')
    for (const m of src.matchAll(/prepare\(\s*`([^`]*)`/g)) assert.equal(/\$\{/.test(m[1]), false, `${f}: interpolated SQL`)
  }
  assert.ok(L)
})

// ---------------------------------------------------------------- reports and reminders over HTTP
const { istYmd, addDays } = await import('../server/dates.js')

test('report endpoints come from the database, validate input, and need a session', async () => {
  const app = createApp(openDb(':memory:'))
  const d = await call(app, 'get', '/api/reports/daily', { session: A })
  assert.equal(d.status, 200)
  assert.deepEqual([d.body.kind, d.body.date], ['daily', istYmd()])
  assert.ok(d.body.outstanding_paise > 0 && Array.isArray(d.body.due_today) && Array.isArray(d.body.overdue))
  const w = (await call(app, 'get', '/api/reports/weekly', { session: A })).body
  assert.equal(w.kind, 'weekly')
  assert.equal(w.to, istYmd()); assert.equal(w.from, addDays(istYmd(), -6))
  assert.equal((await call(app, 'get', '/api/reports/daily?date=2026-02-30', { session: A })).status, 400)
  assert.equal((await call(app, 'get', '/api/reports/daily?date=bad', { session: A })).status, 400)
  assert.equal((await call(app, 'get', '/api/reports/weekly')).status, 400)
  const st = (await call(app, 'get', '/api/state', { session: A })).body
  assert.equal(st.report.date, istYmd()) // Home shows the same report
})

test('reminder API: create, sort, update, complete, cancel with validation; closed ones are final', async () => {
  const app = createApp(openDb(':memory:'))
  const customers = (await call(app, 'get', '/api/state', { session: A })).body.customers
  const ramesh = customers.find((c) => c.name === 'Ramesh').id
  const due = addDays(istYmd(), 4)
  const make = (extra = {}) => call(app, 'post', '/api/followups', { session: A, body: { key: `key-${Math.random().toString(36).slice(2, 12)}`, customerId: ramesh, dueDate: due, ...extra } })
  const ok = await make({ priority: 'high', amountPaise: 150000 })
  assert.equal(ok.status, 200); assert.equal(ok.body.commitment.priority, 'high')
  assert.equal((await make()).body.duplicate, true) // same customer, same day
  assert.equal((await make({ dueDate: istYmd(new Date(Date.now() - 864e5 * 3)) })).status, 400) // past
  assert.equal((await make({ dueDate: addDays(due, 1), priority: 'urgent' })).status, 400)
  assert.equal((await make({ dueDate: addDays(due, 1), amountPaise: 1.5 })).status, 400)
  assert.equal((await make({ dueDate: addDays(due, 1), customerId: 999999 })).status, 404)
  assert.equal((await make({ dueDate: addDays(due, 1), customerId: 'x' })).status, 400)
  const id = ok.body.commitment.id
  const upd = await call(app, 'post', `/api/followups/${id}/update`, { session: A, body: { dueDate: addDays(due, 2), priority: 'low' } })
  assert.deepEqual([upd.body.due_date, upd.body.priority], [addDays(due, 2), 'low'])
  const list = (await call(app, 'get', '/api/followups?sort=priority', { session: A })).body
  assert.ok(list.some((c) => c.id === id && c.urgency === 'upcoming'))
  assert.equal((await call(app, 'post', `/api/followups/${id}/complete`, { session: A })).body.status, 'completed')
  assert.equal((await call(app, 'post', `/api/followups/${id}/cancel`, { session: A })).status, 409) // already completed
  assert.equal((await call(app, 'post', `/api/followups/${id}/update`, { session: A, body: { priority: 'high' } })).status, 409)
  const hist = (await call(app, 'get', `/api/followups/${id}/history`, { session: A })).body
  assert.deepEqual(hist.map((h) => h.event), ['created', 'rescheduled', 'priority', 'completed'])
  assert.equal((await call(app, 'post', '/api/followups/not-an-id!/cancel', { session: A })).status, 400)
})

test('another visitor cannot see, change or close your reminders, or your notifications', async () => {
  const app = createApp(openDb(':memory:'))
  const ramesh = (await call(app, 'get', '/api/state', { session: A })).body.customers.find((c) => c.name === 'Ramesh').id
  const id = (await call(app, 'post', '/api/followups', { session: A, body: { key: 'cross-session-key-1', customerId: ramesh, dueDate: addDays(istYmd(), 2) } })).body.commitment.id
  assert.equal((await call(app, 'get', '/api/followups', { session: B })).body.some((c) => c.id === id), false)
  for (const path of ['update', 'complete', 'cancel']) assert.equal((await call(app, 'post', `/api/followups/${id}/${path}`, { session: B, body: {} })).status, 404)
  assert.deepEqual((await call(app, 'get', `/api/followups/${id}/history`, { session: B })).body, [])
  // B cannot create a reminder for A's customer id
  assert.equal((await call(app, 'post', '/api/followups', { session: B, body: { key: 'cross-session-key-2', customerId: ramesh, dueDate: addDays(istYmd(), 2) } })).status, 404)
  assert.equal((await call(app, 'post', '/api/notifications/ack', { session: B, body: { commitmentId: id, key: `${addDays(istYmd(), 2)}T00:00` } })).body.ok, false)
  assert.equal((await call(app, 'get', '/api/followups', { session: A })).body.some((c) => c.id === id && c.status === 'open'), true) // untouched
})

test('notifications: only real, due items; delivery is recorded once', async () => {
  const app = createApp(openDb(':memory:'))
  const state = (await call(app, 'get', '/api/state', { session: A })).body
  const due = (await call(app, 'get', '/api/notifications/due', { session: A })).body
  // demo: Kavita is due today and owes money, Suresh is overdue and owes money; Rameshwar is upcoming (not due)
  assert.deepEqual(due.map((n) => n.customer_name).sort(), ['Kavita', 'Suresh'])
  const n = due[0]
  assert.deepEqual((await call(app, 'post', '/api/notifications/ack', { session: A, body: { commitmentId: n.id, key: n.fire_key } })).body, { ok: true, duplicate: false })
  assert.deepEqual((await call(app, 'post', '/api/notifications/ack', { session: A, body: { commitmentId: n.id, key: n.fire_key } })).body, { ok: true, duplicate: true })
  assert.equal((await call(app, 'get', '/api/notifications/due', { session: A })).body.length, 1)
  assert.equal((await call(app, 'post', '/api/notifications/ack', { session: A, body: { commitmentId: 'bad', key: 'x' } })).status, 400)
  assert.ok(state.report)
})
