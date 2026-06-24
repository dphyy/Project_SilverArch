# `test/`

Node test suite.

- `domain.test.mjs` covers deterministic domain behavior: time gate, evidence, urgency, contact validation, triage and byte ranges.
- `providers.test.mjs` mocks external providers: MERaLiON, ElevenLabs, Google Translation and OpenAI evidence extraction.
- `report.test.mjs` covers report readiness, report models, evidence dedupe, review council and DOCX/PDF rendering.

Run:

```sh
npm test
```

Tests should avoid real network calls and should use mocked provider responses.

