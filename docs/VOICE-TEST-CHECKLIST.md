# Manual voice test checklist (real microphone)

Automated tests and a simulated-recognizer run prove the logic and the listen → speak → listen loop. They **cannot** prove real microphone capture, recognition accuracy, or that a device speaks the reply. Run this once on each device you will demo on.

**Setup:** Chrome (desktop or Android), https or `http://localhost`, volume up, quiet room first. Press **Reset demo data**. Ramesh must show ₹0.

## A. Journey (must pass)
| # | Action | Expected |
|---|---|---|
| 1 | Touch the page once (not the mic) | Spoken greeting: "Namaste. Khata Bol mein aapka swagat hai…" |
| 2 | Tap mic; Chrome asks for the microphone → **Allow** | Orb turns red, ripples, live words appear |
| 3 | Say "Ramesh ko paanch sau udhaar diye" | "You said" card shows your words; card +₹500 (Balance ₹0 → ₹500); spoken "…500 rupaye udhaar add karun?" |
| 4 | Do **not** touch anything | After the voice stops, the mic reopens by itself (listening state) |
| 5 | Say "Haan, save kar do" | Saved once; spoken "Ho gaya… total balance 500 rupaye hai" |
| 6 | Tap mic, say "Ramesh ne do sau wapas diye", then "Haan" | "Payment record ho gayi. Ramesh ke 300 rupaye baaki hain." |
| 7 | Tap mic, say "Ramesh ka kitna baaki hai?" | Spoken: 300 rupaye |
| 8 | Tap mic, say "Ab kitna baaki hai?" | Same answer (remembers Ramesh) |

## B. Echo and interruption
- During step 3's spoken question, the transcript must **not** contain Khata Bol's own sentence. If it does, increase speaker distance or use headphones, and note the device.
- Tap the mic while Khata Bol is speaking: speech stops and it listens.
- Tap **Confirm** while it is still speaking: saves once.

## C. Corrections and safety
| Say | Expected |
|---|---|
| "Ramesh ko paanch hazaar udhaar diye" | Card flagged **Large amount**; spoken warning |
| then "Nahi, paanch sau" | "Samajh gaya… 500 rupaye…"; nothing saved yet |
| "Cancel karo" | Cancelled, balance unchanged |
| "Rameshwr ko do sau udhaar diye" | "Aap Ramesh ki baat kar rahe hain ya Rameshwar ki?" (two buttons); say "Rameshwar" |
| Stay silent for ~8 s when asked a question | "Maaf kijiye, dobara boliye." then listens again once |
| Mumble or speak in loud noise | Words shown; if Chrome is unsure it asks you to repeat instead of guessing |
| "Pichhli entry galat thi" → "haan" | Reversal added; original stays in history, marked reversed |

## D. Failure handling
- Block the microphone (lock icon → Microphone → Block), tap mic: clear instructions appear; allow and reload fixes it.
- Turn off Wi-Fi, then speak a command: "server se connect nahi ho paaya. Kuch save nahi hua." plus **Try again**; nothing is saved. Turn Wi-Fi on, tap **Try again**: it works once.
- Open the site in a second browser profile: it starts at its own ₹0 demo (visitors are separate).

## E. Languages
- Hindi/Hinglish and English: the whole table above.
- Kannada (beta): select ಕನ್ನಡ, say "ರಮೇಶ್ ಗೆ ಐನೂರು ರೂಪಾಯಿ ಸಾಲ ಕೊಟ್ಟೆ", then "ಹೌದು". **Record what happens**: whether Chrome recognises Kannada on your device, whether the numbers parse, and whether a Kannada voice speaks the reply (otherwise replies are Hinglish). Do not describe Kannada as supported until a Kannada speaker has checked it.

## Record results
Device, browser version, Pass/Fail per row, any mis-heard words. Keep this for the demo video and the README's "verified" section.
