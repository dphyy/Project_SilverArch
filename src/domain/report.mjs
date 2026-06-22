export const REPORT_FACTS = [
  ["citizenship", "Citizenship / residency"],
  ["applicantAge", "Applicant age"],
  ["householdIncome", "Monthly household income"],
  ["householdSize", "Household size"],
  ["employment", "Employment / work interruption"]
];

const filled = (value) => String(value ?? "").trim().length > 0;

export function reportReadiness(caseItem = {}) {
  const missing = [];
  const officer = caseItem.officerProfile || {};
  if (!filled(officer.name)) missing.push({ id: "officer-name", label: "Officer name is required" });
  if (!filled(officer.designation)) missing.push({ id: "officer-designation", label: "Officer designation is required" });
  if (!filled(officer.sso)) missing.push({ id: "officer-sso", label: "Social Service Office is required" });
  if (!filled(caseItem.transcript?.editedText)) missing.push({ id: "verified-transcript", label: "Save a verified transcript" });
  if (!filled(caseItem.callerProfile?.officerSummary)) missing.push({ id: "verified-summary", label: "Save a verified caller summary" });

  for (const [key, label] of REPORT_FACTS) {
    const review = caseItem.factReviews?.[key];
    if (!review || !["verified", "unknown"].includes(review.status)) missing.push({ id: `fact-${key}`, label: `Review ${label.toLowerCase()}` });
    else if (review.status === "verified" && !filled(review.value)) missing.push({ id: `fact-${key}`, label: `Enter ${label.toLowerCase()}` });
    else if (review.status === "unknown" && !filled(review.explanation)) missing.push({ id: `fact-${key}`, label: `Explain why ${label.toLowerCase()} could not be verified` });
  }

  for (const scheme of caseItem.triage?.shortlist || []) {
    if (!filled(scheme.officerReasoning)) missing.push({ id: `scheme-${scheme.schemeId}`, label: `Add officer reasoning for ${scheme.name}` });
  }
  if ((caseItem.piiProposals || []).some((proposal) => proposal.status === "proposed")) missing.push({ id: "pii", label: "Resolve all PII proposals" });

  const consolidation = caseItem.consolidation || {};
  if (!filled(consolidation.presentingCircumstances)) missing.push({ id: "presenting-circumstances", label: "Complete presenting circumstances" });
  if (!filled(consolidation.assessment)) missing.push({ id: "officer-assessment", label: "Complete the officer assessment" });
  if (!filled(consolidation.recommendedFollowUp)) missing.push({ id: "recommended-follow-up", label: "Complete recommended follow-up" });
  const hasReviewFlags = Boolean(caseItem.urgency?.urgent || caseItem.reviewReasons?.length || caseItem.transcript?.confidenceFlags?.length);
  if (hasReviewFlags && !filled(consolidation.safeguardsResolution)) missing.push({ id: "safeguards", label: "Document how review flags and safeguards were addressed" });
  if (hasReviewFlags && !caseItem.reviewAcknowledgements?.flagsReviewed) missing.push({ id: "flags-reviewed", label: "Confirm all review flags were considered" });
  if (!caseItem.reviewAcknowledgements?.transcriptReviewed) missing.push({ id: "transcript-reviewed", label: "Confirm the audio, transcript and evidence were reviewed" });
  if (!caseItem.reviewAcknowledgements?.declaration) missing.push({ id: "declaration", label: "Complete the officer declaration" });
  return { ready: missing.length === 0, missing };
}

export function redactTranscript(text = "", proposals = []) {
  let redacted = String(text);
  for (const proposal of proposals.filter((item) => item.status === "confirmed")) {
    const replacement = proposal.type.includes("NRIC") ? "[REDACTED NRIC/FIN]" : proposal.type.includes("phone") ? "[REDACTED PHONE NUMBER]" : "[REDACTED]";
    redacted = redacted.split(proposal.value).join(replacement);
  }
  return redacted;
}

export function buildReportDraft(caseItem, version = 1, now = new Date().toISOString()) {
  const factReviews = Object.fromEntries(REPORT_FACTS.map(([key, label]) => [key, { label, ...(caseItem.factReviews?.[key] || { status: "unknown", explanation: "Not provided" }) }]));
  const verifiedTranscript = caseItem.transcript?.editedText || caseItem.transcript?.text || "";
  const originalTranscript = caseItem.transcript?.originalText || caseItem.transcript?.text || "";
  return {
    caseId: caseItem.id,
    version,
    revision: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    preparedBy: { ...caseItem.officerProfile },
    metadata: { caseCreatedAt: caseItem.createdAt, asrEngine: caseItem.transcript?.asrEngine || "Unavailable", sourceLanguage: caseItem.transcript?.languageCode || "Unknown", translationStatus: caseItem.translation?.status || "not-required", translationProvider: caseItem.translation?.provider || null },
    applicant: { contactPhone: caseItem.contact?.phone || "Not collected", summary: caseItem.callerProfile?.officerSummary || caseItem.callerProfile?.summary || "" },
    sections: { ...caseItem.consolidation },
    facts: factReviews,
    urgency: caseItem.urgency || { urgent: false },
    reviewReasons: [...(caseItem.reviewReasons || [])],
    schemes: (caseItem.triage?.shortlist || []).map((scheme) => ({ schemeId: scheme.schemeId, name: scheme.name, softScore: scheme.softScore, reasoning: scheme.officerReasoning || scheme.reasoning, appealRelevant: scheme.appealRelevant || [], insufficientInformation: scheme.insufficientInformation || [], evidenceRefs: scheme.evidenceRefs || [] })),
    evidence: (caseItem.evidence || []).map(({ category, label, text, start, sentenceStart, requiresVerification }) => ({ category, label, text, start, sentenceStart, requiresVerification })),
    transcripts: { verified: redactTranscript(verifiedTranscript, caseItem.piiProposals), original: redactTranscript(originalTranscript, caseItem.piiProposals), english: caseItem.translation?.status === "ready" ? redactTranscript(caseItem.translation.english?.text || "", caseItem.piiProposals) : null },
    declaration: { confirmed: Boolean(caseItem.reviewAcknowledgements?.declaration), statement: "The preparing officer confirms that the available audio, transcript, evidence and review flags were considered. This supporting report is not an eligibility determination." }
  };
}

