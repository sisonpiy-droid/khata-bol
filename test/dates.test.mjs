import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, extractWhen, istYmd, isYmd, label, resolveDayOfMonth, timeLabel, weekday, dayStartIso } from '../server/dates.js'

// Fixed clock: Wednesday 31 December 2025, 23:30 India time (= 18:00 UTC), right on a year boundary.
const NOW = new Date('2025-12-31T18:00:00Z')
const numOf = (t) => ({ ek: 1, nau: 9, paanch: 5, panch: 5, do: 2, char: 4 }[t] ?? (/^\d+$/.test(t) ? Number(t) : null))
const when = (s, o = {}) => extractWhen(s.split(' '), NOW, { numOf, ...o })

test('shop-local day boundaries: 23:30 IST is still Dec 31, 00:10 IST is already Jan 1', () => {
  assert.equal(istYmd(NOW), '2025-12-31')
  assert.equal(istYmd(new Date('2025-12-31T18:40:00Z')), '2026-01-01') // 00:10 IST next day
  assert.equal(dayStartIso('2026-01-01'), '2025-12-31T18:30:00.000Z')
})

test('addDays crosses months, years and leap days exactly', () => {
  assert.equal(addDays('2025-12-31', 1), '2026-01-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addDays('2025-02-28', 1), '2025-03-01')
  assert.equal(addDays('2025-03-31', 30), '2025-04-30')
  assert.equal(weekday('2025-12-31'), 3) // Wednesday
  assert.ok(isYmd('2024-02-29') && !isYmd('2025-02-29') && !isYmd('2025-13-01') && !isYmd('tomorrow'))
})

test('relative words follow the tense: kal is tomorrow for reminders, yesterday for what happened', () => {
  assert.equal(when('kal payment').date.ymd, '2026-01-01')
  assert.equal(when('kal wale 300', { kalFuture: false }).date.ymd, '2025-12-30')
  assert.equal(when('parso').date.ymd, '2026-01-02')
  assert.equal(when('aaj').date.ymd, '2025-12-31')
})

test('"paanch tareekh" resolves to the next real 5th, across the year boundary', () => {
  const w = when('ramesh paanch tareekh tak')
  assert.equal(w.date.ymd, '2026-01-05')
  assert.equal(w.date.rolled, true)
  assert.deepEqual(w.rest, ['ramesh', 'tak']) // the date words are consumed: they cannot become an amount
  assert.equal(resolveDayOfMonth('2026-01-31', 31).ymd, '2026-01-31') // today counts
  assert.equal(resolveDayOfMonth('2026-02-10', 31).ymd, '2026-03-31') // February has no 31st
  assert.equal(resolveDayOfMonth('2026-03-05', 30, 1), null) // 30 February does not exist
  assert.equal(when('5 december').date.ymd, '2026-12-05')
})

test('weekdays: coming one is unambiguous; today-named and "next" ask which', () => {
  assert.equal(when('friday ko').date.ymd, '2026-01-02')
  assert.equal(when('shukravar tak').date.ymd, '2026-01-02')
  const today = when('wednesday ko') // today is Wednesday
  assert.equal(today.date, null)
  assert.deepEqual(today.dateOptions.map((o) => o.value), ['2025-12-31', '2026-01-07'])
  const next = when('next friday')
  assert.deepEqual(next.dateOptions.map((o) => o.value), ['2026-01-02', '2026-01-09']) // never guessed
  assert.equal(label('2026-01-02'), 'Friday 2 January')
})

test('times: dayparts decide AM/PM; a bare hour is ambiguous and asks', () => {
  assert.equal(when('kal subah nau baje').time, '09:00')
  assert.equal(when('shaam paanch baje').time, '17:00')
  assert.equal(when('raat nau baje').time, '21:00')
  assert.equal(when('dopahar do baje').time, '14:00')
  assert.equal(when('5 pm').time, '17:00')
  assert.equal(when('9 am').time, '09:00')
  assert.equal(when('saade nau baje subah').time, '09:30')
  const bare = when('nau baje')
  assert.equal(bare.time, null)
  assert.deepEqual(bare.timeOptions.map((o) => o.value), ['09:00', '21:00'])
  assert.equal(timeLabel('09:00'), '9 baje subah')
  assert.equal(timeLabel('17:30'), '5:30 baje shaam')
})

test('"Kal subah nau baje" keeps date and time together and removes both from the leftovers', () => {
  const w = when('kal subah nau baje suresh ka reminder')
  assert.deepEqual([w.date.ymd, w.time], ['2026-01-01', '09:00'])
  assert.deepEqual(w.rest, ['suresh', 'ka', 'reminder'])
})
