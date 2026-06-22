import test from "node:test";
import assert from "node:assert/strict";
import { buildReportDraft, redactTranscript, reportDraftReadiness, reportReadiness, reportTextLines } from "../src/domain/report.mjs";
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
  assert.equal(reportReadiness(item).ready, true);
  delete item.officerProfile.name;
  assert.equal(reportReadiness(item).ready, false);
  assert.ok(reportReadiness(item).missing.some((entry) => entry.id === "officer-name"));
  item.officerProfile.name = "Alicia Lim";
  item.factReviews.citizenship.explanation = "";
  assert.ok(reportReadiness(item).missing.some((entry) => entry.id === "fact-citizenship"));
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
