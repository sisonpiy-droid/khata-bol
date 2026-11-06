import { useEffect, useState } from 'react'

const KEY = 'khata.v1'
const uid = () => Math.random().toString(36).slice(2, 10)
const empty = { customers: [], txns: [], settings: { shop: '', upi: '' } }

function load() {
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY)) } } catch { return empty }
}

export const balanceOf = (txns, cid) =>
  txns.filter((t) => t.cid === cid).reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0)

function seedData() {
  const day = 864e5, now = Date.now()
  const people = [
    ['Ramesh', [[10, 'credit', 500], [6, 'credit', 350]]],
    ['Sunita', [[12, 'credit', 300], [3, 'payment', 300]]],
    ['Rameshwar', [[14, 'credit', 1200], [5, 'payment', 400]]],
    ['Abdul', [[8, 'credit', 150], [2, 'credit', 220]]],
    ['Lakshmi', [[9, 'credit', 250], [1, 'payment', 100]]],
  ]
  const d = { customers: [], txns: [] }
  for (const [name, ts] of people) {
    const id = uid()
    d.customers.push({ id, name, phone: '' })
    for (const [ago, type, amount] of ts) d.txns.push({ id: uid(), cid: id, type, amount, ts: now - ago * day })
  }
  return d
}

export function useLedger() {
  const [d, setD] = useState(load)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(d)) } catch {} }, [d])
  return {
    ...d,
    // list: [{cid|null, name, amount, type}]; cid null => create the customer (names repeated in one batch share it)
    addMany(list) {
      setD((p) => {
        const customers = [...p.customers], txns = [...p.txns]
        const byName = new Map(customers.map((c) => [c.name.toLowerCase(), c.id]))
        list.forEach((e, i) => {
          let id = e.cid || byName.get(e.name.toLowerCase())
          if (!id) { id = uid(); customers.push({ id, name: e.name, phone: '' }); byName.set(e.name.toLowerCase(), id) }
          txns.push({ id: uid(), cid: id, amount: e.amount, type: e.type, ts: Date.now() + i })
        })
        return { ...p, customers, txns }
      })
    },
    removeTxn: (id) => setD((p) => ({ ...p, txns: p.txns.filter((t) => t.id !== id) })),
    updateTxn: (id, patch) => setD((p) => ({ ...p, txns: p.txns.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    setSettings: (patch) => setD((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
    setPhone: (cid, phone) => setD((p) => ({ ...p, customers: p.customers.map((c) => (c.id === cid ? { ...c, phone } : c)) })),
    seed: () => setD((p) => ({ ...p, ...seedData() })),
  }
}
