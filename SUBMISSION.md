# Hackathon submission pack

Khata Bol (खाता बोल): a voice-first udhaar ledger and payment follow-up assistant for Indian kirana shopkeepers. Built for the Scaler × Wispr Flow India Runs on Voice Hackathon.

## What to submit

| Item | Where | Status |
|---|---|---|
| Source code | https://github.com/sisonpiy-droid/khata-bol | Ready |
| Live demo | https://khata-bol-umber.vercel.app (no login) | Ready. Data on the hosted demo is not permanent, see below |
| Run it yourself | `docker compose up`, then http://localhost:8787 | Written and reviewed; not run on the build machine (no Docker) |
| Demo video | Record from [DEMO-SCRIPT.md](DEMO-SCRIPT.md) (3 minutes) | **You** |
| Pitch deck | Content in [docs/PITCH.md](docs/PITCH.md) (market and cost figures marked "verify") | **You** to verify figures and design the slides |
| Wispr Flow evidence | [WISPR-FLOW-WORKFLOW.md](WISPR-FLOW-WORKFLOW.md) | **You**: only you can show real usage |

## One-minute path for a judge

1. Open the live link in **Chrome** and allow the microphone. (No account needed: it opens with sample data.)
2. Tap the green mic and say "Ramesh ko paanch sau rupaye udhaar diye". It reads the entry back. Say "haan".
3. Ask "Ramesh ka kitna baaki hai?", then "Aaj ka hisaab batao".
4. Say "Iski payment kal ko due hai", then open **Reminders** and **Reports**.
5. To try your own shop, tap **New account**, enter a name and shop name, and start from zero.

No microphone? The text box and the "Try saying" chips run the same pipeline.

## Claims we can make, and claims we cannot

| Safe to say | Do not say |
|---|---|
| Hindi/Hinglish and English work end to end with no API key | "Works in every Indian language" (Kannada is beta; Tamil, Telugu and Marathi need the optional AI key) |
| Nothing is saved without an explicit spoken or tapped yes; mistakes are linked reversals | "Production ready" or "secure for real merchants" (demo sessions, not authentication) |
| 105 automated tests, plus a smoke test that runs the demo story against the live site | "Real microphone accuracy is tested" (it has not been tested on a real microphone by the team) |
| Reminders and notifications while the app is open | "Notifications work when the website is closed" (no background scheduler) |
| Wispr Flow was used to dictate development prompts (only once you have the evidence) | "Khata Bol uses Wispr Flow's engine" (the official API is approval-only; not integrated) |

## Before you present (10 minutes)

- [ ] Run `npm run smoke -- https://khata-bol-umber.vercel.app`. All 12 checks should pass. It also wakes the server, so the first judge request is fast.
- [ ] Open the live link in Chrome, allow the microphone, and say one phrase end to end on the real device and network you will present on.
- [ ] Press **Reset demo data** so the sample shop is in its starting state.
- [ ] Volume up and a quiet room. The app waits a moment after it speaks before listening, but a loud room still hurts recognition.
- [ ] Use "kal" (tomorrow), not a weekday, for the reminder date. If today is that weekday the app correctly asks "today or next week?", which is a good moment to show but not for the main story.

## If something goes wrong

| Problem | What to do |
|---|---|
| Microphone blocked or mishears | Use the text box or a "Try saying" chip. Same pipeline, same confirmation step |
| Venue wifi is slow or down | Run locally: `npm install && npm run dev`, or `docker compose up`. Everything works offline except voice recognition itself (Chrome needs internet) |
| A shop you created has disappeared | The hosted demo keeps data on a temporary disk that resets when the server restarts. The app shows a notice and offers "Create shop again". For a permanent ledger use Docker or Railway ([RAILWAY.md](RAILWAY.md)) |
| Page looks out of date | Hard-refresh (Ctrl+Shift+R) |
| A judge asks about AI | AI is optional. The parser is deterministic; AI only suggests an interpretation of a sentence it could not parse, and it can never save anything on its own |

## Likely judge questions

- **Why not just let an LLM do it?** Money needs predictable behaviour. The parser is deterministic and tested; every entry is read back and confirmed; the AI is a fallback that cannot write.
- **What if the speech recogniser mishears an amount?** It reads "Ramesh ke 500 rupaye udhaar add karun?" back and waits. Large amounts get a second look, "nahi, 300" corrects it, and a wrong saved entry is undone with a linked reversal, never deleted.
- **How is it different from a notebook?** It answers "kitna baaki hai" instantly, reports the day and week, remembers promised payment dates and reminds you, and never loses an entry.
- **Why Hindi first?** Kirana owners already speak the entry aloud; typing on a small phone is the barrier.
- **What is next?** Permanent hosted database and phone-number sign-in, an always-on reminder scheduler, UPI payment links, more languages with native-speaker review.
