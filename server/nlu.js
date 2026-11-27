// Keyless, deterministic understanding of Hindi / Hinglish / English shop talk.
// Returns flags + an amount + a customer reference. It never touches the database.
import { matchCustomer, lev } from './match.js'
import { extractWhen } from './dates.js'

// Devanagari keywords map straight to roman; unknown Devanagari words (names) are transliterated.
const DEV = {
  'को': 'ko', 'ने': 'ne', 'का': 'ka', 'की': 'ki', 'के': 'ke', 'से': 'se', 'है': 'hai', 'हैं': 'hain', 'थी': 'thi', 'था': 'tha',
  'रुपये': 'rupaye', 'रुपए': 'rupaye', 'रूपये': 'rupaye', 'रुपया': 'rupaye', 'उधार': 'udhaar', 'वापस': 'wapas', 'दिए': 'diye', 'दिये': 'diye', 'दिया': 'diya', 'दी': 'di',
  'लिया': 'liya', 'लिए': 'liye', 'जमा': 'jama', 'कितना': 'kitna', 'कितने': 'kitne', 'कितनी': 'kitni', 'बाकी': 'baaki', 'बैलेंस': 'balance', 'बताओ': 'batao', 'बताइए': 'batao',
  'चेक': 'check', 'करो': 'karo', 'कर': 'kar', 'आज': 'aaj', 'हिसाब': 'hisaab', 'पिछली': 'pichhli', 'पिछला': 'pichhla', 'एंट्री': 'entry', 'गलत': 'galat', 'सही': 'sahi',
  'हाँ': 'haan', 'हां': 'haan', 'हा': 'haan', 'ठीक': 'theek', 'नहीं': 'nahi', 'नही': 'nahi', 'कैंसिल': 'cancel', 'रद्द': 'cancel', 'कस्टमर': 'customer', 'ग्राहक': 'customer',
  'सौ': 'sau', 'हज़ार': 'hazaar', 'हजार': 'hazaar', 'लाख': 'lakh', 'एक': 'ek', 'दो': 'do', 'तीन': 'teen', 'चार': 'chaar', 'पाँच': 'paanch', 'पांच': 'paanch', 'छह': 'chhe', 'छः': 'chhe',
  'सात': 'saat', 'आठ': 'aath', 'नौ': 'nau', 'दस': 'das', 'बीस': 'bees', 'पच्चीस': 'pachees', 'तीस': 'tees', 'चालीस': 'chalis', 'पचास': 'pachaas', 'साठ': 'saath', 'सत्तर': 'sattar', 'अस्सी': 'assi', 'नब्बे': 'nabbe',
  'ढाई': 'dhai', 'डेढ़': 'derh', 'डेढ': 'derh', 'साढ़े': 'saade', 'साढे': 'saade', 'सवा': 'sawa', 'और': 'aur', 'में': 'mein', 'मैं': 'main', 'ना': 'na',
  // Kannada basics (keyless). Unverified with native speakers; see README.
  'ಸಾಲ': 'udhaar', 'ಉಧಾರ': 'udhaar', 'ಬಾಕಿ': 'baaki', 'ಎಷ್ಟು': 'kitna', 'ಬ್ಯಾಲೆನ್ಸ್': 'balance', 'ಹೌದು': 'haan', 'ಸರಿ': 'sahi', 'ಇಲ್ಲ': 'nahi', 'ಬೇಡ': 'nahi', 'ರದ್ದು': 'cancel',
  'ರೂಪಾಯಿ': 'rupaye', 'ರೂಪಾಯಿಗಳು': 'rupaye', 'ರೂ': 'rupaye', 'ವಾಪಸ್': 'wapas', 'ಮರಳಿ': 'wapas', 'ಪಾವತಿ': 'payment', 'ಪಾವತಿಸಿದರು': 'payment',
  'ಕೊಟ್ಟೆ': 'diye', 'ಕೊಟ್ಟರು': 'diye', 'ಕೊಟ್ಟಿದ್ದಾರೆ': 'diye', 'ಗೆ': 'ko', 'ಅವರಿಗೆ': 'ko', 'ನಿಂದ': 'se', 'ಅವರು': '', 'ಇಂದು': 'aaj', 'ಇಂದಿನ': 'aaj', 'ಲೆಕ್ಕ': 'hisaab',
  'ಹಿಂದಿನ': 'pichhli', 'ಎಂಟ್ರಿ': 'entry', 'ತಪ್ಪು': 'galat', 'ಹೇಳಿ': 'batao', 'ಈಗ': 'ab', 'ಒಟ್ಟು': 'total',
  'ಒಂದು': 'ek', 'ಎರಡು': 'do', 'ಮೂರು': 'teen', 'ನಾಲ್ಕು': 'chaar', 'ಐದು': 'paanch', 'ಆರು': 'chhe', 'ಏಳು': 'saat', 'ಎಂಟು': 'aath', 'ಒಂಬತ್ತು': 'nau', 'ಹತ್ತು': 'das', 'ಇಪ್ಪತ್ತು': 'bees', 'ಮೂವತ್ತು': 'tees',
  'ನಲವತ್ತು': 'chalis', 'ಐವತ್ತು': 'pachaas', 'ಅರವತ್ತು': 'saath', 'ಎಪ್ಪತ್ತು': 'sattar', 'ಎಂಬತ್ತು': 'assi', 'ತೊಂಬತ್ತು': 'nabbe', 'ನೂರು': 'sau', 'ಇನ್ನೂರು': 'do sau', 'ಮುನ್ನೂರು': 'teen sau',
  'ನಾನೂರು': 'chaar sau', 'ನಾಲ್ನೂರು': 'chaar sau', 'ಐನೂರು': 'paanch sau', 'ಆರುನೂರು': 'chhe sau', 'ಸಾವಿರ': 'hazaar',
}


