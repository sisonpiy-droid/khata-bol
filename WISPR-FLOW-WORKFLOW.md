# Wispr Flow: workflow and integration status

This document separates **facts** from **things you still need to record**. Nothing here is invented: where the team has to fill in real usage, the field says so.

## 1. Integration status (verified 27 November 2026)

| Question | Answer |
|---|---|
| Does Wispr Flow publish an official developer API? | **Yes.** Docs: [api-docs.wisprflow.ai](https://api-docs.wisprflow.ai/) (REST with API key, REST with client-side auth, WebSocket). Spec: `POST https://platform-api.wisprflow.ai/api/v1/dash/api` with base64 16 kHz WAV audio |
| Can this project use it today? | **Not verified, so not integrated.** The official quickstart says the API is "only available by exclusive access" and the organisation "must be approved by the Flow team" ([quickstart](https://api-docs.wisprflow.ai/quickstart.md)). We have no approved credentials |
| Is there an official SDK? | Not found. A community package ([wisprflow-sdk](https://github.com/ThisisShashwat/wisprflow-sdk)) exists but reverse-engineers the desktop app, so it is **not used** here |
| Does Khata Bol use Wispr Flow's transcription engine? | **No.** Khata Bol's own microphone uses the browser's speech recognition (Chrome), or optional Gemini audio if a key is set. No Wispr Flow credentials, endpoints or private APIs are used anywhere in the code |
| What does exist for Wispr Flow users? | An optional, clearly labelled **dictation field** on the home screen ("Dictate with Wispr Flow (optional)"). It is an ordinary text box. If you have Wispr Flow installed you can click it and dictate with your own Wispr Flow shortcut; Khata Bol reads the resulting text through the same interpretation and confirmation pipeline. It cannot tell which tool produced the text, never saves anything without a confirmation, and labels the input "You dictated". |

If the team obtains approved API access, the adapter belongs server-side next to `server/llm.js` (`transcribe()`), with the key in an environment variable, 16 kHz WAV conversion in the browser, and the same optional/fallback behaviour as the Gemini recognizer. That work is **not done** and must be verified with real credentials before anything claims it.

## 2. Using Wispr Flow while building (to be completed by you)

An AI assistant cannot operate Wispr Flow, so I cannot document your usage for you. Complete the fields below from what you actually did, then delete this notice.

- Team member(s) who used Wispr Flow: _______________
- Device / OS / Wispr Flow version: _______________
- Dates used: _______________
- Where it was used (coding terminal, AI coding assistant, GitHub, docs, chat): _______________

### Tasks done by dictation (tick only what is true)
- [ ] Wrote or refined product requirements / prompts for the coding assistant
- [ ] Dictated bug reports and test scenarios (for example "Ramesh ne 200 diye" ambiguity)
- [ ] Dictated documentation or README sections
- [ ] Dictated iteration instructions ("make the mobile layout simpler")
- [ ] Other: _______________

### Dictated prompts (paste the exact text Wispr Flow produced)
1. _______________
2. _______________
3. _______________

> Suggested prompt to dictate and record, since it exercises Hinglish names: *"Add a reminder flow where Ramesh ko Friday tak payment leni hai asks for confirmation before saving."* Use your real dictation, not this text, as the evidence.

### What it helped, and what did not (your honest notes)
- Helped with: _______________
- Limitations I hit (accuracy on Hinglish/names, dictating into the terminal, punctuation, latency, privacy): _______________
- Rough time comparison, only if you measured it: _______________

## 2b. A ten-minute dictation session that produces real evidence

These are genuine, useful tasks for this project. Dictate each one with Wispr Flow into your coding assistant, let it do the work, and keep the screen recording. The prompts below are suggestions to read aloud in your own words; the evidence is what you actually say and what Wispr Flow actually produces.

1. **Feature request (Hinglish names on purpose):** "On the Customers screen, add an Export button that downloads all customers and their balances as a CSV file. Ramesh and Rameshwar should both appear."
2. **Bug report / test scenario:** "Add a test for this case: the shopkeeper says Ramesh ne 200 diye, so the direction is unclear. The app must ask whether it was a payment or credit, and it must save nothing until the shopkeeper chooses."
3. **Documentation:** "Add a short section to the README explaining what happens when a hosted demo shop is cleared after a server restart."
4. **Iteration instruction:** "Make the Reminders screen simpler for an older shopkeeper on an Android phone: bigger buttons and fewer labels."

After each one, note in section 2 above: the exact text Wispr Flow produced, anything it got wrong (names such as Ramesh, Rameshwar, Kavita; Hinglish words), and the time it took compared with typing, only if you measured it.

For the product side, also dictate this into the **Dictate with Wispr Flow (optional)** field on the home screen and record the confirmation card appearing: "Ramesh ko paanch sau rupaye udhaar diye".

## 3. Evidence checklist for the submission

Do these yourself and keep the files; do not describe evidence you do not have.

1. Install Wispr Flow on the laptop you build on and enable it for your terminal and coding assistant.
2. **Screen-record 60 to 90 seconds** of dictating a real prompt into your coding assistant with Wispr Flow (show the Wispr Flow indicator, the dictated text appearing, and the assistant's response).
3. Open Wispr Flow's history and **screenshot** the entries for that session (hide anything private).
4. Dictate one bug report and one test scenario the same way; save the text and a timestamp.
5. Record a short clip of the **Khata Bol dictation field**: click "Dictate with Wispr Flow (optional)", dictate "Ramesh ko 500 rupaye udhaar diye", show the confirmation card appearing (and that nothing is saved until you confirm).
6. Note the date, device, app version, and any errors in section 2.
7. Put the recordings in a folder (for example `docs/wispr-evidence/`, not committed if they contain private data) and link them from this file.
8. In the demo video, say plainly: *Khata Bol's own microphone uses browser speech recognition; Wispr Flow was used to dictate development prompts and can be used in the optional dictation field.* Do not say Khata Bol uses Wispr Flow's engine.

## 4. Wording that is safe to use
- "We used Wispr Flow to dictate our development prompts and documentation." (only after you have real evidence)
- "Khata Bol also accepts text dictated with Wispr Flow through an optional dictation field."
- "Wispr Flow has an official developer API available by approval; we have not integrated it."
