// [BCP-47 code for Chrome speech, label]. Any language Chrome can recognise works: replies for languages
// without a built-in template below are written by Claude via /api/say.
export const LANGS = [
  ['hi-IN', 'हिन्दी Hindi'], ['en-IN', 'English (India)'], ['bn-IN', 'বাংলা Bengali'], ['gu-IN', 'ગુજરાતી Gujarati'],
  ['pa-guru-IN', 'ਪੰਜਾਬੀ Punjabi'], ['mr-IN', 'मराठी Marathi'], ['ta-IN', 'தமிழ் Tamil'], ['te-IN', 'తెలుగు Telugu'],
  ['kn-IN', 'ಕನ್ನಡ Kannada'], ['ml-IN', 'മലയാളം Malayalam'], ['ur-IN', 'اردو Urdu'], ['ne-NP', 'नेपाली Nepali'],
  ['si-LK', 'සිංහල Sinhala'], ['en-US', 'English (US)'], ['es-ES', 'Español'], ['fr-FR', 'Français'],
  ['pt-BR', 'Português'], ['ar-SA', 'العربية Arabic'], ['id-ID', 'Bahasa Indonesia'], ['sw-KE', 'Kiswahili'],
  ['fil-PH', 'Filipino'], ['vi-VN', 'Tiếng Việt'], ['th-TH', 'ไทย Thai'], ['tr-TR', 'Türkçe'],
  ['ru-RU', 'Русский'], ['de-DE', 'Deutsch'], ['ja-JP', '日本語 Japanese'], ['zh-CN', '中文 Chinese'],
]

// Local templates take one vars object {name, amount, ...}; instant and offline-friendly.
const T = {
  'hi-IN': {
    credit: (n, a) => `${n}, ${a} रुपये उधार।`, payment: (n, a) => `${n}, ${a} रुपये वापस।`, right: 'सही है?',
    balance: (v) => `${v.name} का ${v.amount} रुपये बाकी है।`, clear: (v) => `${v.name} का कुछ बाकी नहीं है।`,
    saved: 'ठीक है, लिख लिया।', pick: (v) => `${v.a} या ${v.b}?`, head: 'इस हफ़्ते का हिसाब।',
    none: 'अभी कोई ग्राहक नहीं है।', nf: (v) => `${v.name} नाम का कोई ग्राहक नहीं मिला।`, unclear: 'समझ नहीं आया, दोबारा बोलें।',
    remind: (v) => `नमस्ते ${v.name} जी, आपका ${v.amount} रुपये बाकी है। कृपया जब सुविधा हो चुका दें। धन्यवाद।`,
  },
  'en-IN': {
    credit: (n, a) => `${n}, ${a} rupees udhaar.`, payment: (n, a) => `${n}, paid back ${a} rupees.`, right: 'Is that right?',
    balance: (v) => `${v.name} owes ${v.amount} rupees.`, clear: (v) => `${v.name} is clear.`, saved: 'Okay, noted.',
    pick: (v) => `${v.a} or ${v.b}?`, head: "This week's summary.", none: 'No customers yet.', nf: (v) => `No customer named ${v.name}.`,
    unclear: "Sorry, I didn't get that. Please try again.",
    remind: (v) => `Hello ${v.name}, a gentle reminder that ${v.amount} rupees is pending. Please pay when convenient. Thank you!`,
    total: (v) => `${v.count} customers owe ${v.amount} rupees in total.`,
    undone: (v) => `Removed: ${v.name}, ${v.amount} rupees.`,
    fixed: (v) => `Corrected: ${v.name}, ${v.amount} rupees ${v.type === 'credit' ? 'udhaar' : 'paid back'}.`,
    warn: (v) => `Careful: ${v.name} already owes ${v.balance} rupees${v.oldestDays >= 7 ? `, oldest unpaid ${v.oldestDays} days` : ''}.`,
    scan: (v) => `I read ${v.count} entries, ${v.total} rupees in total. Add them?`,
  },
  'ta-IN': {
    credit: (n, a) => `${n}, ${a} ரூபாய் கடன்.`, payment: (n, a) => `${n}, ${a} ரூபாய் திருப்பிக் கொடுத்தார்.`, right: 'சரியா?',
    balance: (v) => `${v.name} இன்னும் ${v.amount} ரூபாய் தர வேண்டும்.`, clear: (v) => `${v.name} எதுவும் தர வேண்டியதில்லை.`,
    saved: 'சரி, பதிவு செய்தேன்.', pick: (v) => `${v.a} அல்லது ${v.b}?`, head: 'இந்த வாரக் கணக்கு.',
    remind: (v) => `வணக்கம் ${v.name}, நீங்கள் ${v.amount} ரூபாய் தர வேண்டியுள்ளது. வசதிப்படும்போது செலுத்தவும். நன்றி.`,
  },
  'mr-IN': {
    credit: (n, a) => `${n}, ${a} रुपये उधार.`, payment: (n, a) => `${n}, ${a} रुपये परत.`, right: 'बरोबर आहे का?',
    balance: (v) => `${v.name} कडे ${v.amount} रुपये बाकी आहेत.`, clear: (v) => `${v.name} चा हिशोब साफ आहे.`,
    saved: 'ठीक आहे, नोंदवले.', pick: (v) => `${v.a} की ${v.b}?`, head: 'या आठवड्याचा हिशोब.',
    remind: (v) => `नमस्कार ${v.name}, तुमचे ${v.amount} रुपये बाकी आहेत. सोयीनुसार द्यावेत. धन्यवाद.`,
  },
  'kn-IN': {
    credit: (n, a) => `${n}, ${a} ರೂಪಾಯಿ ಸಾಲ.`, payment: (n, a) => `${n}, ${a} ರೂಪಾಯಿ ವಾಪಸ್.`, right: 'ಸರಿಯೇ?',
    balance: (v) => `${v.name} ಅವರಿಂದ ${v.amount} ರೂಪಾಯಿ ಬರಬೇಕು.`, clear: (v) => `${v.name} ಅವರ ಲೆಕ್ಕ ಕ್ಲಿಯರ್ ಆಗಿದೆ.`,
    saved: 'ಸರಿ, ದಾಖಲಿಸಿದೆ.', pick: (v) => `${v.a} ಅಥವಾ ${v.b}?`, head: 'ಈ ವಾರದ ಲೆಕ್ಕ.',
    remind: (v) => `ನಮಸ್ಕಾರ ${v.name}, ನೀವು ${v.amount} ರೂಪಾಯಿ ಕೊಡಬೇಕು. ಅನುಕೂಲವಾದಾಗ ಪಾವತಿಸಿ. ಧನ್ಯವಾದ.`,
  },
  'te-IN': {
    credit: (n, a) => `${n}, ${a} రూపాయలు అప్పు.`, payment: (n, a) => `${n}, ${a} రూపాయలు తిరిగి ఇచ్చారు.`, right: 'సరేనా?',
    balance: (v) => `${v.name} ${v.amount} రూపాయలు ఇవ్వాలి.`, clear: (v) => `${v.name} లెక్క క్లియర్ గా ఉంది.`,
    saved: 'సరే, రాసుకున్నాను.', pick: (v) => `${v.a} లేదా ${v.b}?`, head: 'ఈ వారం లెక్క.',
    remind: (v) => `నమస్కారం ${v.name}, మీరు ${v.amount} రూపాయలు ఇవ్వాలి. వీలైనప్పుడు చెల్లించండి. ధన్యవాదాలు.`,
  },
}

