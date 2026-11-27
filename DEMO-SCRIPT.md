# Three-minute demo script

Setup: Chrome, microphone allowed, `docker compose up` (or `npm run dev`), open the app, press **Reset demo data** (it restores Ramesh at ₹0 and the synthetic follow-ups: Suresh overdue, Kavita due today, Rameshwar upcoming). Quiet room, volume up. The **Try saying** chips and the text box run the same pipeline if the room is too loud.

Say "kal" (tomorrow) for the due date, not a weekday: if today happens to be that weekday the app rightly asks "today or next week?" instead of guessing, which is a good moment to show but not for the main story.

| Time | Say / do | What the judges see and hear |
|---|---|---|
| 0:00 | Open the app. Touch the page once. | Greeting; banner "Payment due: Suresh, Kavita"; Collections card; "Reminders" badge |
| 0:10 | One line: "Kirana shopkeepers lose money because udhaar lives in notebooks and memory. Khata Bol remembers it, and reminds them." | Dashboard: outstanding, due today, overdue |
| 0:20 | Tap the mic: **"Ramesh ko paanch sau rupaye udhaar diye."** | Transcript, confirmation card, spoken read-back |
| 0:35 | The mic reopens by itself: **"Haan."** | Saved, balance ₹500 |
| 0:45 | **"Ramesh ne do sau rupaye wapas diye."** then **"Haan."** | "Payment record ho gayi. Ramesh ke 300 rupaye baaki hain." |
| 1:05 | **"Ramesh ka kitna baaki hai?"** | Spoken ₹300 from the stored ledger |
| 1:15 | **"Iski payment kal ko due hai."** (context: *iski* = Ramesh) | "Ramesh ki payment ka reminder <tomorrow's date> ke liye set karun?" with the real date. **"Haan."** |
| 1:35 | **"Isko high priority kar do."** then **"Haan."** | Priority changes only after the yes |
| 1:50 | **"Kal kaunse payments due hain?"** | Spoken: Ramesh 300 rupaye (high priority) |
| 2:05 | **"Aaj ka hisaab batao."** | "Aaj aapne 500 rupaye udhaar diye aur 200 rupaye ki payment receive hui. 1 customers ki payment aaj due hai. 1 payments overdue hain." |
| 2:25 | Open **Reports → Weekly** | Cards from real rows: credit, repayments, net change, who owes most, overdue, collection performance; date range; Refresh; last updated |
| 2:40 | The "never guess" moment: **"Ramesh ne 200 diye."** | "Payment mili ya udhaar diya?" with two buttons: it will not assume a repayment |
| 2:50 | Tap **Hear today's briefing**; open **Reminders** | Short spoken briefing; due / overdue / upcoming groups; "Complete", "Reschedule", "Copy message" |

Close: "Speak, confirm, saved, reminded. Hindi and English today, Kannada in beta. Run it with docker compose up, no keys."

## If something goes wrong
- Mic blocked: lock icon → Microphone → Allow → reload. Or use the text box / chips.
- Mishears: say it again; the pending entry is never lost. A wrong amount: "Nahi, paanch sau nahi, teen sau" corrects it.
- State drifted: **Reset demo data** restores the starting point.
- Browser notifications: optional and only work while the app is open; the Reminders screen always lists what is due.
- Do not claim Wispr Flow powers the app's microphone (see [WISPR-FLOW-WORKFLOW.md](WISPR-FLOW-WORKFLOW.md)).
