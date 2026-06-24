# `src/domain/`

Deterministic domain logic for SilverArch.

These modules should be easy to test without network access:

- `time-gate.mjs` — Singapore hotline operating-hours logic.
- `contact.mjs` — Singapore callback number validation and masking.
- `audio.mjs` — byte-range parsing for audio playback.
- `evidence.mjs` — rule-based evidence extraction and caller rundown construction.
- `facts.mjs` / `numbers.mjs` — typed fact extraction and spoken-number parsing.
- `triage.mjs` — scheme shortlist logic, hard ceilings, missing facts and appeal context.
- `urgency.mjs` — independent safeguarding/urgency screen.
- `pii.mjs` — PII proposal detection.
- `report.mjs` — report readiness, report model, report evidence dedupe and review council.
- `guided-intake.mjs` — shared guided-intake helpers.

Design rule: domain logic may be conservative, but it should not fabricate facts. Unknowns should remain explicit for officer review.

