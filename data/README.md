# `data/`

Local runtime/demo storage.

- `schemes.json` is the tracked scheme catalogue used by triage.
- `audio/` stores runtime copies of submitted or seeded recordings.
- `reports/` stores generated report drafts/finalized report JSON.
- `cases.json` is created at runtime and is intentionally not tracked.

This folder is for fictional/demo information only. It is not production-secure storage.

Demo MP3s are tracked under `demo/audio/`; on server startup, they are copied into `data/audio/` and processed like normal citizen recordings.

