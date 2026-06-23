# SilverArch

An after-hours ComCare voice-intake MVP with a real Singapore-time gate, explicit consent, browser audio capture, MERaLiON-first/ElevenLabs-fallback transcription, deterministic triage scaffolding, safety routing, and a human review queue.

## Run

Requires Node.js 20 or later. Install the local document-generation dependencies once:

```sh
npm install
npm test
npm run dev
```

Open `http://localhost:3000`. Use the **2am · after hours** demo control to exercise recording, then open the Officer view.

## Configure providers

Open `.env` and paste your key after the equals sign:

```dotenv
ELEVENLABS_API_KEY=your_real_key_here
ELEVENLABS_STT_MODEL=scribe_v2
MERALION_API_URL=http://meralion.org:8010
MERALION_API_KEY=your_meralion_key_here
GOOGLE_TRANSLATE_API_KEY=your_google_translate_key_here
OPENAI_API_KEY=optional_openai_report_fallback_key
```

Restart `npm run dev` after changing `.env`. The key is read only by the Node server; it is never sent to the browser. `.env` is ignored by Git, while `.env.example` documents the required variables safely.

## Key features

### Honest time gate

The server and client independently enforce ComCare's 7am–midnight Singapore hotline window. During operating hours, recording is blocked and the citizen is directed to the live hotline. The visible demo clock exercises both branches without changing production logic.

### Provider-independent transcription

`src/services/asr.mjs` always attempts the MERaLiON provider first. Only an error or timeout activates ElevenLabs Scribe v2. The normalized result stores provider attribution, fallback reason, detected language, word timestamps, and explainable low-confidence flags.

Non-English testimony is translated to English through MERaLiON first, then Google Cloud Translation. Google translates timestamped transcript sentences rather than raw audio, so the dashboard preserves the original ASR timestamps while showing English underneath. Translation attribution or failure is recorded without exposing keys.

### Safety and privacy signals

Urgency screening is a separate, priority pass and immediately shows the citizen an existing 24-hour resource when risk language is detected. NRIC/FIN and phone matches are proposals only; officers must verify them.

### Conservative scheme triage

The triage layer shortlists up to three structured schemes. It keeps missing hard-ceiling facts explicit, treats hardship as appeal context, and never represents its output as an eligibility decision. The current text rules are deterministic MVP scaffolding, not a validated social-service assessment model.

### Evidence-linked officer review

The dashboard sorts urgent and waiting cases, displays independent review reasons, and makes timestamped transcript words clickable so an officer can jump to the supporting audio. Escalate and keep-in-review decisions persist and append an audit event.

Important phrases are marked by category—personal details, income/employment/housing, health/wellbeing, and family/care/education. Every marker retains its source word range and audio timestamps. A caller rundown beneath the transcript quotes the extracted characteristics and lists core details the officer still needs to ask for.

The citizen reviews or re-records audio before entering a required Singapore callback number. Officers see the full number only in the selected case. They can edit the verified transcript, summary, facts, shortlist reasoning and notes; confirm or reject PII proposals; and persist a review decision with an audit entry.

Use **Load demo fixtures** to add the seven fixed fictional cases and **Reset fixtures** to remove only those cases.

### Editable supporting reports

The citizen dashboard supports English, Mandarin Chinese, Malay and Tamil. Callers choose a language before consent; translated text appears throughout the web-call flow, and optional local MP3 prompt files can be placed under `public/audio/prompts/`. Missing prompt audio is ignored gracefully.

**Generate report** replaces the former Accept action. It remains disabled until the officer has entered their name, designation and SSO; reviewed the available audio/transcript/evidence; resolved PII proposals; acknowledged review flags where present; and signed the declaration. SilverArch then drafts the formal report sections automatically from the transcript, evidence, caller profile, shortlist and flags. A visible checklist identifies every missing item, and the server independently revalidates the gate.

Generated reports open on a dedicated editable page with the case audio and timestamped evidence alongside the draft. MERaLiON is used first for report drafting; OpenAI is used only as fallback when configured. Draft revisions autosave explicitly to `data/reports/`, finalized versions are immutable, and later edits create a new amended version. Finalized reports download as genuine A4 DOCX or PDF files generated locally with `docx` and `pdfkit`.

The output is a **SilverArch Supporting Case Report for SSO Review**, not a government-issued form. It contains no crest or claim of agency endorsement and continues to separate triage support from eligibility decisions.

## Safety boundary

- Triage rules are intentionally conservative and need validation by ComCare-domain practitioners before any real-world use.
- Cases and audio are stored locally under `data/` and are not production-secure storage.
- SilverArch supports triage, not eligibility. Real telephony, multi-agency integrations, production case writes, authentication and production storage are outside this MVP.

## Next production steps

1. Validate the hosted MERaLiON request/response contract, Google Cloud Translation key and optional OpenAI report fallback with non-sensitive recordings.
2. Run domain review of every hard ceiling, flexible criterion and safety phrase.
3. Add authenticated officer access, encrypted production storage and retention controls.
4. Conduct accessibility, multilingual and noisy-audio evaluation before any real caller pilot.
