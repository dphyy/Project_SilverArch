const RULES = [
  { category: "self-harm", pattern: /\b(kill myself|suicide|suicidal|end my life|hurt myself|don't want to live)\b/i, resource: "National mindline 1-767", guidance: "Call 1-767 now for 24-hour mental health support" },
  { category: "family-violence", pattern: /\b(family violence|domestic violence|partner.*(?:hit(?:ting)?|attack(?:ing|ed)?)|being beaten|abuse.*happening now)\b/i, resource: "Police emergency 999", guidance: "Call 999 if violence is happening now" },
  { category: "immediate-danger", pattern: /\b(in danger|attacking me|violence now|weapon|threatening to kill|break.?in)\b/i, resource: "Police emergency 999", guidance: "Call 999 for immediate danger" }
];

export function screenUrgency(text = "") {
  const match = RULES.find((rule) => rule.pattern.test(text));
  return match
    ? { urgent: true, category: match.category, resource: match.resource, guidance: match.guidance, reason: "Possible acute safety risk detected" }
    : { urgent: false };
}
