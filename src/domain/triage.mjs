import { extractTypedFacts } from "./facts.mjs";

const RELEVANCE = {
  smta: [/job|work|income|rent|food|bills|money|fees|expenses|electricity|utilities|utility|power|water/i], lta: [/old age|elderly|permanent|disab|unable to work|long.term/i],
  medifund: [/hospital|medical bill|treatment|clinic|medicine/i], chas: [/gp|dental|clinic|chronic|medical/i],
  moe_fas: [/school|student|primary|secondary|uniform|textbook|fees/i], scfa: [/student care|child care|after.school|working parent/i],
  preschool_assistance: [/preschool|kindergarten|kifas|childcare/i], comlink_plus: [/debt|homeless|destitute|severe hardship|rental/i],
  aic_hcg: [/caregiv|caregiver|take care|look after|activities of daily living|ADLs?|bathe|shower|dress|toilet|feed|transfer|disab|dementia|stroke|frail|elderly|senior/i],
  aic_smf_devices: [/wheelchair|walking frame|walking stick|mobility aid|assistive device|commode|hospital bed|difficulty walking|cannot walk|falls?|senior|elderly|frail/i],
  aic_ctg: [/caregiver training|training course|learn to care|caregiving skills|dementia care|wound care|caregiver/i],
  aic_elderfund: [/severe disab|severely disabled|cannot shower|cannot bathe|cannot dress|cannot toilet|cannot feed|cannot transfer|bedbound|long.term care|elderfund|careshield|eldershield|disabled|frail/i]
};

const result = (field, value, satisfied, violationReason) => ({ field, status: value === null || value === undefined || (Array.isArray(value) && !value.length) ? "unknown" : satisfied ? "satisfied" : "violated", value, ...(satisfied || value == null ? {} : { reason: violationReason }) });

function hardCeilings(schemeId, facts) {
  const citizenOrPr = facts.citizenship === "citizen" || facts.citizenship === "pr";
  const childCitizenOrPr = facts.childCitizenship === "citizen" || facts.childCitizenship === "pr";
  const map = {
    smta: [result("citizenship", facts.citizenship, citizenOrPr, "Applicant is not an SC or PR")],
    lta: [result("citizenship", facts.citizenship, citizenOrPr, "Applicant is not an SC or PR"), result("medical certification", facts.medicalCertification, facts.medicalCertification === true, "Permanent unfitness has not been medically certified")],
    medifund: [result("citizenship", facts.citizenship, facts.citizenship === "citizen", "MediFund requires Singapore citizenship"), result("institution", facts.publicHealthcareInstitution, facts.publicHealthcareInstitution === true, "Treatment is not at an eligible public institution")],
    chas: [result("citizenship", facts.citizenship, facts.citizenship === "citizen", "CHAS requires Singapore citizenship")],
    moe_fas: [result("student citizenship", facts.childCitizenship, facts.childCitizenship === "citizen", "Student is not a Singapore Citizen"), result("school type", facts.governmentSchool, facts.governmentSchool === true, "School type is not eligible")],
    scfa: [result("child age", facts.childAges, facts.childAges.length ? facts.childAges.some((age) => age >= 7 && age <= 14) : false, "No stated child is aged 7–14"), result("student care enrolment", facts.studentCareEnrolled, facts.studentCareEnrolled === true, "Child is not enrolled in eligible Student Care"), result("child citizenship", facts.childCitizenship, childCitizenOrPr, "Child citizenship requirement is not met")],
    preschool_assistance: [result("child citizenship", facts.childCitizenship, facts.childCitizenship === "citizen", "Child is not a Singapore Citizen"), result("centre type", facts.eligiblePreschool, facts.eligiblePreschool === true, "Preschool or kindergarten is not eligible")],
    comlink_plus: [result("citizenship", facts.citizenship, facts.citizenship === "citizen", "No Singapore Citizen family member was stated")]
  };
  return map[schemeId] || [];
}

export function triageTranscript(text, schemes, evidence = []) {
  if (!text?.trim()) return { status: "manual-review", shortlist: [], reason: "No usable transcript", extractedFacts: {} };
  const facts = extractTypedFacts(text);
  const hardships = Object.entries(facts.hardship).filter(([, present]) => present).map(([name]) => name.replace(/([A-Z])/g, " $1").toLowerCase());
  const evaluated = schemes.map((scheme) => {
    const isReferral = scheme.scheme_id.startsWith("aic_");
    const ceilingResults = hardCeilings(scheme.scheme_id, facts);
    const violations = ceilingResults.filter((item) => item.status === "violated");
    const unknown = ceilingResults.filter((item) => item.status === "unknown");
    const relevanceHits = (RELEVANCE[scheme.scheme_id] || []).filter((pattern) => pattern.test(text)).length;
    const appealLabels = { medical: "Medical burden mentioned", jobLoss: "Job loss mentioned", utilities: "Utility bills or essential fees mentioned", caregiving: "Caregiving burden mentioned", disability: "Disability or ADL support need mentioned", mobility: "Mobility or assistive-device need mentioned", eldercare: "Senior or eldercare context mentioned", estrangement: "Family estrangement mentioned", housing: "Housing hardship mentioned" };
    const appealRelevant = hardships.length && scheme.flexible_criteria.length ? Object.entries(facts.hardship).filter(([, present]) => present).map(([key]) => appealLabels[key] || `${key} hardship mentioned`) : [];
    const evidenceRefs = evidence.filter((item) => ["income", "employment", "medical", "wellbeing", "housing", "caregiving", "family", "education", "citizenship", "age"].includes(item.category)).map(({ id, text: quote, start, end, sentenceStart, category, startWord, endWord }) => ({ id, quote, start, end, sentenceStart, category, startWord, endWord }));
    const score = relevanceHits * 3 + appealRelevant.length - unknown.length + (isReferral && relevanceHits ? 1 : 0);
    const reasoning = relevanceHits
      ? isReferral
        ? `Captured testimony may indicate referral relevance for ${scheme.name}. This is a cross-agency referral consideration only; an officer should verify current AIC criteria and decide whether AIC Link or another referral route is appropriate.`
        : `Captured testimony contains context relevant to ${scheme.name}; an officer must assess the full circumstances.`
      : "Not enough scheme-specific context was captured.";
    return { schemeId: scheme.scheme_id, name: scheme.name, excluded: violations.length > 0, hardCeilings: ceilingResults, softScore: relevanceHits ? (appealRelevant.length ? "borderline" : "likely relevant") : "insufficient context", insufficientInformation: unknown.map((item) => `${item.field} not stated`), appealRelevant, reasoning, evidenceRefs, exclusionReasons: violations.map((item) => item.reason), score };
  });
  const shortlist = evaluated.filter((item) => !item.excluded).sort((a, b) => b.score - a.score).slice(0, 3);
  return { status: shortlist.some((item) => item.insufficientInformation.length) ? "manual-review" : "draft-ready", extractedFacts: facts, shortlist, excluded: evaluated.filter((item) => item.excluded).map((item) => ({ schemeId: item.schemeId, reasons: item.exclusionReasons })) };
}
