async function j(r) {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(j)

export const api = {
  config: () => fetch('/api/config').then(j),
  state: () => fetch('/api/state').then(j),
  history: (customerId) => fetch(`/api/history?customerId=${customerId}`).then(j),
  converse: (body) => post('/api/converse', body),
  resetDemo: () => post('/api/reset-demo'),
}
