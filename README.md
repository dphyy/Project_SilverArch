# SilverArch

An after-hours ComCare voice-intake MVP with a real Singapore-time gate, explicit consent, browser audio capture, MERaLiON-first/ElevenLabs-fallback transcription, deterministic triage scaffolding, safety routing, and a human review queue.

## Run

Requires Node.js 20 or later. There are no third-party dependencies.

```sh
npm test
npm run dev
```

Open `http://localhost:3000`. Use the **2am · after hours** demo control to exercise recording, then open the Officer view.

## Configure ElevenLabs

Open `.env` and paste your key after the equals sign:

```dotenv
ELEVENLABS_API_KEY=your_real_key_here
ELEVENLABS_STT_MODEL=scribe_v2
```

Restart `npm run dev` after changing `.env`. The key is read only by the Node server; it is never sent to the browser. `.env` is ignored by Git, while `.env.example` documents the required variables safely.

## Key features

### Honest time gate

The server and client independently enforce ComCare's 7am–midnight Singapore hotline window. During operating hours, recording is blocked and the citizen is directed to the live hotline. The visible demo clock exercises both branches without changing production logic.

### Provider-independent transcription

`src/services/asr.mjs` always attempts the MERaLiON provider first. Only an error or timeout activates ElevenLabs Scribe v2. The normalized result stores provider attribution, fallback reason, detected language, word timestamps, and explainable low-confidence flags.

### Safety and privacy signals

Urgency screening is a separate, priority pass and immediately shows the citizen an existing 24-hour resource when risk language is detected. NRIC/FIN and phone matches are proposals only; officers must verify them.

### Conservative scheme triage

The triage layer shortlists up to three structured schemes. It keeps missing hard-ceiling facts explicit, treats hardship as appeal context, and never represents its output as an eligibility decision. The current text rules are deterministic MVP scaffolding, not a validated social-service assessment model.

### Evidence-linked officer review

The dashboard sorts urgent and waiting cases, displays independent review reasons, and makes timestamped transcript words clickable so an officer can jump to the supporting audio. Accept, escalate, and keep-in-review decisions persist and append an audit event.

Important phrases are marked by category—personal details, income/employment/housing, health/wellbeing, and family/care/education. Every marker retains its source word range and audio timestamps. A caller rundown beneath the transcript quotes the extracted characteristics and lists core details the officer still needs to ask for.

## Current boundary

- MERaLiON remains a stub until endpoint details are supplied. ElevenLabs Scribe v2 is the working fallback when `ELEVENLABS_API_KEY` is set.
- Triage rules are intentionally conservative and need validation by ComCare-domain practitioners before any real-world use.
- Cases and audio are stored locally under `data/` and are not production-secure storage.
- Officer action buttons are visual placeholders in this foundation.

## Suggested next milestone

1. Add the ElevenLabs key and run fixed clear/noisy/Singlish test recordings.
2. Obtain MERaLiON endpoint credentials and implement the primary provider.
3. Expand typed fact extraction for age, enrolment, institution type and household composition.
4. Add officer editing for transcripts, redaction proposals and triage reasoning.
5. Move audio/cases from local files to encrypted storage and authenticated officer access.