function local(lang, key, v) {
  const loc = T[lang] ?? (lang.startsWith('en') ? T['en-IN'] : null)
  if (!loc) return null
  if (key === 'readback') return loc.credit ? v.entries.map((e) => loc[e.type](e.name, e.amount)).join(' ') + ' ' + loc.right : null
  if (key === 'summary') {
    if (!loc.head || !loc.balance) return null
    if (!v.rows.length) return loc.none ?? null
    return `${loc.head} ${v.rows.map((r) => (r.balance > 0 ? loc.balance({ name: r.name, amount: r.balance }) : loc.clear({ name: r.name }))).join(' ')}`
  }
  const f = loc[key]
  return f == null ? null : typeof f === 'function' ? f(v) : f
}

const cache = new Map()
const label = (lang) => LANGS.find(([c]) => c === lang)?.[1] ?? lang

// Spoken/written line for any language: built-in template if we have one, otherwise written by Claude (cached).
export async function phrase(lang, key, v = {}) {
  const hit = local(lang, key, v)
  if (hit != null) return hit
  const ck = lang + key + JSON.stringify(v)
  if (cache.has(ck)) return cache.get(ck)
  try {
    const r = await fetch('/api/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: key, vars: v, langName: label(lang) }) })
    const j = await r.json()
    if (!r.ok || !j.text) throw new Error(j.error)
    cache.set(ck, j.text)
    return j.text
  } catch {
    return local('en-IN', key, v) ?? '' // offline / API down: English beats silence
  }
}

const YES = 'haan han ha haa yes yeah yep ok okay sahi sahih theek thik correct right ho hoy hoi aam aama ama avunu avunandi houdu howdu sari seri hmm हाँ हां हा हाँजी सही ठीक हो होय आम ஆம் சரி అవును సరే ಹೌದು ಸರಿ'.split(' ')
const NO = 'nahi nahin na no nope galat wrong nako nai illai illa alla kaadu kadu नहीं नही न गलत नको இல்லை తప్పు కాదు ಇಲ್ಲ ಅಲ್ಲ ತಪ್ಪು'.split(' ')

// -> 'yes' | 'no' | null. Fast local word lists first, then Claude for any other language. "no" wins ties.
export async function yesNo(text) {
  const w = text.toLowerCase().split(/[\s,.!?।]+/)
  if (w.some((x) => NO.includes(x))) return 'no'
  if (w.some((x) => YES.includes(x))) return 'yes'
  try {
    const r = await fetch('/api/yesno', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    const a = (await r.json()).answer
    return a === 'yes' || a === 'no' ? a : null
  } catch {
    return null
  }
}