const C = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'q', 'ज़': 'z', 'ड़': 'r', 'फ़': 'f' }
const V = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' }
const M = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri', 'ॉ': 'o' }

// Indic word -> rough Latin for fuzzy name matching ("रमेश" -> "ramesh", "ರಮೇಶ್" -> "ramesh").
// Devanagari drops the inherent final "a"; Kannada keeps it.
const KC = { 'ಕ': 'k', 'ಖ': 'kh', 'ಗ': 'g', 'ಘ': 'gh', 'ಙ': 'ng', 'ಚ': 'ch', 'ಛ': 'chh', 'ಜ': 'j', 'ಝ': 'jh', 'ಞ': 'ny', 'ಟ': 't', 'ಠ': 'th', 'ಡ': 'd', 'ಢ': 'dh', 'ಣ': 'n', 'ತ': 't', 'ಥ': 'th', 'ದ': 'd', 'ಧ': 'dh', 'ನ': 'n', 'ಪ': 'p', 'ಫ': 'ph', 'ಬ': 'b', 'ಭ': 'bh', 'ಮ': 'm', 'ಯ': 'y', 'ರ': 'r', 'ಲ': 'l', 'ವ': 'v', 'ಶ': 'sh', 'ಷ': 'sh', 'ಸ': 's', 'ಹ': 'h', 'ಳ': 'l', 'ಱ': 'r' }
const KV = { 'ಅ': 'a', 'ಆ': 'aa', 'ಇ': 'i', 'ಈ': 'ee', 'ಉ': 'u', 'ಊ': 'oo', 'ಋ': 'ru', 'ಎ': 'e', 'ಏ': 'e', 'ಐ': 'ai', 'ಒ': 'o', 'ಓ': 'o', 'ಔ': 'au' }
const KM = { 'ಾ': 'aa', 'ಿ': 'i', 'ೀ': 'ee', 'ು': 'u', 'ೂ': 'oo', 'ೃ': 'ru', 'ೆ': 'e', 'ೇ': 'e', 'ೈ': 'ai', 'ೊ': 'o', 'ೋ': 'o', 'ೌ': 'au' }
const SCRIPTS = {
  dev: { c: C, v: V, m: M, halant: '्', nasal: 'ंँ', dropFinalA: true },
  kn: { c: KC, v: KV, m: KM, halant: '್', nasal: 'ಂ', dropFinalA: false },
}
const isIndic = (t) => /[ऀ-ॿಀ-೿]/.test(t)

export function translit(word) {
  const S = /[ಀ-೿]/.test(word) ? SCRIPTS.kn : SCRIPTS.dev
  const cs = [...word.normalize('NFC').replace(/(.)़/gu, '$1')]
  let out = ''
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], n = cs[i + 1]
    if (S.c[c]) {
      out += S.c[c]
      if (S.m[n]) out += S.m[n], i++
      else if (n === S.halant) i++ // no vowel
      else if (n === undefined) out += S.dropFinalA ? '' : 'a'
      else out += 'a'
    } else if (S.v[c]) out += S.v[c]
    else if (S.nasal.includes(c)) out += 'n'
    else if (c === 'ः') out += 'h'
    else if (/[ऀ-ॿಀ-೿]/.test(c)) continue
    else out += c
  }
  return out
}

