import test from "node:test";
import assert from "node:assert/strict";
import { buildReportDraft, buildReviewCouncil, redactTranscript, reportDraftReadiness, reportEvidence, reportReadiness, reportTextLines } from "../src/domain/report.mjs";
import { draftReportWithFallback } from "../src/services/report-drafter.mjs";
import { renderReportDocx, renderReportPdf } from "../src/services/report-renderer.mjs";

function completeCase() {
  return {
    id: "fixture-report", createdAt: "2026-06-22T10:00:00.000Z",
    contact: { phone: "+6591234567" }, officerProfile: { name: "Alicia Lim", designation: "Social Assistance Officer", sso: "Bedok SSO" },
    transcript: { text: "My NRIC is S1234567D. I am thirty-five years old and have no income.", originalText: "My NRIC is S1234567D. I am thirty-five years old and have no income.", editedText: "My NRIC is S1234567D. I am thirty-five years old and have no income.", asrEngine: "elevenlabs", languageCode: "en" },
    translation: { status: "not-required" }, callerProfile: { officerSummary: "Applicant is 35 and reports no current income." },
    factReviews: { citizenship: { status: "unknown", explanation: "Not stated in testimony" }, applicantAge: { status: "verified", value: "35" }, householdIncome: { status: "verified", value: "0" }, householdSize: { status: "unknown", explanation: "Unable to verify after intake" }, employment: { status: "verified", value: "Not working" } },
    consolidation: { presentingCircumstances: "Applicant reports an abrupt loss of income.", assessment: "Financial assistance assessment is warranted.", recommendedFollowUp: "Verify citizenship and household composition.", safeguardsResolution: "No acute safety risk was detected." },
    reviewAcknowledgements: { transcriptReviewed: true, flagsReviewed: true, declaration: true },
    piiProposals: [{ type: "possible NRIC/FIN", value: "S1234567D", status: "confirmed" }], urgency: { urgent: false }, reviewReasons: ["Triage requires officer review"],
    triage: { shortlist: [{ schemeId: "smta", name: "ComCare Short-to-Medium-Term Assistance", softScore: "borderline", officerReasoning: "Loss of income is relevant for officer consideration.", appealRelevant: ["Job loss mentioned"], insufficientInformation: ["citizenship not stated"], evidenceRefs: [] }] },
    evidence: [{ category: "age", label: "Age", text: "thirty-five years old", start: 4.2, sentenceStart: 2.1 }]
  };
}

test("report readiness blocks missing review fields and accepts explained unknowns", () => {
  const item = completeCase();
  item.consolidation = {};
  item.factReviews = {};
  item.triage.shortlist[0].officerReasoning = "";
  assert.equal(reportReadiness(item).ready, true);
  delete item.officerProfile.name;
  assert.equal(reportReadiness(item).ready, false);
  assert.ok(reportReadiness(item).missing.some((entry) => entry.id === "officer-name"));
  item.officerProfile.name = "Alicia Lim";
  item.piiProposals[0].status = "proposed";
  assert.ok(reportReadiness(item).missing.some((entry) => entry.id === "pii"));
  item.piiProposals[0].status = "confirmed";
  assert.ok(reportReadiness(item, { reportDraftingAvailable: false }).missing.some((entry) => entry.id === "report-provider"));
});

test("confirmed transcript PII is redacted while structured contact remains", () => {
  const item = completeCase(); const report = buildReportDraft(item);
  assert.match(report.transcripts.verified, /\[REDACTED NRIC\/FIN\]/);
  assert.doesNotMatch(report.transcripts.verified, /S1234567D/);
  assert.equal(report.applicant.contactPhone, "+6591234567");
  assert.equal(redactTranscript("Call 9123 4567", [{ type: "possible phone number", value: "9123 4567", status: "rejected" }]), "Call 9123 4567");
});

test("an edited report cannot be finalized after a required section is erased", () => {
  const report = buildReportDraft(completeCase());
  assert.equal(reportDraftReadiness(report).ready, true);
  report.sections.assessment = "";
  assert.ok(reportDraftReadiness(report).missing.some((entry) => entry.id === "officer-assessment"));
  report.sections.assessment = "Reviewed";
  report.facts.citizenship.explanation = "";
  assert.ok(reportDraftReadiness(report).missing.some((entry) => entry.id === "fact-citizenship"));
});

test("DOCX and PDF render from the same canonical report model", async () => {
  const report = { ...buildReportDraft(completeCase()), status: "finalized", finalizedAt: "2026-06-22T11:00:00.000Z" };
  const lines = reportTextLines(report);
  assert.ok(lines.includes("Applicant reports an abrupt loss of income."));
  const [docx, pdf] = await Promise.all([renderReportDocx(report), renderReportPdf(report)]);
  assert.equal(docx.subarray(0, 2).toString(), "PK");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(docx.length > 5_000);
  assert.ok(pdf.length > 2_000);
});

