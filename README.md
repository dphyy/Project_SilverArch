# 🏛️ SilverArch

**After-hours voice intake for public and social services — with AI assistance, timestamped evidence, and human escalation kept firmly in the loop.**

SilverArch is an MVP/demo system for the challenge:

> **Public services that do not sleep — How might we build AI assistants that make public or social services easier to access, while preserving human escalation?**

It simulates an after-hours ComCare-style intake flow where a citizen leaves a voice account, the system transcribes and analyses the call, and an officer reviews evidence-linked triage before generating an editable supporting report.

SilverArch does **not** determine eligibility. It helps an officer understand, verify, and follow up.

---

## ✨ What it demonstrates

### For citizens

- Singapore-time hotline gate: live-hours redirect, after-hours recording.
- Consent-first voice intake.
- English, Mandarin Chinese, Malay and Tamil citizen interface.
- Citizens may speak in the language or dialect they are most comfortable with, and may mix languages naturally in one call.
- Browser read-aloud with an ear icon for page instructions.
- Recording review and re-record before submission.
- Required Singapore callback number collection for SSO follow-up.

### For officers

- Auto-seeded demo MP3 cases for repeatable video demos.
- MERaLiON-first transcription with ElevenLabs Scribe fallback.
- MERaLiON-first translation with Google Cloud Translation fallback.
- AI-first evidence highlighting with exact quote/timestamp validation.
- Clickable transcript evidence that replays audio from the source sentence.
- Caller rundown, review flags, urgency/safeguarding signals and missing facts.
- Scheme shortlist capped to top 3, including ComCare and AIC referral considerations.
- “Review council” panel that separates scheme fit, safeguarding, missing information and referral opportunities.
- Reanalyse audio button to rerun latest ASR, translation, evidence, triage and report-readiness logic.
- Editable supporting report drafts with DOCX/PDF export.

---

## 🧭 Product principles

SilverArch is intentionally built around these boundaries:

1. **Human escalation stays central.** AI prepares evidence and questions; officers decide what to do.
2. **Triage is not eligibility.** Scheme matches are referral/review considerations only.
3. **Evidence must be traceable.** Highlights must map back to exact transcript words and audio timestamps.
4. **Uncertainty must be visible.** Mixed-language gaps, missing facts, low confidence, urgent risk and PII review are shown separately.
5. **No fabrication.** If ASR cannot transcribe foreign-language speech, SilverArch shows `[foreign language]` and flags it for review.

---

## 🧱 System at a glance

```text
Citizen web flow
  ↓
Local Node server
  ↓
ASR: MERaLiON → ElevenLabs
  ↓
Translation: MERaLiON → Google Translate
  ↓
Evidence: OpenAI exact-quote extraction → deterministic fallback/safety rules
  ↓
Triage, urgency, PII proposals, caller rundown
  ↓
Officer dashboard
  ↓
Editable report draft → finalized DOCX/PDF
```

The whole MVP runs as a local Node app. Runtime case data lives under `data/` and is suitable for fictional/demo data only.

---

## 🚀 Quick start

Requires **Node.js 20+**.

```sh
npm install
npm test
npm run dev
```

Open:

- Citizen intake: `http://localhost:3000`
- Officer dashboard: `http://localhost:3000/officer.html`

On startup, the server auto-seeds four tracked MP3 demo calls from `demo/audio/` into the officer queue.

---

## 🔐 Provider configuration

Create `.env` from `.env.example` and add the keys you want to use.

```dotenv
MERALION_API_URL=
MERALION_API_KEY=
MERALION_TRANSLATION_MODEL=MERaLiON/MERaLiON-3-10B
MERALION_TIMEOUT_MS=30000

ELEVENLABS_API_KEY=
ELEVENLABS_STT_MODEL=scribe_v2

GOOGLE_TRANSLATE_API_KEY=
GOOGLE_TRANSLATE_ENABLED=true
GOOGLE_TRANSLATE_TARGET_LANG=en
GOOGLE_TRANSLATE_TIMEOUT_MS=30000

OPENAI_API_KEY=
OPENAI_EVIDENCE_MODEL=gpt-4.1-mini
OPENAI_REPORT_MODEL=gpt-5.4-mini
```

Restart `npm run dev` after changing `.env`.

Secrets are read only by the server and are never exposed through `/api/status`; that endpoint returns safe capability states only.

---

## 🤖 Provider flow

| Capability | Primary | Fallback | Notes |
|---|---|---|---|
| ASR | MERaLiON | ElevenLabs Scribe v2 | Preserves provider attribution and fallback reason. |
| Translation | MERaLiON | Google Cloud Translation | Translates timestamped transcript sentences, not raw audio. |
| Evidence highlighting | OpenAI | Deterministic rules | AI evidence must quote exact transcript text to become a highlight. |
| Report drafting | MERaLiON | OpenAI | Draft remains editable before finalization. |
| DOCX/PDF | Local libraries | None | Uses `docx` and `pdfkit`; no report rendering API. |

If mixed-language audio is detected but ASR cannot transcribe a segment, the transcript keeps a visible `[foreign language]` placeholder and raises an officer review flag.

---

## 🖥️ Demo flow

1. Run `npm run dev`.
2. Open the officer dashboard.
3. Four demo audio cases should appear automatically:
   - English + Chinese mixed-language, showing that callers do not need to stick to one language or dialect
   - English with AIC referral signals
   - Malay long-form testimony
   - Tamil safeguarding-risk testimony
4. Open a case and inspect:
   - selected queue card state;
   - audio playback;
   - highlighted transcript evidence;
   - review flags;
   - caller rundown;
   - shortlist and AIC referrals;
   - callback script;
   - report readiness checklist.
5. Use **Reanalyse audio** after code changes to refresh an existing case without re-recording.
6. Complete officer checks and generate an editable supporting report.

---

## 📁 Repository map

```text
.
├── public/          Browser UI for citizen, officer and report pages
├── src/domain/      Deterministic business/domain logic
├── src/services/    External provider adapters and document rendering
├── data/            Runtime local demo storage and scheme catalogue
├── demo/audio/      Tracked MP3 demo cases
├── test/            Node test suite
├── scripts/         Utility scripts
└── server.mjs       Local HTTP server and API routes
```

Folder-level READMEs provide more detail inside each major area.

---

## 🧪 Testing

```sh
npm test
```

The test suite covers:

- time gate behavior;
- ASR provider fallback;
- translation fallback;
- evidence extraction and timestamp mapping;
- mixed-language placeholder handling;
- urgency categories;
- triage constraints;
- report readiness;
- report evidence deduplication;
- DOCX/PDF generation.

---

## ⚠️ Safety and deployment boundary

SilverArch is a local MVP/demo, not a production case system.

- Local `data/` storage is not production-secure.
- Demo phone numbers and cases are fictional.
- No real telephony, authentication, agency integration or production case writes are included.
- Automatic PII redaction proposals require officer confirmation.
- Scheme triage needs domain validation before any real-world pilot.
- Urgent-risk guidance supports escalation; it does not replace emergency services or professional judgement.

---

## 🛣️ Recommended next steps

1. Validate MERaLiON ASR/translation behavior on non-sensitive multilingual recordings.
2. Review all scheme records and hard/flexible criteria with domain practitioners.
3. Add authentication, encrypted storage, retention controls and audit access controls.
4. Run accessibility and multilingual usability testing.
5. Integrate real telephony only after governance, consent, security and escalation processes are defined.
