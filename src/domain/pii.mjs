const PATTERNS = [
  { type: "possible NRIC/FIN", regex: /\b[STFGM]\d{7}[A-Z]\b/gi },
  { type: "possible phone number", regex: /\b(?:\+65\s?)?[3689]\d{3}[\s-]?\d{4}\b/g }
];

export function proposePiiRedactions(text = "") {
  return PATTERNS.flatMap(({ type, regex }) =>
    [...text.matchAll(regex)].map((match) => ({
      type,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
      status: "proposed"
    }))
  );
}
