// Calendar maths in the shop's timezone (Asia/Kolkata, no daylight saving) plus spoken date/time extraction.
// Dates are plain 'YYYY-MM-DD' strings computed with UTC arithmetic, so month and year boundaries are exact.
// Anything with two plausible meanings is returned as `options` for the user to choose: it is never guessed.
export const TZ = 'Asia/Kolkata'
const pad = (n) => String(n).padStart(2, '0')

export const istYmd = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
export const istHm = (d = new Date()) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
export const isHm = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
export const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay() // 0 = Sunday
export const dayStartIso = (ymd) => new Date(`${ymd}T00:00:00+05:30`).toISOString() // start of that local day, as UTC
export const dayEndIso = (ymd) => dayStartIso(addDays(ymd, 1)) // exclusive

// "Friday 5 December"
export function label(ymd) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(',', '')
}
// 9:30 -> "9:30 baje subah"
export function timeLabel(hm) {
  const [h, m] = hm.split(':').map(Number), h12 = h % 12 || 12
  const part = h < 12 ? 'subah' : h < 16 ? 'dopahar' : h < 19 ? 'shaam' : 'raat'
  return `${h12}${m ? `:${pad(m)}` : ''} baje ${part}`
}

// Day-of-month -> next real date on or after today. `rolled` means it was already past this month.
export function resolveDayOfMonth(today, dom, month = null) {
  const [ty, tm, td] = today.split('-').map(Number)
  const valid = (y, m) => isYmd(`${y}-${pad(m)}-${pad(dom)}`)
  if (month !== null) { // "5 december"
    for (const y of [ty, ty + 1]) if (valid(y, month + 1) && `${y}-${pad(month + 1)}-${pad(dom)}` >= today) return { ymd: `${y}-${pad(month + 1)}-${pad(dom)}`, rolled: y !== ty }
    return null
  }
  for (let i = 0; i < 13; i++) {
    const m0 = tm - 1 + i, y = ty + Math.floor(m0 / 12), m = (m0 % 12) + 1
    if (valid(y, m) && (i > 0 || dom >= td)) return { ymd: `${y}-${pad(m)}-${pad(dom)}`, rolled: i > 0 }
  }
  return null
}

const WEEKDAYS = { sunday: 0, sun: 0, ravivar: 0, itwar: 0, itvar: 0, monday: 1, mon: 1, somvar: 1, somwar: 1, tuesday: 2, tue: 2, tues: 2, mangalvar: 2, mangalwar: 2, wednesday: 3, wed: 3, budhvar: 3, budhwar: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, guruvar: 4, gurvar: 4, veervar: 4, virvar: 4, friday: 5, fri: 5, shukravar: 5, shukrawar: 5, saturday: 6, shanivar: 6, shaniwar: 6 }
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 }
const DAYPART = { subah: 'am', savere: 'am', morning: 'am', dopahar: 'noon', afternoon: 'noon', shaam: 'pm', sham: 'pm', evening: 'pm', raat: 'night', night: 'night' }
const NEXT = new Set(['agla', 'agle', 'next'])

/**
 * Pull the date and time out of normalised tokens.
 * -> { rest, date: {ymd, rolled}|null, dateOptions: [{value,label}]|null, time: 'HH:MM'|null, timeOptions|null, daypart }
 * `rest` has the consumed tokens removed so "5 tareekh" is never mistaken for 5 rupees.
 * numOf(token) -> number|null.  kalFuture: "kal" means tomorrow (reminders, due lists) rather than yesterday (what happened).
 */
