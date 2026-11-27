# Khata Bol: pitch deck content (one section per slide)

> Figures marked **[verify]** are widely quoted estimates, not measured by us. Confirm a source before presenting.

## 1. Khata Bol
Your shop's accounts, just a conversation away. Voice-first udhaar ledger for kirana shopkeepers. Category: Livelihoods and Small Business.

## 2. The problem
- Kirana shops sell on udhaar (credit) every day. Records live in paper notebooks or in the shopkeeper's memory.
- Entries get forgotten, balances get disputed, and asking for money becomes awkward.
- A shopkeeper is serving, weighing and handling cash at the same time. Opening an app and typing in English is not realistic. Many are most comfortable in Hindi, Kannada, Tamil, Telugu or Marathi.
- India has roughly 12 million kirana stores **[verify]**, and informal credit is part of how many of them compete.

## 3. The solution
Speak the entry, hear it read back, say "haan". Khata Bol turns spoken Hindi/Hinglish/English into a confirmed, persistent ledger entry and answers balance questions aloud.
Capture → Contextualise → Clarify → Commit → Confirm.

## 4. Why voice is the product, not a feature
- Hands and eyes are busy: speaking is the only input that fits the moment.
- Literacy and language: no typing, no English menus.
- Trust: every entry is read back before it is saved, so the shopkeeper hears what was understood.

## 5. Demo (what works today)
Credit → spoken confirmation → repayment → spoken balance → ambiguous name ("Ramesh or Rameshwar?") → correction → reversal with history. Real microphone, real database.

## 6. How it prevents wrong financial records
- Nothing is saved without an explicit "haan" for that exact pending entry.
- Money is integer paise; balances come from stored rows, never from the AI.
- Idempotency keys: a repeated confirmation cannot double-post.
- Immutable history: mistakes are fixed by a linked reversal and an audit event; nothing is deleted.
- Failed saves are reported honestly.

## 7. Architecture
Chrome speech recognition → deterministic Hindi/Hinglish/English parser (optional AI fallback) → explicit dialogue state machine → SQLite ledger → spoken reply. Speech in/out and the AI provider are replaceable layers. Starts with `docker compose up`, no keys.

## 8. Languages and roadmap
Today: Hindi/Hinglish, English (full). Kannada, Tamil, Telugu, Marathi: recognition path present, understanding via optional AI. Next: native-script replies, regional number words, noise-robust cloud speech recognition, on-device models.

## 9. Market and users
Primary users: small kirana owners in Tier 2/3 towns and villages. Adjacent: other credit-based micro-retailers (tailors, dairy, medical stores). Size the serviceable market from a **[verify]** store count × share with smartphone and recurring udhaar.

## 10. Dependencies and costs
- Runtime: Node.js, SQLite (embedded), a browser with speech recognition (Chrome).
- Optional: Gemini or Anthropic API for AI enhancement. Typical cost is a fraction of a rupee per utterance **[measure before quoting]**.
- Hosting: one small container; storage is a single SQLite file.

## 11. Risks and honest limits
- Speech accuracy in noisy shops and with names; mitigated by read-back, clarification and button fallbacks.
- Browser speech recognition depends on Chrome and internet.
- Prototype: single shop, no authentication or backups yet.
- Regional-language understanding needs the AI layer and native-speaker validation.

## 12. Go-to-market
1. Pilot with 10 to 20 shops through a distributor or a local shop-owner network.
2. Free for the shopkeeper; learn from real udhaar workflows and noise conditions.
3. Add WhatsApp reminders (deliberately out of scope for the prototype), then a low-price subscription or distributor-sponsored model.
4. Expand language by language using the modular language configuration.

## 13. The ask / next steps
Native-speaker testing in three languages, a field pilot, and noise-robust speech recognition.
