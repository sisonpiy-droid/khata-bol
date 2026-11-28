# API reference

Base URL: the same origin as the app. Every `/api` call needs an `x-session` header: 8 to 64 characters from `A-Z a-z 0-9 _ -`. It selects the caller's private shop, and every response is scoped to it. Request bodies are JSON, limited to 16 KB (8 MB for `/api/transcribe`). Errors are `{ "error": "message" }` with an HTTP status.

Rate limits: 120 requests per minute per session, 500 per IP, 20 audio uploads per minute per session (`429` when exceeded).

## Health and configuration

| Method and path | Returns |
|---|---|
| `GET /health` (also `/api/health`) | `{ ok, persistent }`. Not rate limited. |
| `GET /api/config` | `{ shop, owner?, demo, ai, stt }`. Only yes/no flags; no key is ever sent to the browser. |

## Shop and ledger

| Method and path | Purpose |
|---|---|
| `GET /api/state` | Shop, stats, customers (with balance and last activity), recent entries, today's totals and the daily report. |
| `GET /api/history?customerId=` | Up to 100 entries, newest first, for the caller's shop only. |
| `POST /api/new-account` | `{ owner, shop }`. Deletes the sample data and turns the visitor's demo shop into their own empty shop. `409` if it is already a real shop. |
| `POST /api/reset-demo` | Restores the sample data. `403` on a real shop. |

## Conversation

| Method and path | Purpose |
|---|---|
| `POST /api/converse` | The voice and text pipeline. Body: `{ text }`, or `{ action, pid, ... }` for button answers (`confirm`, `cancel`, `choose`, `option`, `greet`, `reverse`, `briefing` and similar). Returns `{ say, card, state, expect, pid }`. Nothing is saved until a confirm that carries the current `pid`. |
| `POST /api/transcribe` | `{ audio }` base64. Optional Gemini transcription when a key is set. The audio is held in memory for the request and never stored. |

## Reports

| Method and path | Purpose |
|---|---|
| `GET /api/reports/daily?date=YYYY-MM-DD` | Credit given, payments received, net change, outstanding, customers with dues, due today, overdue, next seven days. |
| `GET /api/reports/weekly` | Rolling seven days: totals, top customers, overdue, reminders completed, collection performance. |

## Reminders (payment commitments)

| Method and path | Purpose |
|---|---|
| `GET /api/followups?status=open|completed|cancelled|all&sort=due|amount|priority` | List with computed urgency (`overdue`, `due_today`, `upcoming`). |
| `POST /api/followups` | Create. `{ key, customerId, dueDate, dueTime?, amountPaise?, priority?, note? }`. Duplicates and past dates are refused. |
| `POST /api/followups/:id/update` | Reschedule or change priority, amount or note. |
| `POST /api/followups/:id/complete` | Mark done. |
| `POST /api/followups/:id/cancel` | Cancel. |
| `GET /api/followups/:id/history` | Status history. |
| `GET /api/notifications/due` | What is due now and has not been delivered. |
| `POST /api/notifications/ack` | `{ commitmentId, key }`. Records delivery once; repeats are ignored. |

Reminders never change a balance. Only confirmed credit, payment and reversal entries do.
