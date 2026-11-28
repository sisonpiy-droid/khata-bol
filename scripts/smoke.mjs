// End-to-end smoke test against any running Khata Bol (local, Docker or hosted).
//   node scripts/smoke.mjs                       -> http://localhost:8787
//   node scripts/smoke.mjs https://your.app.url  -> the hosted demo
// It uses a throwaway session, walks the demo story through the real API, and exits non-zero on the first failure.
// It never touches anyone else's data: every call is scoped to the random session id below.
const base = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const session = `smoke-${Math.random().toString(36).slice(2, 12)}`
let n = 0

async function call(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-session': session },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status} ${text.slice(0, 120)}`)
  if (json === null) throw new Error(`${method} ${path} did not return JSON (is this the API?)`)
  return json
}
const say = (text, extra = {}) => call('POST', '/api/converse', { text, lang: 'hi-IN', reply: 'hi-IN', ...extra })
const check = (name, ok, detail = '') => {
  n++
  if (!ok) { console.error(`FAIL ${n}. ${name} ${detail}`); process.exit(1) }
  console.log(`ok   ${n}. ${name}`)
}

const health = await call('GET', '/health')
check('server is healthy', health.ok === true)

const state0 = await call('GET', '/api/state')
check('sample shop loads with customers', state0.customers.length > 0)

let r = await say('Ramesh ko paanch sau rupaye udhaar diye')
check('credit entry asks for confirmation (nothing saved yet)', r.state === 'awaiting_confirmation' && !!r.pid, JSON.stringify(r).slice(0, 160))
const before = (await call('GET', '/api/state')).customers.find((c) => c.name === 'Ramesh').balance_paise
r = await call('POST', '/api/converse', { action: 'confirm', pid: r.pid, lang: 'hi-IN', reply: 'hi-IN' })
const after = (await call('GET', '/api/state')).customers.find((c) => c.name === 'Ramesh').balance_paise
check('confirm saves exactly Rs 500', after - before === 50000, `before ${before} after ${after}`)

r = await say('Ramesh ne 200 diye')
check('"Ramesh ne 200 diye" asks credit-or-payment instead of guessing', r.state !== 'idle' && /udhaar|payment|mili|diya/i.test(r.say), r.say)
await call('POST', '/api/converse', { action: 'cancel', lang: 'hi-IN', reply: 'hi-IN' })
const afterCancel = (await call('GET', '/api/state')).customers.find((c) => c.name === 'Ramesh').balance_paise
check('cancelling saves nothing', afterCancel === after)

r = await say('Ramesh ka kitna baaki hai?')
check('balance answer comes from the ledger', /500|baaki|balance/i.test(r.say), r.say)

r = await say('Aaj ka hisaab batao')
check('daily summary is spoken', typeof r.say === 'string' && r.say.length > 10, r.say)

const daily = await call('GET', '/api/reports/daily')
check('daily report has real numbers', daily.credit_paise >= 50000 && Number.isInteger(daily.outstanding_paise))
const weekly = await call('GET', '/api/reports/weekly')
check('weekly report loads', weekly.kind === 'weekly' && Array.isArray(weekly.top_customers))

const fu = await call('GET', '/api/followups?status=open&sort=priority')
check('reminders list loads', Array.isArray(fu))

const other = await fetch(base + '/api/state', { headers: { 'x-session': 'smoke-other-visitor' } }).then((x) => x.json())
check('another session cannot see this session\'s entry', other.customers.find((c) => c.name === 'Ramesh')?.balance_paise !== after)

console.log(`\nAll ${n} checks passed against ${base}`)
