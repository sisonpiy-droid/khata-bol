# Three-minute demo script

Setup: Chrome, microphone allowed, `docker compose up` (or `npm run dev`), open the app, press **Reset demo data**. Ramesh starts at ₹0. Quiet room, laptop volume up. Keep the **Try saying** chips as your fallback; they run the same pipeline as text.

| Time | Say / do | What the judges see and hear |
|---|---|---|
| 0:00 | Touch the page once. | Khata Bol greets: "Namaste. Khata Bol mein aapka swagat hai. Aaj kya entry karni hai?" |
| 0:10 | One line to camera: "Kirana shopkeepers record udhaar in paper notebooks while serving customers. Typing is not an option, speaking is." | Dashboard: shop, total outstanding, customers with dues. |
| 0:25 | Tap the mic: **"Ramesh ko paanch sau rupaye udhaar diye."** | Live waveform, the transcript, a confirmation card (+₹500, balance ₹0 → ₹500), spoken "…500 rupaye udhaar add karun?" |
| 0:50 | The mic reopens by itself. Say **"Haan."** | Spoken "Ho gaya… total balance 500 rupaye hai." Saved card, outstanding goes up, entry appears in Recent. |
| 1:15 | Tap the mic: **"Ramesh ne 200 rupaye wapas diye."** then **"Haan."** | "Payment record ho gayi. Ramesh ke 300 rupaye baaki hain." |
| 1:45 | **"Ramesh ka kitna baaki hai?"** | Spoken answer from the stored ledger: 300. Then say **"Ab kitna baaki hai?"** to show it remembers Ramesh. |
| 2:05 | The intelligent moment: **"Rameshwr ko do sau rupaye udhaar diye."** (or a wrong amount, then **"Nahi, paanch sau nahi, teen sau"**; or **"Ramesh ne 200 diye"**, which it refuses to guess) | "Aap Ramesh ki baat kar rahe hain ya Rameshwar ki?" with two buttons. Say **"Rameshwar."** Amount and type are kept; confirm. |
| 2:30 | **"Nahi, 300 rupaye."** on any pending entry (or "Cancel karo") | Amount corrected on the card, nothing saved until "haan". |
| 2:40 | Open **Customers**, tap Ramesh. | Full history with running balance, nothing deleted. Show the reverse button and a reversal if time allows. |
| 2:50 | Close: "Speak, confirm, saved. Hindi and English today, Kannada and more next. docker compose up, no keys." | Dashboard with updated numbers. |

## If something goes wrong
- Mic blocked: click the lock icon in the address bar, allow Microphone, reload.
- Recognition mishears: say it again, or tap a "Try saying" chip. The pending entry is never lost.
- No sound: check the laptop volume. Replies are also shown as text.
- State drifted: **Reset demo data** restores the starting point.
