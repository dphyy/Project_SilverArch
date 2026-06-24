const RULES = [
  { category: "self-harm", pattern: /\b(kill myself|suicide|suicidal|end my life|hurt myself|don'?t want to (?:live|be alive)|do not want to (?:live|be alive)|am not safe for myself|not safe for myself|cannot wait until tomorrow|can'?t wait until tomorrow|need someone to talk to now)\b/i, resource: "National mindline 1-767", guidance: "Call 1-767 now for 24-hour mental health support" },
  { category: "family-violence", pattern: /\b(family violence|domestic violence|partner.*(?:hit(?:ting)?|attack(?:ing|ed)?)|being beaten|abuse.*happening now)\b/i, resource: "Police emergency 999", guidance: "Call 999 if violence is happening now" },
  { category: "immediate-danger", pattern: /\b(in danger|attacking me|violence now|weapon|threatening to kill|break.?in)\b/i, resource: "Police emergency 999", guidance: "Call 999 for immediate danger" }
];

export function screenUrgency(text = "") {
  const match = RULES.find((rule) => rule.pattern.test(text));
  return match
    ? { urgent: true, category: match.category, resource: match.resource, guidance: match.guidance, reason: "Possible acute safety risk detected" }
    : { urgent: false };
}

export function mergeUrgencyResults(results = []) {
  const priorities = ["immediate-danger", "self-harm", "family-violence"];
  const urgent = results.filter((result) => result?.urgent);
  if (!urgent.length) return { urgent: false };
  return urgent.sort((a, b) => priorities.indexOf(a.category) - priorities.indexOf(b.category))[0];
}
