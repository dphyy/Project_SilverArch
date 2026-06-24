# `src/services/`

Provider adapters and side-effectful services.

- `env.mjs` loads local `.env` values.
- `asr.mjs` normalizes transcription output from MERaLiON and ElevenLabs.
- `translation.mjs` handles translation fallback and mixed-language placeholder handling.
- `evidence-extractor.mjs` runs AI-first evidence extraction, then deterministic fallback/safety supplementation.
- `report-drafter.mjs` drafts report sections through MERaLiON first, then OpenAI fallback.
- `report-renderer.mjs` renders finalized reports to DOCX/PDF locally.

Provider order:

1. ASR: MERaLiON → ElevenLabs.
2. Translation: MERaLiON → Google Cloud Translation.
3. Evidence: OpenAI exact-quote extraction → deterministic fallback/safety rules.
4. Report drafting: MERaLiON → OpenAI.

Never expose secret values in browser responses or reports. Use capability states instead.