const ONES = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, paach: 5, five: 5, chhe: 6, che: 6, chhah: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, gyarah: 11, eleven: 11, barah: 12, twelve: 12, terah: 13, thirteen: 13, chaudah: 14, fourteen: 14, pandrah: 15, fifteen: 15, solah: 16, sixteen: 16, satrah: 17, seventeen: 17, atharah: 18, athaarah: 18, eighteen: 18, unnis: 19, nineteen: 19, bees: 20, twenty: 20, pachees: 25, tees: 30, thirty: 30, chalis: 40, chaalis: 40, forty: 40, pachaas: 50, pachas: 50, fifty: 50, saath: 60, sixty: 60, sattar: 70, seventy: 70, assi: 80, eighty: 80, nabbe: 90, ninety: 90, tin: 3, sat: 7, dus: 10, bis: 20, aat: 8, nao: 9, chhah: 6 }
const MULT = { sau: 100, sao: 100, hundred: 100, hazaar: 1000, hazar: 1000, hajar: 1000, thousand: 1000, lakh: 100000, lac: 100000 }
const FRAC = { dhai: 2.5, derh: 1.5, dedh: 1.5, sawa: 1.25 }
const RUPEE = new Set(['rupaye', 'rupees', 'rupee', 'rupay', 'rupiya', 'rs', 'inr', 'rupye', 'rupaiye'])
const isNumTok = (t) => t in ONES || t in MULT || t in FRAC || t === 'saade' || t === 'sade' || t === 'paune'

function numWord(t) { // exact, else one typo away for longer words ("pachas" vs "pachaas")
  if (isNumTok(t)) return t
  if (t.length < 5) return null
  return [...Object.keys(ONES), ...Object.keys(MULT), ...Object.keys(FRAC)].find((k) => k.length >= 5 && lev(t, k) <= 1) ?? null
}

// Every amount in the tokens, in order, in rupees. A lone small word ("do") only counts next to a rupee word.
// "saade teen sau" = 350, "paune do sau" = 175, "dhai hazaar" = 2500.
export function parseAmounts(tokens) {
  const toks = tokens.map((t) => (/^\d+(\.\d+)?$/.test(t) ? t : numWord(t) ?? t))
  const out = []
  for (let i = 0; i < toks.length; i++) {
    if (/^\d+(\.\d+)?$/.test(toks[i])) {
      let v = Number(toks[i])
      if (toks[i + 1] in MULT) { v *= MULT[toks[i + 1]]; i++ }
      out.push(v)
      continue
    }
    if (!isNumTok(toks[i])) continue
    let total = 0, cur = 0, adj = 0, mults = 0, j = i
    for (; j < toks.length && isNumTok(toks[j]); j++) {
      const t = toks[j]
      if (t === 'saade' || t === 'sade') adj = 0.5
      else if (t === 'paune') adj = -0.25
      else if (t in ONES) { cur += ONES[t] + adj; adj = 0 }
      else if (t in FRAC) cur = FRAC[t]
      else if (t === 'sau' || t === 'sao' || t === 'hundred') { cur = (cur || 1) * 100; mults++ }
      else { total += (cur || 1) * MULT[t]; cur = 0; mults++ }
    }
    const value = total + cur
    if (value > 0 && (mults > 0 || value > 20 || RUPEE.has(toks[j]))) out.push(value)
    i = j - 1
  }
  return out
}
export const parseAmount = (tokens) => parseAmounts(tokens)[0] ?? null

