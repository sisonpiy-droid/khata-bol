import assert from 'node:assert/strict'
import { matchCustomer } from '../server/match.js'

const cs = [{ name: 'Ramesh' }, { name: 'Rameshwar' }, { name: 'Sunita' }, { name: 'Abdul' }]
assert.equal(matchCustomer('ramesh', cs).customer.name, 'Ramesh') // exact beats prefix
assert.equal(matchCustomer('Sunitha', cs).customer.name, 'Sunita') // spelling drift
assert.equal(matchCustomer('Rameshwr', cs).status, 'ambiguous') // two close
assert.equal(matchCustomer('Kiran', cs).status, 'new')
assert.equal(matchCustomer('Sunil', cs).status, 'maybe') // plausible, not confident: the user must choose or say it is new
assert.equal(matchCustomer('Kiran', cs).status, 'new')
console.log('match ok')
