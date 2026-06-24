export const REPORT_FACTS = [
  ["citizenship", "Citizenship / residency"],
  ["applicantAge", "Applicant age"],
  ["householdIncome", "Monthly household income"],
  ["householdSize", "Household size"],
  ["employment", "Employment / work interruption"]
];

const filled = (value) => String(value ?? "").trim().length > 0;

export function reportReadiness(caseItem = {}, { reportDraftingAvailable = true } = {}) {
  const missing = [];
  if (!reportDraftingAvailable) missing.push({ id: "report-provider", label: "Configure MERaLiON or OpenAI report drafting before generating a report" });
  const officer = caseItem.officerProfile || {};
  if (!filled(officer.name)) missing.push({ id: "officer-name", label: "Officer name is required" });
  if (!filled(officer.designation)) missing.push({ id: "officer-designation", label: "Officer designation is required" });
  if (!filled(officer.sso)) missing.push({ id: "officer-sso", label: "Social Service Office is required" });
  if ((caseItem.piiProposals || []).some((proposal) => proposal.status === "proposed")) missing.push({ id: "pii", label: "Resolve all PII proposals" });
  const hasReviewFlags = Boolean(caseItem.urgency?.urgent || caseItem.reviewReasons?.length || caseItem.transcript?.confidenceFlags?.length);
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

export function buildReportDraft(caseItem, version = 1, now = new Date().toISOString(), generated = {}) {
  const generatedFacts = generated.facts || {};
  const factReviews = Object.fromEntries(REPORT_FACTS.map(([key, label]) => [key, { label, ...(generatedFacts[key] || caseItem.factReviews?.[key] || { status: "unknown", explanation: "Not provided" }) }]));
  const verifiedTranscript = caseItem.transcript?.editedText || caseItem.transcript?.text || "";
  const originalTranscript = caseItem.transcript?.originalText || caseItem.transcript?.text || "";
  const generatedSchemes = new Map((generated.schemes || []).map((scheme) => [scheme.schemeId, scheme.reasoning]));
  return {
    caseId: caseItem.id,
    version,
    revision: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    preparedBy: { ...caseItem.officerProfile },
    metadata: { caseCreatedAt: caseItem.createdAt, asrEngine: caseItem.transcript?.asrEngine || "Unavailable", sourceLanguage: caseItem.transcript?.languageCode || "Unknown", translationStatus: caseItem.translation?.status || "not-required", translationProvider: caseItem.translation?.provider || null, reportDraftProvider: generated.provider || null, reportDraftFallbackReason: generated.fallbackReason || null, generatedAt: generated.provider ? now : null },
    applicant: { contactPhone: caseItem.contact?.phone || "Not collected", summary: generated.applicantSummary || caseItem.callerProfile?.officerSummary || caseItem.callerProfile?.summary || "" },
    sections: {
      presentingCircumstances: generated.sections?.presentingCircumstances || caseItem.consolidation?.presentingCircumstances || "",
      assessment: generated.sections?.assessment || caseItem.consolidation?.assessment || "",
      recommendedFollowUp: generated.sections?.recommendedFollowUp || caseItem.consolidation?.recommendedFollowUp || "",
      safeguardsResolution: generated.sections?.safeguardsResolution || caseItem.consolidation?.safeguardsResolution || ""
    },
    facts: factReviews,
    urgency: caseItem.urgency || { urgent: false },
    reviewReasons: [...(caseItem.reviewReasons || [])],
    reviewCouncil: buildReviewCouncil(caseItem),
    schemes: (caseItem.triage?.shortlist || []).map((scheme) => ({ schemeId: scheme.schemeId, name: scheme.name, softScore: scheme.softScore, reasoning: generatedSchemes.get(scheme.schemeId) || scheme.officerReasoning || scheme.reasoning, appealRelevant: scheme.appealRelevant || [], insufficientInformation: scheme.insufficientInformation || [], evidenceRefs: scheme.evidenceRefs || [] })),
    evidence: reportEvidence(caseItem),
    transcripts: { verified: redactTranscript(verifiedTranscript, caseItem.piiProposals), original: redactTranscript(originalTranscript, caseItem.piiProposals), english: caseItem.translation?.status === "ready" ? redactTranscript(caseItem.translation.english?.text || "", caseItem.piiProposals) : null },
    declaration: { confirmed: Boolean(caseItem.reviewAcknowledgements?.declaration), statement: "The preparing officer confirms that the available audio, transcript, evidence and review flags were considered. This supporting report is not an eligibility determination." }
  };
}

export function reportEvidence(caseItem = {}) {
  const items = [
    ...(caseItem.evidence || []).map(({ id, category, label, text, start, end, sentenceStart, requiresVerification, source, startWord, endWord }) => ({ id, category, label, text, start, end, sentenceStart, requiresVerification, source, startWord, endWord })),
    ...(caseItem.callerProfile?.characteristics || []).map(({ evidenceId, category, label, value, start, end, sentenceStart, requiresVerification, source, startWord, endWord }) => ({ id: evidenceId, category, label, text: value, start, end, sentenceStart, requiresVerification, source, startWord, endWord })),
    ...(caseItem.triage?.shortlist || []).flatMap((scheme) => (scheme.evidenceRefs || []).map(({ id, category, quote, start, end, sentenceStart, source, startWord, endWord }) => ({ id, category, label: scheme.name || "Scheme evidence", text: quote, start, end, sentenceStart, requiresVerification: false, source, startWord, endWord })))
  ].filter((item) => filled(item.text));
  const seen = new Map();
  for (const item of items) {
    const key = evidenceKey(item);
    const existing = seen.get(key);
    if (existing) {
      if (!existing.id && item.id) existing.id = item.id;
      if (!existing.end && item.end) existing.end = item.end;
      if (!existing.source && item.source) existing.source = item.source;
      if (!Number.isInteger(existing.startWord) && Number.isInteger(item.startWord)) existing.startWord = item.startWord;
      if (!Number.isInteger(existing.endWord) && Number.isInteger(item.endWord)) existing.endWord = item.endWord;
      continue;
    }
    seen.set(key, { ...item });
  }
  return [...seen.values()].sort((a, b) => Number(a.start || 0) - Number(b.start || 0) || String(a.label).localeCompare(String(b.label)));
}

function evidenceKey(item) {
  const text = normalizeEvidenceForKey(item.text);
  const start = Number(item.start);
  const sentenceStart = Number(item.sentenceStart);
  if (Number.isFinite(start)) return `phrase:${text}:start:${start.toFixed(1)}:sentence:${Number.isFinite(sentenceStart) ? sentenceStart.toFixed(1) : "unknown"}`;
  if (Number.isInteger(item.startWord) && Number.isInteger(item.endWord)) return `phrase:${text}:words:${item.startWord}-${item.endWord}`;
  const id = String(item.id || "").trim();
  return id ? `id:${id}` : `phrase:${text}`;
}

function normalizeEvidenceForKey(text = "") {
  return String(text).toLowerCase().replace(/[“”"'.,!?;:()[\]{}]+/g, "").replace(/\s+/g, " ").trim();
}

export function buildReportMaterial(caseItem = {}) {
  return {
    caseId: caseItem.id,
    createdAt: caseItem.createdAt,
    contact: { phone: caseItem.contact?.phone || null },
    intakeLanguage: caseItem.intakeLanguage || "en",
    transcript: {
      text: caseItem.transcript?.editedText || caseItem.transcript?.text || "",
      originalText: caseItem.transcript?.originalText || caseItem.transcript?.text || "",
      languageCode: caseItem.transcript?.languageCode || null,
      confidenceFlags: caseItem.transcript?.confidenceFlags || []
    },
    englishTranslation: caseItem.translation?.status === "ready" ? caseItem.translation.english?.text || "" : "",
    callerProfile: caseItem.callerProfile || {},
    evidence: reportEvidence(caseItem).map(({ label, text, start, end, sentenceStart, category, requiresVerification, source, startWord, endWord }) => ({ label, text, start, end, sentenceStart, category, requiresVerification, source, startWord, endWord })),
    facts: caseItem.factReviews || caseItem.triage?.officerFacts || caseItem.triage?.extractedFacts || {},
    schemes: (caseItem.triage?.shortlist || []).map(({ schemeId, name, reasoning, softScore, appealRelevant, insufficientInformation, evidenceRefs }) => ({ schemeId, name, reasoning, softScore, appealRelevant, insufficientInformation, evidenceRefs })),
    urgency: caseItem.urgency || {},
    reviewReasons: caseItem.reviewReasons || [],
    reviewCouncil: buildReviewCouncil(caseItem),
    piiResolved: !(caseItem.piiProposals || []).some((proposal) => proposal.status === "proposed")
  };
}

export function buildReviewCouncil(caseItem = {}) {
  const shortlist = caseItem.triage?.shortlist || [];
  const reviewReasons = [...(caseItem.reviewReasons || []), ...(caseItem.transcript?.confidenceFlags || [])].filter(Boolean);
  const unresolvedPii = (caseItem.piiProposals || []).filter((proposal) => proposal.status === "proposed").length;
  const missingCore = caseItem.callerProfile?.missingCoreDetails || [];
  const schemeMissing = shortlist.flatMap((scheme) => scheme.insufficientInformation || []);
  const aicReferrals = shortlist.filter((scheme) => String(scheme.schemeId || "").startsWith("aic_"));
  const translationStatus = caseItem.translation?.status || "not-required";
  const translationUncertainty = ["pending", "unavailable", "failed"].includes(translationStatus);
  const majorMissingFacts = [...new Set([...missingCore, ...schemeMissing])];
  const humanEscalationRequired = Boolean(caseItem.urgency?.urgent || reviewReasons.length || unresolvedPii || translationUncertainty || majorMissingFacts.length >= 2);
  const deductions = [
    caseItem.urgency?.urgent ? 25 : 0,
    reviewReasons.length ? 15 : 0,
    unresolvedPii ? 20 : 0,
    translationUncertainty ? 10 : 0,
    Math.min(20, majorMissingFacts.length * 5),
    shortlist.length ? 0 : 10
  ];
  const confidenceScore = Math.max(0, 100 - deductions.reduce((sum, value) => sum + value, 0));
  return {
    humanEscalationRequired,
    confidenceScore,
    triggers: [
      ...(caseItem.urgency?.urgent ? ["Urgent or safeguarding risk"] : []),
      ...(reviewReasons.length ? ["Low-confidence or review flags"] : []),
      ...(unresolvedPii ? ["Unresolved PII proposals"] : []),
      ...(translationUncertainty ? ["Translation uncertainty"] : []),
      ...(majorMissingFacts.length >= 2 ? ["Major missing facts"] : [])
    ],
    perspectives: [
      {
        id: "scheme-fit",
        title: "Scheme fit",
        status: shortlist.length ? "review" : "attention",
        summary: shortlist.length ? `${shortlist.length} triage option${shortlist.length === 1 ? "" : "s"} shortlisted for officer consideration. Confirm criteria before any application or referral.` : "No reliable scheme shortlist was produced; officer review is needed."
      },
      {
        id: "safeguarding",
        title: "Safeguarding / urgency",
        status: caseItem.urgency?.urgent ? "urgent" : "clear",
        summary: caseItem.urgency?.urgent ? `${caseItem.urgency.reason || "Urgent language detected"}; consider immediate escalation and relevant 24-hour resources.` : "No immediate safeguarding trigger was detected by the intake screen."
      },
      {
        id: "missing-information",
        title: "Missing information",
        status: majorMissingFacts.length ? "attention" : "clear",
        summary: majorMissingFacts.length ? `Clarify: ${majorMissingFacts.slice(0, 6).join("; ")}${majorMissingFacts.length > 6 ? "; and other items" : ""}.` : "Core intake facts appear sufficiently captured for an initial officer callback."
      },
      {
        id: "referral-opportunities",
        title: "Referral opportunities",
        status: aicReferrals.length ? "review" : "neutral",
        summary: aicReferrals.length ? `Consider cross-agency referral discussion for: ${aicReferrals.map((scheme) => scheme.name).join("; ")}.` : "No AIC referral option was shortlisted from the current evidence."
      }
    ]
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
  if (report.reviewCouncil) {
    lines.push("Review council", `Human escalation required: ${report.reviewCouncil.humanEscalationRequired ? "Yes" : "No"}`, `Confidence / readiness score: ${report.reviewCouncil.confidenceScore}/100`);
    for (const perspective of report.reviewCouncil.perspectives || []) lines.push(`${perspective.title}: ${perspective.summary}`);
  }
  lines.push("Schemes for consideration - triage support only");
  for (const scheme of report.schemes) lines.push(scheme.name, scheme.reasoning, ...scheme.appealRelevant.map((item) => `Appeal context: ${item}`), ...scheme.insufficientInformation.map((item) => `Unverified: ${item}`));
  lines.push("Evidence excerpts");
  for (const item of report.evidence) lines.push(`${formatSeconds(item.start)} - ${item.label}: “${item.text}”${item.requiresVerification ? " (officer verification required)" : ""}`);
  lines.push("Transcript appendix", report.transcripts.verified);
  if (report.transcripts.english && report.transcripts.english !== report.transcripts.verified) lines.push("English translation", report.transcripts.english);
  if (report.transcripts.original !== report.transcripts.verified) lines.push("Original ASR transcript", report.transcripts.original);
  lines.push("Provider attribution", `ASR: ${report.metadata.asrEngine}; translation: ${report.metadata.translationStatus}${report.metadata.translationProvider ? ` (${report.metadata.translationProvider})` : ""}; report draft: ${report.metadata.reportDraftProvider || "manual/local"}`, "Officer declaration", report.declaration.statement);
  return lines.filter((line) => line !== null && line !== undefined && String(line).trim());
}

export function formatSeconds(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}