export function reportDraftReadiness(report = {}) {
  const missing = [];
  if (!filled(report.preparedBy?.name)) missing.push({ id: "officer-name", label: "Officer name is required" });
  if (!filled(report.preparedBy?.designation)) missing.push({ id: "officer-designation", label: "Officer designation is required" });
  if (!filled(report.preparedBy?.sso)) missing.push({ id: "officer-sso", label: "Social Service Office is required" });
  if (!filled(report.applicant?.summary)) missing.push({ id: "verified-summary", label: "Verified caller summary is required" });
  if (!filled(report.sections?.presentingCircumstances)) missing.push({ id: "presenting-circumstances", label: "Presenting circumstances are required" });
  if (!filled(report.sections?.assessment)) missing.push({ id: "officer-assessment", label: "Officer assessment is required" });
  if (!filled(report.sections?.recommendedFollowUp)) missing.push({ id: "recommended-follow-up", label: "Recommended follow-up is required" });
  if (!filled(report.transcripts?.verified)) missing.push({ id: "verified-transcript", label: "Verified transcript is required" });
  for (const [key, fact] of Object.entries(report.facts || {})) {
    if (fact.status === "verified" && !filled(fact.value)) missing.push({ id: `fact-${key}`, label: `Enter ${String(fact.label || key).toLowerCase()}` });
    if (fact.status === "unknown" && !filled(fact.explanation)) missing.push({ id: `fact-${key}`, label: `Explain why ${String(fact.label || key).toLowerCase()} could not be verified` });
  }
  for (const scheme of report.schemes || []) if (!filled(scheme.reasoning)) missing.push({ id: `scheme-${scheme.schemeId}`, label: `Add reasoning for ${scheme.name}` });
  return { ready: missing.length === 0, missing };
}

export function reportTextLines(report) {
  const lines = ["SilverArch Supporting Case Report for SSO Review", `Case ${report.caseId}`, `Report version ${report.version}`, `${report.status === "draft" ? "DRAFT - FOR OFFICER REVIEW" : "FINALIZED SUPPORTING REPORT"}`, "Sensitive personal data - authorised review only", `Prepared by: ${report.preparedBy.name}, ${report.preparedBy.designation}, ${report.preparedBy.sso}`, `Contact: ${report.applicant.contactPhone}`, "Verified caller summary", report.applicant.summary, "Presenting circumstances", report.sections.presentingCircumstances, "Verified facts"];
  for (const fact of Object.values(report.facts)) lines.push(`${fact.label}: ${fact.status === "unknown" ? `Unable to verify - ${fact.explanation}` : fact.value}`);
  lines.push("Officer assessment", report.sections.assessment, "Recommended follow-up", report.sections.recommendedFollowUp);
  if (report.sections.safeguardsResolution) lines.push("Safeguards and review flags", report.sections.safeguardsResolution);
  lines.push("Schemes for consideration - triage support only");
  for (const scheme of report.schemes) lines.push(scheme.name, scheme.reasoning, ...scheme.appealRelevant.map((item) => `Appeal context: ${item}`), ...scheme.insufficientInformation.map((item) => `Unverified: ${item}`));
  lines.push("Evidence excerpts");
  for (const item of report.evidence) lines.push(`${formatSeconds(item.start)} - ${item.label}: “${item.text}”${item.requiresVerification ? " (officer verification required)" : ""}`);
  lines.push("Transcript appendix", report.transcripts.verified);
  if (report.transcripts.english && report.transcripts.english !== report.transcripts.verified) lines.push("English translation", report.transcripts.english);
  if (report.transcripts.original !== report.transcripts.verified) lines.push("Original ASR transcript", report.transcripts.original);
  lines.push("Provider attribution", `ASR: ${report.metadata.asrEngine}; translation: ${report.metadata.translationStatus}${report.metadata.translationProvider ? ` (${report.metadata.translationProvider})` : ""}`, "Officer declaration", report.declaration.statement);
  return lines.filter((line) => line !== null && line !== undefined && String(line).trim());
}

export function formatSeconds(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}
