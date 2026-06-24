# `demo/`

Tracked demo assets for repeatable presentations.

`audio/` contains four MP3 calls:

- `test1-en-zh.mp3` — English + Chinese mixed-language case.
- `test2-en.mp3` — English case with AIC referral signals.
- `test3-ms.mp3` — Malay long-form case.
- `test4-ta.mp3` — Tamil safeguarding-risk case.

The mixed-language demo is intentionally included to show that citizens do not need to stick to one language or dialect. They can speak naturally, and SilverArch will preserve what ASR can transcribe while flagging any `[foreign language]` gaps for officer review.

On startup, `server.mjs` seeds these into the officer queue with stable case IDs. Use **Reanalyse audio** in the officer dashboard after code changes to refresh ASR, translation, evidence, triage and report-readiness without replacing the MP3s.
