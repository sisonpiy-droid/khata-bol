// Keyless, deterministic understanding of Hindi / Hinglish / English shop talk.
// Returns flags + an amount + a customer reference. It never touches the database.
import { matchCustomer, lev } from './match.js'

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

const ONES = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, paach: 5, five: 5, chhe: 6, che: 6, chhah: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, gyarah: 11, eleven: 11, barah: 12, twelve: 12, terah: 13, thirteen: 13, chaudah: 14, fourteen: 14, pandrah: 15, fifteen: 15, solah: 16, sixteen: 16, satrah: 17, seventeen: 17, atharah: 18, athaarah: 18, eighteen: 18, unnis: 19, nineteen: 19, bees: 20, twenty: 20, pachees: 25, tees: 30, thirty: 30, chalis: 40, chaalis: 40, forty: 40, pachaas: 50, pachas: 50, fifty: 50, saath: 60, sixty: 60, sattar: 70, seventy: 70, assi: 80, eighty: 80, nabbe: 90, ninety: 90 }
const MULT = { sau: 100, sao: 100, hundred: 100, hazaar: 1000, hazar: 1000, hajar: 1000, thousand: 1000, lakh: 100000, lac: 100000 }
const FRAC = { dhai: 2.5, derh: 1.5, dedh: 1.5, sawa: 1.25 }
const RUPEE = new Set(['rupaye', 'rupees', 'rupee', 'rupay', 'rupiya', 'rs', 'inr', 'rupye', 'rupaiye'])
const isNumTok = (t) => t in ONES || t in MULT || t in FRAC || t === 'saade' || t === 'sade'

function numWord(t) { // exact, else one typo away for longer words ("pachas" vs "pachaas")
  if (isNumTok(t)) return t
  if (t.length < 5) return null
  return [...Object.keys(ONES), ...Object.keys(MULT), ...Object.keys(FRAC)].find((k) => k.length >= 5 && lev(t, k) <= 1) ?? null
}

// Rupees found in the tokens, or null. A lone small word ("do") only counts next to a rupee word.
export function parseAmount(tokens) {
  const toks = tokens.map((t) => (/^\d+(\.\d+)?$/.test(t) ? t : numWord(t) ?? t))
  for (let i = 0; i < toks.length; i++) {
    if (/^\d+(\.\d+)?$/.test(toks[i])) {
      const v = Number(toks[i])
      if (toks[i + 1] in MULT) { return v * MULT[toks[i + 1]] }
      return v
    }
    if (!isNumTok(toks[i])) continue
    let total = 0, cur = 0, half = false, mults = 0, j = i
    for (; j < toks.length && isNumTok(toks[j]); j++) {
      const t = toks[j]
      if (t === 'saade' || t === 'sade') half = true
      else if (t in ONES) { cur += ONES[t] + (half ? 0.5 : 0); half = false }
      else if (t in FRAC) cur = FRAC[t]
      else if (t === 'sau' || t === 'sao' || t === 'hundred') { cur = (cur || 1) * 100; mults++ }
      else { total += (cur || 1) * MULT[t]; cur = 0; mults++ }
    }
    const value = total + cur
    if (value > 0 && (mults > 0 || value > 20 || RUPEE.has(toks[j]))) return value
    i = j - 1
  }
  return null
}

const STOP = new Set(('ko ne ka ke ki se hai hain ho hu tha thi the to from for of me my mujhe mera aap ab abhi phir aur or and the a an add credit payment record check balance batao bata bataiye karo kar do karun kiya kiye kare diye diya di de liya liye ' +
  'wapas return returned paid udhaar udhar kitna kitni kitne baaki baki owe owes owed how much does total rupaye rupees rupee rs inr rupay hisaab aaj today customer naya new pichhli pichli pichla pichhla last entry galat sahi haan han ha haa yes no nahi nahin na ok okay theek ' +
  'please jama chuka lauta received receive mein main hi bhi wala wali previous undo cancel rehne rahne dues due outstanding yeh ye woh wo usne unhone vo account dukan khata khate sab sabka sabhi everyone anyone customer ji bhai bhaiya sahab madam aunty uncle ' +
  'aapka hamara kitnaa hisab abhi bilkul confirm correct right wrong nope yeah yep stop ruko mat chhodo chod isse reverse entries transaction ' +
  'diya hua hui hue gaya gayi raha rahi lena dena liya dedo dedijiye karna').split(/\s+/))

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
  for (const { t } of cand) {
    const m = matchCustomer(t, customers)
    if (m.status !== 'new') return m
  }
  for (const { t, i } of cand) {
    if (PARTICLE_AFTER.has(tokens[i + 1]) || PARTICLE_BEFORE.has(tokens[i - 1])) return { status: 'new', name: title(t) }
  }
  return null
}

export function parse(text, customers) {
  const tokens = normalize(text)
  const j = tokens.join(' ')
  const amount = parseAmount(tokens)
  const has = (re) => re.test(j)
  const f = {
    text: j, tokens, amountPaise: amount != null ? Math.round(amount * 100) : null,
    nameRef: findCustomer(tokens, customers),
    isSummary: has(/\b(aaj|today|todays|aj)\b.*\b(hisaab|hisab|summary|account|total|report|kitna|sale)\b|\bhisaab\b.*\b(aaj|today)\b/),
    isReverse: has(/\b(pichh?li|pichla|pichhla|previous|purani)\b.*\b(entry|transaction|wali|wala)\b|\bundo\b|\b(entry|transaction)\b.*\bgalat\b|\blast\b.*\b(wala|wali|entry|hatao|delete|remove|reverse)\b/),
    isCancel: has(/\b(cancel|rehne do|rahne do|chhodo|chod do|mat karo|stop)\b/),
    hasPayment: has(/\b(wa+pas|va+pas|waapis|return\w*|repa\w*|paid|payment|jama|chuka\w*|lauta\w*|receiv\w*)\b/) || has(/\bne\b.*\b(diy[ea]|diya|di|de)\b/) && !has(/\bko\b/) && !has(/\b(udh?a+r|credit|liya|liye)\b/),
    hasCredit: has(/\b(udh?a+r|adhar|credit|lend|lent|borrow\w*|liya|liye|le gay[ea]|likh do)\b/) || has(/\bko\b.*\b(diy[ea]|diya|di|de)\b/),
  }
  f.isBalance = !f.isSummary && f.amountPaise == null && has(/\b(kitna|kitni|kitne|how much|balance|owe\w*|dues?|outstanding|baaki|baki)\b/)
  const short = tokens.length <= 6
  f.isNo = short && tokens.some((t) => NO.has(t))
  f.isYes = short && !f.isNo && !f.isBalance && !f.isSummary && !f.isReverse && f.amountPaise == null && tokens.some((t) => YES.has(t)) && !f.hasCredit && !f.hasPayment
  if (f.isBalance) { f.hasCredit = false; f.hasPayment = false }
  if (f.hasPayment && f.hasCredit && has(/\b(wa+pas|va+pas|return\w*|repa\w*|paid|jama|chuka\w*)\b/)) f.hasCredit = false // "udhaar wapas diya" = repayment
  f.recognised = f.isSummary || f.isReverse || f.isCancel || f.hasPayment || f.hasCredit || f.isBalance || f.isNo || f.isYes || f.amountPaise != null || !!f.nameRef
  return f
}
