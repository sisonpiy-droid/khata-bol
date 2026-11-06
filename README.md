# Khata Bol (खाता बोल)

Voice-only udhaar ledger for kirana shopkeepers. Hackathon demo: Chrome on a laptop.

Speak -> Web Speech API transcript -> `POST /api/parse` (Claude Haiku extracts JSON) -> fuzzy name match -> spoken read-back -> confirm by voice or button -> saved in localStorage.

## Run

```bash
cd khata-bol
npm install
cp .env.example .env     # then put your ANTHROPIC_API_KEY in .env
npm run dev              # web on http://localhost:5173, API on :8787
```

Open **http://localhost:5173 in Chrome**, allow the microphone, click "Load sample data".
`npm test` checks the name matcher and insights. The API key is only ever read by the Express server.

## Features

- **Any-language voice (optional)**: add `GEMINI_API_KEY` to `.env` and the mic records audio, Gemini transcribes it in any language (even mixed) and detects which one, and replies switch to that language automatically ("🌐 Auto-detect"). Without the key, or if Gemini fails, it falls back to Chrome speech.
- **Any language**: 28 languages in the picker (anything Chrome can recognise). Claude parses any script/number words; spoken replies for languages without a built-in template are written by Claude and cached.
- **Multi-entry**: "Ramesh 200 udhaar, Sunita 50 wapas" in one breath, one confirmation.
- **Voice undo / correction**: "last wala hatao", "galat, 300 tha".
- **Hands-free**: keeps listening between turns (stops after 3 silent turns or when you tap the mic).
- **Scan khata**: photo of a paper ledger (any script) -> Claude vision -> confirm -> imported. Try `public/sample-khata.svg` (open it, or pick it in the file dialog).
- **Insights**: risk warning before a big/old credit, "Chase first" list, "usually pays in ~N days".
- **UPI reminders**: set shop name + UPI ID on the Customers screen; WhatsApp reminders include them, in the selected language.
- "total kitna baaki hai?" answers the shop-wide outstanding.

## Files

- `server/index.js` — `/api/parse`, `/api/say` (any-language phrases), `/api/yesno`, `/api/scan` (vision); prompts, fence stripping, JSON validation
- `src/App.jsx` — mic flow (listen -> parse -> match -> read back -> confirm), home screen
- `src/Views.jsx` — customer list/detail, WhatsApp reminder, weekly summary text
- `src/lib/` — `match.js` (Levenshtein), `speech.js` (recognition + TTS), `i18n.js` (spoken phrases, yes/no words), `store.js` (localStorage)

## Known limitations

- Chrome only for speech recognition. It sends audio to Google, so it needs internet.
- Chrome must support a language for speech recognition, and the device needs a voice for it to speak replies; if none, TTS may be silent (the on-screen card still shows everything).
- Without a Gemini key, replies use the language you picked (no auto-detect). With it, spoken audio is sent to Google's Gemini API.
- Non-built-in languages cost one extra Claude call (~1s) per new sentence shape; falls back to English if the API is down.
- Recognition of names is imperfect; customer names are stored romanised (Latin script) by design so matching is consistent.
- Yes/no word lists are hand-written and cover common words only; the buttons are the reliable fallback.
- "Weekly summary" is current balances, not a date-filtered report.
- localStorage only: one browser, no sync, no backup. No auth, multi-shop, or real WhatsApp API.
- No retry/rate limiting on the API route; fine for a demo, not for production.
- Spoken phrases in non-Hindi/English languages were written without a native-speaker review.
