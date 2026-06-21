const RULES = [
  { pattern: /\b(kill myself|suicide|end my life)\b/i, resource: "National mindline 1-767" },
  { pattern: /\b(in danger|attacking me|violence now|weapon)\b/i, resource: "Police emergency 999" }
];

export function screenUrgency(text = "") {
  const match = RULES.find((rule) => rule.pattern.test(text));
  return match
    ? { urgent: true, resource: match.resource, reason: "Possible acute safety risk detected" }
    : { urgent: false };
}
