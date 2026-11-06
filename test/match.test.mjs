import assert from 'node:assert/strict'
import { matchCustomer } from '../src/lib/match.js'

const cs = [{ name: 'Ramesh' }, { name: 'Rameshwar' }, { name: 'Sunita' }, { name: 'Abdul' }]
assert.equal(matchCustomer('ramesh', cs).customer.name, 'Ramesh') // exact beats prefix
assert.equal(matchCustomer('Sunitha', cs).customer.name, 'Sunita') // spelling drift
assert.equal(matchCustomer('Rameshwr', cs).status, 'ambiguous') // two close
assert.equal(matchCustomer('Kiran', cs).status, 'new')
assert.equal(matchCustomer('Sunil', cs).status, 'new') // not Sunita
console.log('match ok')
