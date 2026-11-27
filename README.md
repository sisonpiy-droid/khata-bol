# Khata Bol · खाता बोल

**Your shop's accounts, just a conversation away.**
A voice-first udhaar (credit) ledger for India's kirana shopkeepers. Speak the entry, hear it read back, say "haan", and it is saved. Category: Livelihoods and Small Business.

## Run it

```bash
docker compose up        # then open http://localhost:8787 in Chrome
```

No `.env` and no API keys are needed. Without Docker:

```bash
npm install
npm run dev              # app on http://localhost:5173, API on :8787 (Node 22.13+)
npm test                 # 30 backend and state-machine tests
```

Use **Chrome** and allow the microphone. `localhost` counts as secure, so voice works without HTTPS.

## What a shopkeeper does

| Say | Khata Bol does |
|---|---|
| "Ramesh ko paanch sau rupaye udhaar diye" | Shows a card, asks "Ramesh ke khate mein 500 rupaye udhaar add karun?" |
| "Haan" | Saves it. "Ho gaya... ab unka total balance 500 rupaye hai." |
| "Ramesh ne 200 rupaye wapas diye" → "haan" | Records the repayment. "Ramesh ke 300 rupaye baaki hain." |
| "Ramesh ka kitna baaki hai?" / "Ramesh ka balance batao" / "How much does Ramesh owe me?" | Reads the real stored balance |
| "Ab kitna baaki hai?" | Knows "ab" means Ramesh (conversation context) |
| "Rameshwr ko 200 udhaar" | "Aap Ramesh ki baat kar rahe hain ya Rameshwar ki?" Keeps amount and type |
| "Nahi, 300 rupaye" | Corrects the pending amount, asks again |
| "Haan, save kar do" / "Nahi" / "Cancel karo" / "Customer Rameshwar hai" | Confirm, cancel, or switch customer |
| "Pichhli entry galat thi" | Asks, then adds a linked **reversal**; history is never deleted |
| "Aaj ka hisaab batao" | Today's real credit given and payments received |

Also works in Devanagari ("रमेश को पाँच सौ रुपये उधार दिए") and English ("Add five hundred credit to Ramesh").

## How it works

```
mic -> speech recognition -> text ──> POST /api/converse ──> state machine (dialog.js)
                                          │                    ├─ nlu.js  deterministic parser (no key)
                                          │                    ├─ llm.js  optional AI fallback
                                          │                    └─ ledger.js  SQLite, integer paise
        speak reply <── {say, card, state, expect} ──────────┘
```

- **Voice reliability**: the mic reopens only ~0.5 s after the app stops speaking (no self-transcription); recognition confidence below 0.45 asks you to repeat instead of acting; silence during a question re-asks once; an unanswered question expires after 5 minutes and is never confirmed late; amounts of ₹5,000+ are flagged for a second look; a network failure shows **Try again** and never claims a save.
- **Voice in/out is replaceable**: `src/lib/speech.js` (Chrome speech recognition and synthesis, or optional Gemini audio when a key is set).
- **Understanding is deterministic first**: `server/nlu.js` handles Hindi/Hinglish/English number words ("dhai sau" = 250), Devanagari, and fuzzy names. An AI model is only a fallback for phrases it cannot parse, and it never sees balances or touches the database.
- **Explicit conversation state** (`server/dialog.js`, stored in SQLite): `idle → awaiting_clarification → awaiting_confirmation → idle`, holding the current customer, pending entry and open question. A "haan" only ever applies to the pending entry.
- **UI state machine** (`src/lib/machine.js`): idle, listening, processing, speaking, awaiting_*, saving, error. It cannot listen while speaking, so the mic never transcribes the app's own voice.
- **Ledger** (`server/ledger.js`): amounts are integer paise; every entry has an idempotency key (a repeated confirm never double-posts); rows are immutable (database triggers); mistakes are fixed by a linked reversal plus an audit event; a failed save is reported, never faked. Backend validation, not just UI.

Deploy: `railway.json` + `Dockerfile` run as one Node service; `/health` reports readiness. Steps in [RAILWAY.md](RAILWAY.md).

Folders: `server/` (API, ledger, parser, dialogue), `src/` (React UI, voice, state machine), `test/`, `Dockerfile`, `compose.yaml`.

## Languages

| Language | Status |
|---|---|
| Hindi / Hinglish, English | Working end to end, no key needed |
| Kannada | Beta. Basic phrases (credit, repayment, balance, yes/no, cancel, number words up to thousands, names via transliteration) parse without a key, and replies are spoken in Kannada when the device has a Kannada voice, otherwise Hinglish. **Written without a native speaker and not tested with real Kannada speech.** Use the manual checklist before presenting it as supported |
| Tamil, Telugu, Marathi | Beta: Chrome can recognise them, but understanding needs the optional AI key. Without it the app says so |

Add a language by adding a row to `src/lib/languages.js`; the transaction engine is untouched.

## Optional AI enhancement

Set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (see `.env.example`). Without a key the app shows "AI enhancement not configured" and keeps working.

## Status and honest limitations

- Tested automatically (`npm test`, 30 tests): ledger maths, idempotency, reversals, confirmation, cancellation, ambiguity, corrections, context, persistence across restart, startup without keys, visitor isolation, failed database writes, expiry of stale questions, Kannada core phrases.
- Tested in the browser: the full journey through the real UI loop (tap → listen → read-back → listen → confirm → balance) driven by a **simulated speech recognizer** (this machine has no microphone), including correction, ambiguity, cancel, reversal, low-confidence re-ask, silence re-ask, and the real microphone-denied message. This proves the state machine and echo guard, **not** real recognition.
- **Needs manual verification** ([docs/VOICE-TEST-CHECKLIST.md](docs/VOICE-TEST-CHECKLIST.md)): real microphone capture and accuracy, spoken replies on each device, Kannada, and `docker compose up` (Docker was not installed on the development machine; the files are standard but unrun).
- Chrome's speech recognition sends audio to Google and needs internet. Browser voices vary; if a device has no Hindi voice, replies may be read in an English accent.
- Replies are Hinglish (roman script), English, or Kannada (if the device speaks it). Other languages get Hinglish replies.
- Prototype: one shop, no login, demo data is synthetic. "Reset demo data" only works while the shop is flagged as demo.
- Public demo: each visitor gets a private demo shop (isolated ledger and conversation). See [RAILWAY.md](RAILWAY.md) to host it with a persistent volume.
- Not built on purpose: WhatsApp reminders, payments, inventory, merchant authentication.

## Demo

See [DEMO-SCRIPT.md](DEMO-SCRIPT.md) for the three-minute walkthrough and [docs/PITCH.md](docs/PITCH.md) for the pitch deck content.
