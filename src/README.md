# `src/`

Application logic lives here.

- `domain/` contains deterministic, mostly pure business logic.
- `services/` contains adapters for external providers and document generation.

The server imports these modules from `server.mjs`. Browser code should not import from `src/` directly.

Keep this split clear:

- Put rules, parsing, triage, report models and validation in `domain/`.
- Put API calls, environment handling, ASR, translation, evidence-model calls and renderers in `services/`.

