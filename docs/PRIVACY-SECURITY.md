# Privacy and security notes

Khata Bol is a **hackathon prototype with an anonymous demo-session model. It is not production authentication and not ready for real merchants' money records.**

## Where data goes
| Data | Goes to | Stored? |
|---|---|---|
| Your voice (default) | Chrome's built-in speech recognition, which sends audio to Google | Not by Khata Bol. Google's handling is under Google's terms. Needs internet; there is no offline recognition |
| Your voice (optional, only if `GEMINI_API_KEY` is set) | This server, which forwards it once to Google Gemini for transcription | **No.** Held in memory for the request, never written to disk |
| The recognised sentence | This server | Yes, as `said` in the audit log of the entry it created (for troubleshooting). Removed when the demo shop is reset or pruned (14 days idle) |
| The sentence, only if it could not be parsed locally AND an AI key is set | The configured AI provider (Anthropic or Gemini) | The provider's policy applies. **Only that one sentence is sent: never customer names from your ledger, balances or history.** The AI's guess still needs a confirmed read-back and cannot write anything itself |
| Customers, entries, balances | SQLite on the server (`KHATA_DB`) | Yes. Not encrypted at rest; no automatic backups |

No API key is ever sent to the browser (`/api/config` returns only yes/no flags).

## Session model (important)
- Each browser creates a random id (`localStorage`) and the server gives it a private demo shop. Anyone who has that id can use that shop. There are no accounts, passwords or recovery.
- Ledger, history, reversal, reset and conversation state are all scoped by that id on the server; tests check that one visitor cannot read, reverse or reset another's data.
- **Not** production authentication. A real deployment needs sign-in (for example OTP), encryption at rest, backups, an audit-log export, and a data-protection review (including India's DPDP Act obligations).

## Controls in place
- All SQL is parameterised (a test fails if any query interpolates values).
- Money is integer paise; entries are immutable (database triggers); the idempotency key is a database UNIQUE constraint; mistakes are linked reversals; reset works only on a demo shop and only for the caller.
- Requests are validated (session id format, action whitelist, language tags, ids, 16 KB body limit, 500-character sentences); malformed input returns a clean JSON error.
- Rate limits: 120 requests/minute per session (500 per IP) and 20 audio uploads/minute per session; `/health` is never limited.
- Security headers: Content-Security-Policy (same-origin scripts and connections), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`.
- Secrets live only in environment variables and `.env` (git-ignored).

## Reminders, reports and dictation
- Reminders hold the customer, due date/time, optional expected amount, priority and an optional note, in the same SQLite database, scoped to the visitor's own shop and removed with it (reset or 14-day prune).
- Reports are computed on request from stored rows. Nothing is sent to an AI provider.
- Notifications are in-app (and browser notifications only while the app is open and permission was granted). No customer is ever contacted automatically; the shopkeeper copies or shares a message by hand.
- Dictated text (for example from Wispr Flow) is ordinary typed input as far as Khata Bol is concerned. Whatever dictation tool the user runs has its own privacy terms.

## Known limitations
- Limits are in memory (reset on restart; per process). One instance only (SQLite single writer).
- Chrome's speech recognition and the transcripts' presence in the audit log are real privacy trade-offs for a demo; say so when presenting.
- No offline mode: if the connection drops the app says so and saves nothing.
