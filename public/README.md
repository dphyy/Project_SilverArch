# `public/`

Browser-facing MVP screens.

- `index.html` + `citizen.js` — citizen web-call simulator.
- `officer.html` + `officer.js` — officer queue, case review, evidence playback and report generation gate.
- `report.html` + `report.js` — editable report draft/finalization page.
- `styles.css` — shared visual system for citizen, officer and report pages.

The citizen page supports English, Mandarin Chinese, Malay and Tamil UI text. The ear icon uses browser speech synthesis for read-aloud instructions.

The citizen recording flow should make clear that callers can speak naturally in the language or dialect they are most comfortable with, including mixed-language speech in the same call. The officer workflow will preserve transcribed foreign-language words when ASR returns them, or show `[foreign language]` when speech is detected but cannot be put into words.

The officer page prioritizes timestamped evidence review:

- translated English transcript is primary when available;
- original ASR transcript remains visible for audit/source review;
- highlighted evidence seeks to the source sentence start;
- selected case cards are visually marked in the queue.