export function extractWhen(tokens, now, { numOf = (t) => (/^\d+$/.test(t) ? Number(t) : null), kalFuture = true } = {}) {
  const today = istYmd(now), used = new Set(), out = { date: null, dateOptions: null, time: null, timeOptions: null, daypart: null }
  const opt = (ymd) => ({ value: ymd, label: label(ymd) })

  // ---- time: "subah nau baje", "9 baje", "saade paanch baje", "5 pm"
  const bi = tokens.findIndex((t) => ['baje', 'bje', 'am', 'pm', 'oclock'].includes(t))
  tokens.forEach((t, i) => { if (DAYPART[t]) { out.daypart ??= DAYPART[t]; used.add(i) } })
  if (bi > 0) {
    let hi = bi - 1, mins = 0
    const h = numOf(tokens[hi])
    if (h !== null && h >= 1 && h <= 24) {
      used.add(hi); used.add(bi)
      if (tokens[hi - 1] === 'saade' || tokens[hi - 1] === 'sade') { mins = 30; used.add(hi - 1) }
      else if (tokens[hi - 1] === 'sawa') { mins = 15; used.add(hi - 1) }
      const at = (hh) => `${pad(hh)}:${pad(mins)}`
      const mer = tokens[bi]
      if (mer === 'pm') out.time = at(h < 12 ? h + 12 : h)
      else if (mer === 'am') out.time = at(h === 12 ? 0 : h)
      else if (h >= 13) out.time = at(h % 24)
      else if (out.daypart === 'am') out.time = at(h === 12 ? 0 : h)
      else if (out.daypart === 'noon') out.time = at(h === 12 ? 12 : h <= 6 ? h + 12 : h)
      else if (out.daypart === 'pm') out.time = at(h === 12 ? 12 : h + 12)
      else if (out.daypart === 'night') out.time = at(h === 12 ? 0 : h >= 6 ? h + 12 : h)
      else out.timeOptions = [{ value: at(h === 12 ? 0 : h), label: `${h} baje subah (AM)` }, { value: at(h === 12 ? 12 : h + 12), label: `${h} baje shaam/raat (PM)` }]
    }
  } else if (bi === 0) used.add(0)

  // ---- date
  const dow = weekday(today)
  for (let i = 0; i < tokens.length && !out.date && !out.dateOptions; i++) {
    const t = tokens[i]
    if (t === 'aaj' || t === 'today') { out.date = { ymd: today }; used.add(i) }
    else if (t === 'tomorrow') { out.date = { ymd: addDays(today, 1) }; used.add(i) }
    else if (t === 'yesterday') { out.date = { ymd: addDays(today, -1) }; used.add(i) }
    else if (t === 'kal' || t === 'kl') { out.date = { ymd: addDays(today, kalFuture ? 1 : -1) }; used.add(i) }
    else if (t === 'parso' || t === 'parson') { out.date = { ymd: addDays(today, kalFuture ? 2 : -2) }; used.add(i) }
    else if (t in WEEKDAYS) {
      const w = WEEKDAYS[t], gap = (w - dow + 7) % 7, hasNext = NEXT.has(tokens[i - 1])
      used.add(i); if (hasNext) used.add(i - 1)
      if (hasNext) { const first = gap === 0 ? 7 : gap; out.dateOptions = [opt(addDays(today, first)), opt(addDays(today, first + 7))] } // "next Friday": this coming one or the one after?
      else if (gap === 0) out.dateOptions = [opt(today), opt(addDays(today, 7))] // it is Friday and they said Friday
      else out.date = { ymd: addDays(today, gap) }
    } else if (t in MONTHS && i > 0 && numOf(tokens[i - 1]) >= 1 && numOf(tokens[i - 1]) <= 31) { // "5 december"
      const r = resolveDayOfMonth(today, numOf(tokens[i - 1]), MONTHS[t])
      used.add(i); used.add(i - 1)
      if (r) out.date = r
    } else if ((t === 'tareekh' || t === 'tarikh' || t === 'date') && i > 0 && numOf(tokens[i - 1]) >= 1 && numOf(tokens[i - 1]) <= 31) { // "paanch tareekh"
      const r = resolveDayOfMonth(today, numOf(tokens[i - 1]))
      used.add(i); used.add(i - 1)
      if (r) out.date = r
    }
  }
  return { rest: tokens.filter((_, i) => !used.has(i)), ...out }
}