test("report evidence merges full evidence, caller characteristics and scheme references without duplicates", () => {
  const item = completeCase();
  item.callerProfile.characteristics = [{ evidenceId: "age-0", category: "age", label: "Age", value: "thirty-five years old", start: 4.2, sentenceStart: 2.1 }];
  item.triage.shortlist[0].evidenceRefs = [
    { id: "income-1", category: "income", quote: "no income", start: 7.5, sentenceStart: 6 },
    { id: "age-0", category: "age", quote: "thirty-five years old", start: 4.2, sentenceStart: 2.1 },
    { id: "scheme-income-duplicate", category: "income", quote: "no income", start: 7.5, sentenceStart: 6 }
  ];
  const evidence = reportEvidence(item);
  assert.ok(evidence.some((entry) => entry.text === "thirty-five years old"));
  assert.ok(evidence.some((entry) => entry.text === "no income"));
  assert.equal(evidence.filter((entry) => entry.id === "age-0").length, 1);
  assert.equal(evidence.filter((entry) => entry.text === "no income").length, 1);
});

test("generated report evidence includes every highlighted component", () => {
  const item = completeCase();
  item.evidence = [
    { id: "citizenship-0-3", category: "citizenship", label: "Citizenship / residency", text: "I am from Singapore", start: 0, end: 1.5, sentenceStart: 0, startWord: 0, endWord: 3 },
    { id: "age-5-9", category: "age", label: "Age", text: "I am 60 years old", start: 2, end: 3.5, sentenceStart: 0, startWord: 5, endWord: 9 },
    { id: "employment-13-14", category: "employment", label: "Employment", text: "not working", start: 5.2, end: 5.9, sentenceStart: 5.2, startWord: 13, endWord: 14 },
    { id: "income-21-23", category: "income", label: "Income and finances", text: "can't earn money", start: 8.4, end: 9.5, sentenceStart: 5.2, startWord: 21, endWord: 23 },
    { id: "medical-26-30", category: "medical", label: "Health and medical needs", text: "suffer from bone pain", start: 10.4, end: 12.3, sentenceStart: 10.4, startWord: 26, endWord: 30 },
    { id: "caregiving-55-58", category: "caregiving", label: "Caregiving", text: "take care of", start: 22, end: 23.5, sentenceStart: 20, startWord: 55, endWord: 58 }
  ];
  item.callerProfile.characteristics = [];
  item.triage.shortlist[0].evidenceRefs = [
    { id: "income-21-23", category: "income", quote: "can't earn money", start: 8.4, end: 9.5, sentenceStart: 5.2, startWord: 21, endWord: 23 }
  ];
  const report = buildReportDraft(item);
  const categories = new Set(report.evidence.map((entry) => entry.category));
  assert.deepEqual([...categories].sort(), ["age", "caregiving", "citizenship", "employment", "income", "medical"]);
  assert.ok(report.evidence.every((entry) => Number.isInteger(entry.startWord) && Number.isInteger(entry.endWord)));
  assert.equal(report.evidence.filter((entry) => entry.text === "can't earn money").length, 1);
});

test("review council exposes escalation triggers and AIC referral perspective", () => {
  const item = completeCase();
  item.translation = { status: "failed" };
  item.piiProposals[0].status = "proposed";
  item.callerProfile.missingCoreDetails = ["citizenship", "income"];
  item.triage.shortlist.push({ schemeId: "aic_hcg", name: "AIC Home Caregiving Grant", reasoning: "Referral consideration only.", insufficientInformation: [], appealRelevant: [], evidenceRefs: [] });
  const council = buildReviewCouncil(item);
  assert.equal(council.humanEscalationRequired, true);
  assert.ok(council.triggers.includes("Unresolved PII proposals"));
  assert.ok(council.perspectives.some((item) => item.id === "referral-opportunities" && /AIC Home Caregiving Grant/.test(item.summary)));
  const report = buildReportDraft(item);
  assert.ok(reportTextLines(report).some((line) => /Review council/.test(line)));
});

test("report drafting uses MERaLiON first and OpenAI as fallback", async () => {
  const primary = { name: "meralion", draft: async () => { throw new Error("MERaLiON unavailable"); } };
  const fallback = { name: "openai", draft: async () => ({ provider: "openai", applicantSummary: "Formal summary", sections: { presentingCircumstances: "Circumstances", assessment: "Assessment", recommendedFollowUp: "Follow up", safeguardsResolution: "" }, facts: { citizenship: { status: "unknown", explanation: "Not stated" }, applicantAge: { status: "verified", value: "35" }, householdIncome: { status: "verified", value: "0" }, householdSize: { status: "unknown", explanation: "Not stated" }, employment: { status: "verified", value: "Not working" } }, schemes: [{ schemeId: "smta", reasoning: "Consider under triage only." }] }) };
  const draft = await draftReportWithFallback(completeCase(), { primary, fallback });
  assert.equal(draft.provider, "openai");
  assert.equal(draft.fallbackReason, "MERaLiON unavailable");
  const report = buildReportDraft(completeCase(), 1, "2026-06-22T11:00:00.000Z", draft);
  assert.equal(report.metadata.reportDraftProvider, "openai");
  assert.equal(report.sections.assessment, "Assessment");
});

test("report drafting fails clearly when no provider is configured", async () => {
  const primary = { name: "meralion", draft: async () => { throw new Error("MERALION_API_KEY is not configured for report drafting"); } };
  const fallback = { name: "openai", draft: async () => { throw new Error("OPENAI_API_KEY is not configured for report drafting"); } };
  await assert.rejects(() => draftReportWithFallback(completeCase(), { primary, fallback }), /Report drafting unavailable/);
});
