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