const STOP = new Set(('ko ne ka ke ki se hai hain ho hu tha thi the to from for of me my mujhe mera aap ab abhi phir aur or and the a an add credit payment record check balance batao bata bataiye karo kar do karun kiya kiye kare diye diya di de liya liye ' +
  'wapas return returned paid udhaar udhar kitna kitni kitne baaki baki owe owes owed how much does total rupaye rupees rupee rs inr rupay hisaab aaj today customer naya new pichhli pichli pichla pichhla last entry galat sahi haan han ha haa yes no nahi nahin na ok okay theek ' +
  'please jama chuka lauta received receive mein main hi bhi wala wali previous undo cancel rehne rahne dues due outstanding yeh ye woh wo usne unhone vo account dukan khata khate sab sabka sabhi everyone anyone customer ji bhai bhaiya sahab madam aunty uncle ' +
  'aapka hamara kitnaa hisab abhi bilkul confirm correct right wrong nope yeah yep stop ruko mat chhodo chod isse reverse entries transaction ' +
  'diya hua hui hue gaya gayi raha rahi lena dena liya dedo dedijiye karna ' +
  'kal parso yesterday wale wala samaan saman saaman maal saudha goods items jodo banao bana hatao delete remove pichle pichhle overall ' +
  'reminder reminders yaad dilana dilaana dila laga set due tareekh tarikh date priority high low medium urgent zaruri zaroori important subah shaam raat dopahar baje hafte hafta week saat din ' +
  'iski iske isko iska uski uske usko uska inki inka inko mujhe tak lene lena leni dena dene deni paise paisa karni karna kaunse kaun kis kiska kiski kisse kiske sabse zyada pehle overdue ' +
  'briefing sunao agla agle next this vasool mil gayi gaya gaye mile aayi aaya aaye mili mila collect list customers').split(/\s+/))

const YES = new Set('haan han ha haa yes yeah yep ok okay sahi theek thik correct right confirm bilkul ji kardo done sure save'.split(' '))
const NO = new Set('nahi nahin na no nope galat ruko wrong cancel'.split(' '))

export function normalize(text) {
  let s = String(text ?? '').normalize('NFC').toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/₹/g, ' rs ')
  s = s.replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d))
  s = s.replace(/(\d)([^\d\s.])/gu, '$1 $2').replace(/([^\d\s.])(\d)/gu, '$1 $2')
  return s.split(/[^\p{L}\p{M}\p{N}.]+/u).map((t) => t.replace(/^\.+|\.+$/g, '')).filter(Boolean)
    .flatMap((t) => {
      if (!isIndic(t)) return [t]
      if (DEV[t] !== undefined) return DEV[t].split(' ').filter(Boolean)
      if (t.length > 2 && t.endsWith('ಗೆ')) return [translit(t.slice(0, -2)), 'ko'] // "ರಮೇಶ್‌ಗೆ" = Ramesh + to
      return [translit(t)]
    })
}

const title = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const PARTICLE_AFTER = new Set(['ko', 'ne', 'ka', 'ke', 'ki', 'se'])
const PARTICLE_BEFORE = new Set(['to', 'from', 'for'])

// Which customer is meant? -> {status:'match'|'ambiguous'|'new', customer?, candidates?, name?} or null
export function findCustomer(tokens, customers) {
  const cand = tokens.map((t, i) => ({ t, i })).filter(({ t }) => t.length >= 3 && /^\p{L}+$/u.test(t) && !STOP.has(t) && !isNumTok(t) && !RUPEE.has(t))
  let maybe = null
  for (const { t } of cand) { // a confident match anywhere beats a plausible one
    const m = matchCustomer(t, customers)
    if (m.status === 'match' || m.status === 'ambiguous') return m
    if (m.status === 'maybe' && !maybe) maybe = { ...m, name: title(t) }
  }
  if (maybe) return maybe
  const HONORIFIC = new Set(['ji', 'bhai', 'bhaiya', 'sahab', 'saab', 'madam', 'anna', 'amma'])
  for (const { t, i } of cand) {
    const next = HONORIFIC.has(tokens[i + 1]) ? tokens[i + 2] : tokens[i + 1]
    if (PARTICLE_AFTER.has(next) || PARTICLE_BEFORE.has(tokens[i - 1])) return { status: 'new', name: title(t) }
  }
  return null
}

const numOf = (t) => (/^\d+$/.test(t) ? Number(t) : ONES[t] ?? null)

