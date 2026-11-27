// Add a language by adding a row; the transaction engine does not change.
// level 'full'  : deterministic keyless parser + spoken replies (tested).
// level 'beta'  : Chrome recognises the speech, but understanding needs the optional AI layer.
export const LANGS = [
  { code: 'hi-IN', label: 'हिन्दी · Hinglish', short: 'हिन्दी', level: 'full' },
  { code: 'en-IN', label: 'English (India)', short: 'English', level: 'full' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ Kannada', short: 'ಕನ್ನಡ', level: 'beta' },
  { code: 'ta-IN', label: 'தமிழ் Tamil', level: 'beta' },
  { code: 'te-IN', label: 'తెలుగు Telugu', level: 'beta' },
  { code: 'mr-IN', label: 'मराठी Marathi', level: 'beta' },
]
export const spokenLang = (code) => (code.startsWith('en') ? 'en-IN' : code.startsWith('kn') ? 'kn-IN' : 'hi-IN') // replies: English, Kannada (if the device speaks it) or Hinglish
