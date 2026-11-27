// A random id kept in this browser selects the visitor's private demo shop on the server.
export const session = (() => {
  try {
    const k = localStorage.getItem('khata.session')
    if (k) return k
    const id = crypto.randomUUID()
    localStorage.setItem('khata.session', id)
    return id
  } catch { return `s-${Math.random().toString(36).slice(2, 14)}` }
})()

const H = { 'x-session': session }

async function j(r) {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}
const get = (url) => fetch(url, { headers: H }).then(j)
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify(body ?? {}) }).then(j)

export const api = {
  config: () => get('/api/config'),
  state: () => get('/api/state'),
  history: (customerId) => get(`/api/history?customerId=${customerId}`),
  converse: (body) => post('/api/converse', body),
  resetDemo: () => post('/api/reset-demo'),
}
