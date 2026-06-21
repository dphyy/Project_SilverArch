const HARDSHIP_RULES = [
  { pattern: /\b(lost|lose|no) (my )?(job|work|income)\b/i, label: "Sudden job or income loss mentioned" },
  { pattern: /\b(medical|hospital|medicine|disability|disabled|sick|illness)\b/i, label: "Medical burden mentioned" },
  { pattern: /\b(caregiver|caregiving|look after|taking care)\b/i, label: "Caregiving duties mentioned" },
  { pattern: /\b(estranged|no contact|family cannot|family can't)\b/i, label: "Limited family support mentioned" },
  { pattern: /\b(rent|rental|evict|homeless|no place to stay)\b/i, label: "Housing hardship mentioned" }
];

const RELEVANCE = {
  smta: [/job|work|income|rent|food|bills|money/i],
  lta: [/old age|elderly|permanent|disab|unable to work|long.term/i],
  medifund: [/hospital|medical bill|treatment|clinic|medicine/i],
  chas: [/gp|dental|clinic|chronic|medical/i],
  moe_fas: [/school|student|primary|secondary|uniform|textbook/i],
  scfa: [/student care|child care|after.school|working parent/i],
  preschool_assistance: [/preschool|kindergarten|kifas|childcare/i],
  comlink_plus: [/debt|homeless|destitute|severe hardship|rental/i]
};

function citizenshipFact(text) {
  if (/\b(singapore citizen|singaporean|i am (an? )?sc)\b/i.test(text)) return "citizen";
  if (/\b(permanent resident|i am (an? )?pr)\b/i.test(text)) return "pr";
  if (/\b(foreigner|work permit|employment pass|not (a )?(citizen|pr))\b/i.test(text)) return "other";
  return null;
}

function hasHardCeilingFact(field, text, citizenship) {
  const checks = {
    citizenship: () => Boolean(citizenship),
    student_citizenship: () => /\b(?:student|child|son|daughter)\s+(?:is\s+)?(?:a\s+)?(?:singapore citizen|singaporean|permanent resident|pr)\b/i.test(text),
    child_citizenship: () => /\b(?:child|son|daughter)\s+(?:is\s+)?(?:a\s+)?(?:singapore citizen|singaporean|permanent resident|pr)\b/i.test(text),
    age: () => /\b(?:aged?|age is|is)\s+\d{1,2}(?:\s+years?\s+old)?\b/i.test(text),
    enrollment: () => /\b(?:enrolled|attends?|goes to)\s+(?:an?\s+)?(?:msf.registered\s+)?student care/i.test(text),
    institution: () => /\b(?:public|subsidised|subsidized|government)\s+(?:hospital|healthcare institution|clinic)\b/i.test(text),
    school_type: () => /\b(?:government|government.aided)\s+(?:primary|secondary|special)?\s*school\b/i.test(text),
    centre_type: () => /\b(?:licensed|anchor operator|moe)\s+(?:preschool|kindergarten|childcare centre)\b/i.test(text),
    medical_certification: () => /\b(?:doctor|medical officer)\s+(?:certified|confirmed)|medical (?:certificate|certification).*unable to work\b/i.test(text)
  };
  return checks[field]?.() || false;
}

export function triageTranscript(text, schemes) {
  if (!text?.trim()) return { status: "manual-review", shortlist: [], reason: "No usable transcript" };
  const citizenship = citizenshipFact(text);
  const hardships = HARDSHIP_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  const evaluated = schemes.map((scheme) => {
    const missingFields = scheme.hard_ceilings
      .map((item) => item.field)
      .filter((field) => !hasHardCeilingFact(field, text, citizenship));
    const relevanceHits = (RELEVANCE[scheme.scheme_id] || []).filter((pattern) => pattern.test(text)).length;
    const excluded = citizenship === "other" && scheme.hard_ceilings.some((item) => item.field.includes("citizenship"));
    const appealRelevant = hardships.length && scheme.flexible_criteria.length ? hardships : [];
    const score = relevanceHits * 3 + appealRelevant.length - missingFields.length;
    return {
      schemeId: scheme.scheme_id,
      name: scheme.name,
      excluded,
      softScore: relevanceHits > 0 ? (appealRelevant.length ? "borderline" : "likely relevant") : "insufficient context",
      insufficientInformation: missingFields.map((field) => `${field.replaceAll("_", " ")} not stated`),
      appealRelevant,
      reasoning: relevanceHits > 0 ? `Testimony contains context relevant to ${scheme.name}. Officer assessment is still required.` : "Not enough scheme-specific context was captured.",
      score
    };
  });
  const shortlist = evaluated.filter((item) => !item.excluded).sort((a, b) => b.score - a.score).slice(0, 3);
  return {
    status: shortlist.some((item) => item.insufficientInformation.length) ? "manual-review" : "draft-ready",
    extractedFacts: { citizenship, hardships },
    shortlist,
    excluded: evaluated.filter((item) => item.excluded).map((item) => ({ schemeId: item.schemeId, reason: "Stated citizenship does not meet the scheme requirement" }))
  };
}