// `opts.now` fixes the clock (tests); relative dates are resolved in Asia/Kolkata.
export function parse(text, customers, opts = {}) {
  const now = opts.now ?? new Date()
  const tokens = normalize(text)
  const j = tokens.join(' ')
  const has = (re) => re.test(j)
  // "kal" is tomorrow when planning (reminders, what is due) and yesterday when recalling (what was given, the accounts).
  const futureCue = has(/\b(yaad|remind\w*|dilana|dilaana|due|leni|lene|lena|lenge|dena|dene|deni|karni|karna|laga|set|kaunse|kaun|urgent|tak)\b/)
  const historical = has(/\b(hisaab|hisab|summary|report|diya|diye|mili|mila|mile|aayi|aaya|liya|hua|tha|thi|hui)\b/)
  const w = extractWhen(tokens, now, { numOf, kalFuture: futureCue || !historical })
  const rest = w.rest // date and time words removed: "5 tareekh" must never be read as 5 rupees
  const amounts = parseAmounts(rest)
  const short = tokens.length <= 6
  const isNo = short && tokens.some((t) => NO.has(t))
  // "Nahi, paanch sau nahi, teen sau": when the user is correcting, the LAST amount is the one they mean.
  const amount = isNo && amounts.length > 1 ? amounts[amounts.length - 1] : amounts[0]
  const strongPay = has(/\b(wa+pas|va+pas|waapis|return\w*|repa\w*|paid|payment|jama|chuka\w*|lauta\w*|receiv\w*|mil gay\w*|mile|aa gay\w*)\b/)
  // "Ramesh ne 200 diye" gives no direction (payment? goods?). It is flagged weak so the app asks instead of guessing.
  const weakPay = !strongPay && has(/\bne\b.*\b(diy[ea]|diya|di|de)\b/) && !has(/\bko\b/) && !has(/\b(udh?a+r|credit|liya|liye|samaan|saman|saaman|maal|saudha|goods)\b/)
  const f = {
    text: j, tokens: rest, amountPaise: amount != null ? Math.round(amount * 100) : null, // integer paise from here on
    nameRef: findCustomer(rest, customers),
    isSummary: false,
    isReverse: has(/\b(pichh?li|pichla|pichhla|previous|purani)\b.*\b(entry|transaction|wali|wala)\b|\bundo\b|\b(entry|transaction)\b.*\bgalat\b|\blast\b.*\b(wala|wali|entry|hatao|delete|remove|reverse)\b/),
    isCancel: has(/\b(cancel|rehne do|rahne do|chhodo|chod do|mat karo|stop)\b/),
    hasPayment: strongPay || weakPay,
    weakPayment: weakPay,
    hasCredit: has(/\b(udh?a+r|adhar|credit|lend|lent|borrow\w*|liya|liye|le gay[ea]|likh do|samaan|saman|saaman|maal|saudha|goods)\b/) || has(/\bko\b.*\b(diy[ea]|diya|di|de)\b/),
    wantsTotal: has(/\b(total|kul|sabka|sabhi|sab|everyone|overall)\b/),
    contextual: has(/\b(ab|abhi)\b/),
    pronoun: has(/\b(iski|iske|isko|iska|uski|uske|usko|uska|inki|inka|inko|isse|usse|same)\b/),
    priority: has(/\b(high|urgent|zaruri|zaroori|important)\b/) ? 'high' : has(/\bmedium\b/) ? 'medium' : has(/\blow\b/) ? 'low' : null,
    when: { date: w.date?.ymd ?? null, rolled: !!w.date?.rolled, dateOptions: w.dateOptions, time: w.time, timeOptions: w.timeOptions, daypart: w.daypart },
  }
  f.isBalance = f.amountPaise == null && has(/\b(kitna|kitni|kitne|how much|balance|owe\w*|dues?|outstanding|baaki|baki|total|kul)\b/)
  f.isNo = isNo
  f.isYes = short && !f.isNo && !f.isBalance && !f.isReverse && f.amountPaise == null && tokens.some((t) => YES.has(t)) && !f.hasCredit && !f.hasPayment
  if (f.isBalance) { f.hasCredit = false; f.hasPayment = false; f.weakPayment = false }
  if (f.hasPayment && f.hasCredit && strongPay) f.hasCredit = false // "udhaar wapas diya" = repayment
  // "Kal wale 300 cancel kar do": reverse one specific entry by amount (and day / customer), not the last one.
  const reverseWord = has(/\b(cancel|hatao|delete|remove|reverse|undo|galat)\b/)
  const when = has(/\b(kal|yesterday)\b/) ? -1 : has(/\b(aaj|today)\b/) ? 0 : null
  f.specificReverse = amounts.length > 0 && reverseWord && (when !== null || has(/\b(wala|wale|wali)\b/)) && !f.hasCredit && !f.hasPayment && !f.isBalance
  if (f.specificReverse) { f.isReverse = true; f.reverseWhen = when; f.reverseAmountPaise = f.amountPaise }
  // "Rameshwar ko add karo": add a customer, not an entry.
  f.isAddCustomer = !!f.nameRef && f.amountPaise == null && has(/\b(add|jodo|jod do|naya|new|banao|bana do)\b/) && !f.hasCredit && !f.hasPayment && !f.isBalance

  // ---- reports and questions about what is due
  const weekly = has(/\b(hafte|hafta|week|saat din|7 din|seven days|saptah)\b/)
  const hisaab = has(/\b(hisaab|hisab|summary|report)\b/)
  const queryWord = has(/\b(kaunse|kaun|kis kis|kiski|kisse|kiske|which|who|kitni|kitna|batao|sunao|list)\b/)
  const dueQuery = queryWord && (has(/\bdue\b/) || (f.priority === 'high' && has(/\bpayments?\b/)))
  let report = null
  if (has(/\bbriefing\b/)) report = { kind: 'briefing' }
  else if (has(/\boverdue\b/)) report = { kind: has(/\b(kitni|kitna|total|how much)\b/) ? 'overdue_total' : 'overdue_list' }
  else if (has(/\b(sabse zyada|sabse jyada|sabse jada|highest|most)\b/) && has(/\b(udhaar|baaki|owe|owes)\b/)) report = { kind: 'top_debtor' }
  else if (has(/\b(sabse pehle|pehle kisse|first)\b/) && has(/\b(paise|payment|lene|collect|vasool)\b/)) report = { kind: 'collect_first' }
  else if (dueQuery) report = { kind: 'due_list', date: w.date?.ymd ?? null, onlyHigh: f.priority === 'high' }
  else if (weekly && (hisaab || has(/\b(udhaar|credit|payment|mili|aayi|received)\b/)))
    report = { kind: hisaab ? 'weekly' : has(/\b(payment|mili|aayi|received)\b/) && !has(/\b(udhaar|credit)\b/) ? 'weekly_payment' : 'weekly_credit' }
  else if (!f.nameRef && hisaab) report = { kind: 'daily', day: w.date?.ymd ?? null }
  else if (w.date && has(/\b(kitna|kitne)\b/) && has(/\b(udhaar|credit)\b/) && has(/\b(diya|diye|di)\b/)) report = { kind: 'daily_credit', day: w.date.ymd }
  else if (w.date && has(/\b(kitni|kitna)\b/) && has(/\b(payment|paise)\b/) && has(/\b(aayi|aaya|mili|mila|mile|received|aaye)\b/)) report = { kind: 'daily_payment', day: w.date.ymd }
  f.report = report
  f.isSummary = report?.kind === 'daily'

  // ---- reminders, due dates and priorities
  const reminderWord = has(/\b(yaad|remind\w*|dilana|dilaana|dila do)\b/)
  const dueWord = has(/\b(due|leni|lene|lena|lenge|dena|dene|deni|collect)\b/) || has(/\b(karni|karna)\b.*\bpayment\b|\bpayment\b.*\b(karni|karna)\b/)
  f.isFollowUp = !report && (reminderWord || dueWord) && !(has(/\breminder\b/) && has(/\b(cancel|hatao|delete|remove|band)\b/))
  f.cancelFollowUp = !report && has(/\breminder\b/) && has(/\b(cancel|hatao|delete|remove|band)\b/)
  f.followEdit = !report && has(/\breminder\b/) && has(/\b(kar do|kardo|karo|kar dijiye|badal|change|shift)\b/) && !has(/\b(laga|set|dilana|yaad)\b/) && !f.cancelFollowUp
  f.setPriority = !report && !f.isFollowUp && !f.followEdit && f.priority !== null && has(/\b(priority|urgent|zaruri|zaroori|important)\b/) && has(/\b(kar|karo|set|rakho|mark|banao)\b/)
  if (f.followEdit) f.isFollowUp = false
  if (report || f.isFollowUp || f.cancelFollowUp || f.followEdit || f.setPriority) { f.hasCredit = false; f.hasPayment = false; f.weakPayment = false; f.isBalance = false }
  if (report || f.cancelFollowUp) f.isCancel = f.isCancel && !f.cancelFollowUp && !report
  f.recognised = !!report || f.isFollowUp || f.cancelFollowUp || f.followEdit || f.setPriority || f.isReverse || f.isCancel || f.hasPayment || f.hasCredit || f.isBalance || f.isNo || f.isYes || f.amountPaise != null || !!f.nameRef || !!f.when.date || !!f.when.dateOptions
  return f
}
