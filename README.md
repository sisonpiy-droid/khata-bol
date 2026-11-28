# Khata Bol · खाता बोल

![Node](https://img.shields.io/badge/node-24-339933) ![Tests](https://img.shields.io/badge/tests-105%20passing-1f6b3a) ![Docker](https://img.shields.io/badge/docker-compose-2496ED)

**Live:** https://khata-bol-umber.vercel.app · **Judges:** [Submission pack](SUBMISSION.md) · **Docs:** [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

**Your shop's accounts, just a conversation away.**
A voice-first udhaar (credit) ledger and payment follow-up assistant for India's kirana shopkeepers. Speak the entry, hear it read back, say "haan", and it is saved. Then ask for the day's accounts, set a payment promise, and get reminded. Category: Livelihoods and Small Business.

## Run it

```bash
docker compose up        # then open http://localhost:8787 in Chrome
```

No `.env` and no API keys are needed. Without Docker:

```bash
npm install
npm run dev              # app on http://localhost:5173, API on :8787 (Node 22.13+)
npm test                 # 105 tests: ledger, reports, reminders, dates, dialogue, security, voice loop (simulated recognizer)
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

Informal talk works too: "Ramesh ko 500 ka samaan diya", "Ab total batao" (this customer) vs "Total kitna baaki hai?" (everyone), "Aaj kitna udhaar diya?", "Nahi, paanch sau nahi, teen sau" (the last amount wins), "Kal wale 300 cancel kar do" (reverses that entry after confirmation), "Rameshwar ko add karo" (adds a customer after confirmation).

## Your own shop and the Customers screen

- **New account:** on the sample data, tap **New account**, enter your name and shop name, and the sample data is replaced by an empty shop of your own.
- **Customers:** summary strip (customers, owing, total due), search, All / Owing / Clear filters, sorting (most owed, recent, A to Z), last-activity time, and a detail page with credit given, paid back, spoken balance, a reminder shortcut and a polite message you can copy or share yourself.

## Reports, reminders and the daily briefing

| Say | Khata Bol does |
|---|---|
| "Aaj ka hisaab batao" / "Aaj kitna udhaar diya?" / "Aaj kitni payment aayi?" | Today's credit given, repayments received, payments due today and overdue, from real rows |
| "Is hafte ka hisaab batao" / "Pichhle saat din mein kitni payment mili?" | Rolling 7-day report: credit, repayments, net change, outstanding, who owes most, overdue |
| "Sabse zyada udhaar kiska baaki hai?" / "Kitni payment overdue hai?" / "Kaunse customers ki payment overdue hai?" | Reads the answer aloud |
| "Ramesh ko paanch tareekh tak payment karni hai" / "Priya se paanch tareekh ko paise lene hain" | Proposes the real date ("Monday 5 January"), saves a payment commitment only after "haan" |
| "Kal mujhe Ramesh ka payment yaad dilana" / "Kal subah nau baje Suresh ka reminder laga do" | Same, with an optional time (Asia/Kolkata) |
| "Iski payment Friday ko due hai" then "Isko high priority kar do" | "iski/isko" = the customer or reminder just discussed; asks before saving |
| "Ramesh ka reminder Monday kar do" / "Priya ka reminder cancel karo" / "Ramesh ki payment mil gayi" | Reschedule / cancel / asks the amount, then offers to complete the settled reminder |
| "Kal kaunse payments due hain?" / "Kal ki urgent payments batao" / "Is week sabse pehle kisse paise lene hain?" | Spoken, deterministic list (chosen priority first, then date) |
| **Hear today's briefing** button | Short spoken summary: due today, high-priority, overdue, total outstanding. Never plays automatically |

- **Reports** screen: Daily and Weekly, date range, refresh and last-updated time, CSV download and print. **Reminders** screen: Overdue, Due today, Upcoming, Completed; sort by date, amount or priority; reschedule, priority, complete, cancel; a polite message you can copy or share yourself.
- A reminder is a *payment commitment* (customer, due date, optional time, optional expected amount, priority, note, status). It is stored in its own tables and **never changes a balance**; only confirmed credit, repayment and reversal entries do.
- **Urgency vs priority:** "overdue / due today / upcoming" is computed from the date. "High / medium / low" is the shopkeeper's own choice and is never changed automatically.
- **Dates are never guessed:** "next Friday", "Friday" said on a Friday, or a bare "nau baje" ask which one. A past date is refused and asked again. "5 tareekh" means the next real 5th and the confirmation states the full date.
- **Notifications:** in-app banner and, if permission is granted, a browser notification **while the app is open**. Each delivery is recorded once (idempotent), so repeated checks never repeat a notice, and restarts do not lose commitments. There is **no background scheduler**: nothing is sent when the site is closed, and WhatsApp/SMS are not used.
- No sales, profit or cash-flow figures are shown because the ledger does not record them.

## Wispr Flow

Khata Bol's own microphone uses browser speech recognition (or optional Gemini audio). Wispr Flow has an official developer API available by approval only, which we do not have, so it is **not integrated**. Wispr Flow users can dictate into an optional, labelled dictation field; see [WISPR-FLOW-WORKFLOW.md](WISPR-FLOW-WORKFLOW.md) for the verified status and the evidence checklist.

## Product rules (all tested)
- **Nothing is saved without an explicit yes** for the entry just read back. The yes carries that entry's id, so an answer to an old question can never confirm a newer one.
- **Uncertain means ask.** "Ramesh ne 200 diye" gives no direction, so it asks "payment mili ya udhaar diya?" instead of assuming. A name that is only *close* to an existing customer ("Kavya" vs "Kavita") asks: existing customer or new? Identical names are shown with what each owes and must be chosen.
- **Overpayment rule:** a repayment larger than what the customer owes is allowed only after an explicit warning ("sirf 800 baaki hain, baaki 200 advance ban jayenge") and a yes; the excess is stored as an advance (negative balance). It is never rejected silently or saved silently.
- **Large amounts (₹5,000+)** are flagged for a second look. Amounts above ₹10,00,000, below ₹1, zero or unparseable are refused before any confirmation.
- **Duplicates and races:** one request per session runs at a time, the idempotency key is a database UNIQUE constraint, and double taps, two tabs or a network retry save once.
- **Mistakes are recoverable:** reversals are linked rows (never deleted, never reversed twice, never across customers or visitors).
- **Refresh, tab switch, language switch:** an unfinished entry returns after a page refresh (silently, no surprise speech); a background tab stops the mic and voice; changing language re-asks in the new language and never saves.

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

Deploy: `docker compose up`, or `railway.json` + `Dockerfile` as one Node service (`/health` reports readiness), or Vercel, where `api/index.js` runs the same Express app as a function. On Vercel the SQLite file lives in `/tmp`, so data is not permanent there. Steps in [RAILWAY.md](RAILWAY.md).

Folders: `server/` (API, ledger, reports, commitments, dates, parser, dialogue), `src/` (React UI, voice, state machine), `test/`, `Dockerfile`, `compose.yaml`.

## Languages

| Language | Status |
|---|---|
| Hindi / Hinglish, English | Working end to end, no key needed |
| Kannada | Beta. Basic phrases (credit, repayment, balance, yes/no, cancel, number words up to thousands, names via transliteration) parse without a key, and replies are spoken in Kannada when the device has a Kannada voice, otherwise Hinglish. **Written without a native speaker and not tested with real Kannada speech.** Use the manual checklist before presenting it as supported |
| Tamil, Telugu, Marathi | Beta: Chrome can recognise them, but understanding needs the optional AI key. Without it the app says so |

Add a language by adding a row to `src/lib/languages.js`; the transaction engine is untouched.

## Optional AI enhancement

Set `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` together with `ANTHROPIC_MODEL` (see `.env.example`). Without a key the app shows "AI enhancement not configured" and keeps working.

## Status and honest limitations

- Tested automatically (`npm test`, 105 tests): ledger maths and float safety, idempotency and concurrent confirmations, overpayment, reversals, ambiguity and uncertain names, informal phrases, corrections, stale answers, persistence across restart, startup without keys, visitor isolation and cross-session access attempts, input validation, rate limits, parameterised SQL, failed database writes, expiry, Kannada core phrases, and the **real voice loop** (`src/lib/voice.js`) driven by a simulated recognizer and speaker against the real backend: no mic during speech, interruption, low confidence, silence, permission denied, network retry, double tap, tab hidden, refresh restore, language switch, dispose.
- Tested in the browser (production build): onboarding, ambiguity card, overpayment warning, refresh restore, language persistence, offline banner, customer search, no console or CSP errors, 375 px layout. The real microphone-denied message was seen in a real browser. The voice loop is driven only by **simulated** recognition because no microphone is available here: this proves state transitions and echo protection, **not** real recognition accuracy.
- **Needs manual verification** ([docs/VOICE-TEST-CHECKLIST.md](docs/VOICE-TEST-CHECKLIST.md)): real microphone capture and accuracy, spoken replies on each device, Kannada, and `docker compose up` (Docker was not installed on the development machine; the files are standard but unrun).
- Privacy and security limits are written down in [docs/PRIVACY-SECURITY.md](docs/PRIVACY-SECURITY.md). The anonymous demo-session model is **not** production authentication; there is no encryption at rest and no backup.
- Chrome's speech recognition sends audio to Google and needs internet; there is no offline mode and the app says so when the connection drops. Browser voices vary; if a device has no Hindi voice, replies may be read in an English accent.
- Replies are Hinglish (roman script), English, or Kannada (if the device speaks it). Other languages get Hinglish replies.
- Prototype: one shop, no login, demo data is synthetic. "Reset demo data" only works while the shop is flagged as demo.
- Public demo: each visitor gets a private demo shop (isolated ledger and conversation). See [RAILWAY.md](RAILWAY.md) to host it with a persistent volume.
- Not built on purpose: WhatsApp reminders, payments, inventory, merchant authentication.

## Demo

See [DEMO-SCRIPT.md](DEMO-SCRIPT.md) for the three-minute walkthrough and [docs/PITCH.md](docs/PITCH.md) for the pitch deck content.
