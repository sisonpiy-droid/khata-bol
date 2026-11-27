import test from 'node:test'
import assert from 'node:assert/strict'
import { reduce, initial } from '../src/lib/machine.js'

test('voice machine: legal path and ignored illegal events', () => {
  let s = initial
  s = reduce(s, { type: 'LISTEN' }); assert.equal(s.name, 'listening')
  s = reduce(s, { type: 'HEARD' }); assert.equal(s.name, 'processing')
  s = reduce(s, { type: 'REPLY', next: 'awaiting_confirmation' }); assert.equal(s.name, 'speaking')
  s = reduce(s, { type: 'LISTEN' }); assert.equal(s.name, 'speaking') // cannot listen while speaking: no self-transcription
  s = reduce(s, { type: 'SPOKEN' }); assert.equal(s.name, 'awaiting_confirmation')
  s = reduce(s, { type: 'CONFIRM' }); assert.equal(s.name, 'saving')
  s = reduce(s, { type: 'REPLY', next: 'idle' }); s = reduce(s, { type: 'SPOKEN' }); assert.equal(s.name, 'idle')
  s = reduce(s, { type: 'HEARD' }); assert.equal(s.name, 'idle') // nothing was listening
  s = reduce(s, { type: 'FAIL' }); assert.equal(s.name, 'idle')
})
