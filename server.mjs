import { createServer } from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { getTimeGate, dateFromDemoHour } from "./src/domain/time-gate.mjs";
import { transcribeWithFallback } from "./src/services/asr.mjs";
import { screenUrgency } from "./src/domain/urgency.mjs";
import { proposePiiRedactions } from "./src/domain/pii.mjs";
import { triageTranscript } from "./src/domain/triage.mjs";
import { loadEnv } from "./src/services/env.mjs";
import { buildCallerProfile, extractEvidence } from "./src/domain/evidence.mjs";
import { maskPhone, normalizeSingaporePhone } from "./src/domain/contact.mjs";
import { googleTranslateCapability, transcriptFromTranslation, translateWithFallback } from "./src/services/translation.mjs";
import { parseByteRange } from "./src/domain/audio.mjs";
import { buildReportDraft, reportDraftReadiness, reportReadiness } from "./src/domain/report.mjs";
import { renderReportDocx, renderReportPdf } from "./src/services/report-renderer.mjs";
import { draftReportWithFallback, reportDraftingCapability } from "./src/services/report-drafter.mjs";
import { evidenceExtractionCapability, extractEvidenceWithAI } from "./src/services/evidence-extractor.mjs";

const ROOT = new URL(".", import.meta.url).pathname;
await loadEnv(join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = join(ROOT, "public");
const CASES_FILE = join(ROOT, "data", "cases.json");
const AUDIO_DIR = join(ROOT, "data", "audio");
const REPORTS_DIR = join(ROOT, "data", "reports");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };

async function readCases() {
  try { return JSON.parse(await readFile(CASES_FILE, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function readReportStore(caseId) {
  try { return JSON.parse(await readFile(join(REPORTS_DIR, `${caseId}.json`), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { draft: null, finalized: [] }; throw error; }
}

async function writeReportStore(caseId, store) {
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(join(REPORTS_DIR, `${caseId}.json`), `${JSON.stringify(store, null, 2)}\n`);
}

async function removeReportStore(caseId) {
  try { await unlink(join(REPORTS_DIR, `${caseId}.json`)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit = 15 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Recording exceeds the 15 MB MVP limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/status") {
    return json(response, 200, {
      meralionConfigured: Boolean(process.env.MERALION_API_URL && process.env.MERALION_API_KEY),
      elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
      fallbackModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
      googleTranslate: googleTranslateCapability(),
      evidenceExtraction: evidenceExtractionCapability(),
      reportDrafting: reportDraftingCapability()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/time-gate") {
    const requestedHour = url.searchParams.has("demoHour") ? Number(url.searchParams.get("demoHour")) : null;
    const demoDate = dateFromDemoHour(requestedHour);
    return json(response, 200, { ...getTimeGate(demoDate || new Date()), demoOverride: Boolean(demoDate) });
  }

  if (request.method === "GET" && url.pathname === "/api/schemes") {
    return json(response, 200, JSON.parse(await readFile(join(ROOT, "data", "schemes.json"), "utf8")));
  }

  if (request.method === "GET" && url.pathname === "/api/cases") {
    const schemes = JSON.parse(await readFile(join(ROOT, "data", "schemes.json"), "utf8"));
    const reportDraftingAvailable = reportDraftingCapability() !== "unavailable";
    return json(response, 200, (await readCases()).map((item) => { const refreshed = refreshCaseAnalysis(item, schemes); return { ...refreshed, reportReadiness: reportReadiness(refreshed, { reportDraftingAvailable }) }; }));
  }

  if (request.method === "POST" && url.pathname === "/api/demo/fixtures") {
    const input = JSON.parse((await readBody(request, 16 * 1024)).toString("utf8") || "{}");
    const cases = await readCases();
    if (input.action === "reset") {
      const retained = cases.filter((item) => !item.isFixture);
      await Promise.all(cases.filter((item) => item.isFixture).map((item) => removeReportStore(item.id)));
      await writeFile(CASES_FILE, `${JSON.stringify(retained, null, 2)}\n`);
      return json(response, 200, { removed: cases.length - retained.length });
    }
    if (input.action !== "load") return json(response, 400, { error: "Demo action must be load or reset" });
    const definitions = JSON.parse(await readFile(join(ROOT, "data", "fixtures.json"), "utf8"));
    const schemes = JSON.parse(await readFile(join(ROOT, "data", "schemes.json"), "utf8"));
    const retained = cases.filter((item) => !item.isFixture);
    const fixtures = definitions.map((definition, index) => buildFixtureCase(definition, schemes, index));
    await writeFile(CASES_FILE, `${JSON.stringify([...fixtures, ...retained], null, 2)}\n`);
    return json(response, 200, { loaded: fixtures.length });
  }

  const readinessMatch = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)\/report-readiness$/);
  if (request.method === "GET" && readinessMatch) {
    const found = (await readCases()).find((item) => item.id === readinessMatch[1]);
    if (!found) return json(response, 404, { error: "Case not found" });
    return json(response, 200, reportReadiness(found, { reportDraftingAvailable: reportDraftingCapability() !== "unavailable" }));
  }

  const reportMatch = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)\/report$/);
  if (reportMatch && ["GET", "POST", "PATCH"].includes(request.method)) {
    const cases = await readCases();
    const caseIndex = cases.findIndex((item) => item.id === reportMatch[1]);
    if (caseIndex < 0) return json(response, 404, { error: "Case not found" });
    const store = await readReportStore(reportMatch[1]);
    if (request.method === "GET") {
      const current = store.draft || store.finalized.at(-1);
      return current ? json(response, 200, current) : json(response, 404, { error: "No report has been generated" });
    }
    if (request.method === "POST") {
      const readiness = reportReadiness(cases[caseIndex], { reportDraftingAvailable: reportDraftingCapability() !== "unavailable" });
      if (!readiness.ready) return json(response, 409, { error: "Case review is incomplete", readiness });
      if (store.draft?.status === "draft") return json(response, 200, store.draft);
      const version = Math.max(0, ...store.finalized.map((item) => Number(item.version) || 0)) + 1;
      const at = new Date().toISOString();
      const previous = store.finalized.at(-1);
      let generated = null;
      if (!previous) {
        try { generated = await draftReportWithFallback(cases[caseIndex]); }
        catch (error) { return json(response, 409, { error: error.message, causes: error.causes || [] }); }
      }
      store.draft = previous ? amendedReportDraft(previous, version, at) : buildReportDraft(cases[caseIndex], version, at, generated);
      cases[caseIndex] = { ...cases[caseIndex], status: "report-draft", reportSummary: { version, status: "draft", updatedAt: at }, auditEvents: [...(cases[caseIndex].auditEvents || []), ...(generated?.fallbackReason ? [{ at, actor: "system", action: "report-draft-provider-fallback", detail: generated.fallbackReason }] : []), { at, actor: "system", action: "report-draft-generated", detail: generated ? `Supporting report version ${version} drafted by ${generated.provider}` : `Supporting report version ${version} amended from finalized report` }] };
      await Promise.all([writeReportStore(reportMatch[1], store), writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`)]);
      return json(response, 201, store.draft);
    }
    if (!store.draft || store.draft.status !== "draft") return json(response, 409, { error: "Create an amended draft before editing a finalized report" });
    const input = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8") || "{}");
    store.draft = applyReportPatch(store.draft, input);
    const at = store.draft.updatedAt;
    cases[caseIndex] = { ...cases[caseIndex], reportSummary: { version: store.draft.version, status: "draft", updatedAt: at }, auditEvents: [...(cases[caseIndex].auditEvents || []), { at, actor: "officer", action: "report-draft-edited", detail: `Supporting report version ${store.draft.version}, revision ${store.draft.revision}` }] };
    await Promise.all([writeReportStore(reportMatch[1], store), writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`)]);
    return json(response, 200, store.draft);
  }

  const finalizeMatch = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)\/report\/finalize$/);
  if (request.method === "POST" && finalizeMatch) {
    const cases = await readCases(); const caseIndex = cases.findIndex((item) => item.id === finalizeMatch[1]);
    if (caseIndex < 0) return json(response, 404, { error: "Case not found" });
    const store = await readReportStore(finalizeMatch[1]);
    if (!store.draft || store.draft.status !== "draft") return json(response, 409, { error: "No editable report draft is available" });
    const readiness = reportDraftReadiness(store.draft);
    if (!readiness.ready) return json(response, 409, { error: "The report draft is incomplete", readiness });
    const at = new Date().toISOString(); const finalized = { ...store.draft, status: "finalized", finalizedAt: at, updatedAt: at };
    store.finalized.push(finalized); store.draft = finalized;
    cases[caseIndex] = { ...cases[caseIndex], status: "report-finalized", reportSummary: { version: finalized.version, status: "finalized", updatedAt: at }, auditEvents: [...(cases[caseIndex].auditEvents || []), { at, actor: "officer", action: "report-finalized", detail: `Supporting report version ${finalized.version} finalized` }] };
    await Promise.all([writeReportStore(finalizeMatch[1], store), writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`)]);
    return json(response, 200, finalized);
  }

  const downloadMatch = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)\/report\/download$/);
  if (request.method === "GET" && downloadMatch) {
    const cases = await readCases(); const caseIndex = cases.findIndex((item) => item.id === downloadMatch[1]);
    if (caseIndex < 0) return json(response, 404, { error: "Case not found" });
    const found = cases[caseIndex];
    const version = Number(url.searchParams.get("version")); const format = url.searchParams.get("format");
    if (!Number.isInteger(version) || !["docx", "pdf"].includes(format)) return json(response, 400, { error: "A valid finalized version and format are required" });
    const store = await readReportStore(downloadMatch[1]); const report = store.finalized.find((item) => item.version === version);
    if (!report) return json(response, 404, { error: "Finalized report version not found" });
    const file = format === "docx" ? await renderReportDocx(report) : await renderReportPdf(report);
    const at = new Date().toISOString();
    cases[caseIndex] = { ...found, auditEvents: [...(found.auditEvents || []), { at, actor: "officer", action: "report-downloaded", detail: `Supporting report version ${version} downloaded as ${format.toUpperCase()}` }] };
    await writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    response.writeHead(200, { "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf", "content-disposition": `attachment; filename="SilverArch-${found.id.slice(0, 8)}-v${version}.${format}"`, "content-length": file.length, "cache-control": "private, no-store" });
    return response.end(file);
  }

  if (request.method === "POST" && url.pathname === "/api/cases") {
    if (getTimeGate().canRecord === false && request.headers["x-demo-override"] !== "after-hours") {
      return json(response, 403, { error: "Recording is disabled while the live hotline is open." });
    }

    const audio = await readBody(request);
    if (!audio.length) return json(response, 400, { error: "No recording received." });
    const contactPhone = normalizeSingaporePhone(request.headers["x-contact-phone"]);
    if (!contactPhone) return json(response, 400, { error: "A valid Singapore contact number is required." });
    const id = randomUUID();
    const extension = request.headers["content-type"]?.includes("ogg") ? "ogg" : "webm";
    await mkdir(AUDIO_DIR, { recursive: true });
    await writeFile(join(AUDIO_DIR, `${id}.${extension}`), audio);
    const audioType = request.headers["content-type"] || "audio/webm";
    const transcript = await transcribeWithFallback({ buffer: audio, mimeType: audioType });
    transcript.originalText = transcript.text;
    const translation = transcript.transcriptionFailed ? { status: "unavailable", errors: ["Transcription failed"] } : await translateWithFallback(transcript, { buffer: audio, mimeType: audioType });
    const evidenceTranscript = translation.status === "ready" ? transcriptFromTranslation(translation.english) : transcript;
    const evidenceExtraction = await extractEvidenceWithAI(evidenceTranscript);
    const evidence = evidenceExtraction.evidence;
    const lowConfidence = Boolean(transcript.confidenceFlags?.length);
    const callerProfile = lowConfidence ? { summary: "Automatic summary withheld because the transcript requires confidence review.", characteristics: [], missingCoreDetails: [] } : buildCallerProfile(evidence);
    const urgency = screenUrgency(transcript.text);
    const schemes = JSON.parse(await readFile(join(ROOT, "data", "schemes.json"), "utf8"));
    const triageText = evidenceTranscript.text || transcript.text;
    const triage = transcript.transcriptionFailed ? { status: "manual-review", shortlist: [], reason: "Transcription failed" } : lowConfidence ? { status: "manual-review", shortlist: [], reason: "Automatic shortlist withheld because transcript confidence is low" } : triageTranscript(triageText, schemes, evidence);
    const createdAt = new Date().toISOString();
    const newCase = {
      id,
      createdAt,
      status: "needs-review",
      audioUrl: `/api/cases/${id}/audio`,
      audioType,
      audioDurationMs: Math.max(0, Number(request.headers["x-audio-duration-ms"]) || 0),
      intakeLanguage: normalizeIntakeLanguage(request.headers["x-intake-language"]),
      intakeMode: "web-call-simulator",
      contact: { phone: contactPhone, maskedPhone: maskPhone(contactPhone), purpose: "SSO follow-up after case review" },
      transcript,
      translation,
      evidence,
      evidenceLanguage: translation.status === "ready" ? "english" : "original",
      evidenceVersion: 4,
      evidenceProvider: evidenceExtraction.provider,
      ...(evidenceExtraction.error ? { evidenceProviderError: evidenceExtraction.error } : {}),
      callerProfile,
      urgency,
      piiProposals: proposePiiRedactions(transcript.text),
      triage,
      reviewReasons: [...(transcript.confidenceFlags || []), ...(triage.status === "manual-review" ? ["Triage requires officer review"] : []), ...(translation.status === "unavailable" && translation.sourceLanguage && !["en", "eng"].includes(translation.sourceLanguage) ? ["English translation unavailable — language-assisted review required"] : [])],
      auditEvents: [
        { at: createdAt, actor: "system", action: "case-created", detail: `Transcribed by ${transcript.asrEngine || "no provider"}` },
        ...(transcript.fallbackReason ? [{ at: createdAt, actor: "system", action: "asr-fallback", detail: `MERaLiON fallback: ${transcript.fallbackReason}` }] : []),
        { at: createdAt, actor: "system", action: `translation-${translation.status}`, detail: translation.provider ? `English translation by ${translation.provider}${translation.fallbackReason ? ` after fallback: ${translation.fallbackReason}` : ""}` : translation.errors?.length ? `Translation unavailable: ${translation.errors.join("; ")}` : "English translation not required" },
        { at: createdAt, actor: "system", action: `evidence-${evidenceExtraction.provider}`, detail: evidenceExtraction.error ? `Deterministic evidence retained after OpenAI error: ${evidenceExtraction.error}` : evidenceExtraction.provider === "openai" ? `OpenAI added ${evidenceExtraction.modelEvidenceCount || 0} evidence excerpt${evidenceExtraction.modelEvidenceCount === 1 ? "" : "s"}` : "Deterministic evidence extraction" }
      ]
    };
    const cases = await readCases();
    cases.unshift(newCase);
    await writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    return json(response, 201, newCase);
  }

  const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
  if (request.method === "PATCH" && caseMatch) {
    const input = JSON.parse((await readBody(request, 64 * 1024)).toString("utf8"));
    const allowed = new Set(["accepted", "escalated", "needs-review", "report-draft", "report-finalized"]);
    if (input.status && !allowed.has(input.status)) return json(response, 400, { error: "Invalid review status" });
    const cases = await readCases();
    const index = cases.findIndex((item) => item.id === caseMatch[1]);
    if (index < 0) return json(response, 404, { error: "Case not found" });
    const at = new Date().toISOString();
    const current = cases[index];
    let action = input.status ? `case-${input.status}` : "case-edited";
    let detail = input.status ? "Status updated in officer dashboard" : "Officer updated review fields";
    const piiProposals = [...(current.piiProposals || [])];
    if (input.piiDecision && Number.isInteger(input.piiDecision.index) && ["confirmed", "rejected"].includes(input.piiDecision.status) && piiProposals[input.piiDecision.index]) {
      piiProposals[input.piiDecision.index] = { ...piiProposals[input.piiDecision.index], status: input.piiDecision.status, reviewedAt: at };
      action = `pii-${input.piiDecision.status}`; detail = `${piiProposals[input.piiDecision.index].type} proposal reviewed`;
    }
    const shortlist = (current.triage?.shortlist || []).map((scheme) => input.reasoning?.schemeId === scheme.schemeId ? { ...scheme, officerReasoning: String(input.reasoning.text || "").slice(0, 2000) } : scheme);
    const officerFacts = input.facts && typeof input.facts === "object" ? Object.fromEntries(Object.entries(input.facts).slice(0, 30).map(([key, value]) => [key, String(value ?? "").slice(0, 500)])) : current.triage?.officerFacts;
    const officerProfile = input.officerProfile && typeof input.officerProfile === "object" ? cleanObject(input.officerProfile, ["name", "designation", "sso"], 200) : current.officerProfile;
    const consolidation = input.consolidation && typeof input.consolidation === "object" ? cleanObject(input.consolidation, ["presentingCircumstances", "assessment", "recommendedFollowUp", "safeguardsResolution"], 6000) : current.consolidation;
    const reviewAcknowledgements = input.reviewAcknowledgements && typeof input.reviewAcknowledgements === "object" ? { transcriptReviewed: Boolean(input.reviewAcknowledgements.transcriptReviewed), flagsReviewed: Boolean(input.reviewAcknowledgements.flagsReviewed), declaration: Boolean(input.reviewAcknowledgements.declaration) } : current.reviewAcknowledgements;
    const factReviews = input.factReviews && typeof input.factReviews === "object" ? cleanFactReviews(input.factReviews) : current.factReviews;
    cases[index] = {
      ...current,
      ...(input.status ? { status: input.status } : {}),
      transcript: { ...current.transcript, ...(typeof input.transcriptText === "string" ? { editedText: input.transcriptText.slice(0, 20_000) } : {}) },
      callerProfile: { ...current.callerProfile, ...(typeof input.summary === "string" ? { officerSummary: input.summary.slice(0, 4000) } : {}) },
      triage: { ...current.triage, shortlist, ...(officerFacts ? { officerFacts } : {}) },
      ...(officerProfile ? { officerProfile } : {}), ...(consolidation ? { consolidation } : {}), ...(reviewAcknowledgements ? { reviewAcknowledgements } : {}), ...(factReviews ? { factReviews } : {}),
      piiProposals,
      officerNote: typeof input.note === "string" ? input.note.slice(0, 2000) : current.officerNote,
      auditEvents: [...(current.auditEvents || []), { at, actor: "officer", action, detail }]
    };
    await writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    return json(response, 200, { ...cases[index], reportReadiness: reportReadiness(cases[index], { reportDraftingAvailable: reportDraftingCapability() !== "unavailable" }) });
  }

  const audioMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/audio$/);
  if ((request.method === "GET" || request.method === "HEAD") && audioMatch) {
    const found = (await readCases()).find((item) => item.id === audioMatch[1]);
    if (!found) return json(response, 404, { error: "Case not found" });
    const extension = found.audioType.includes("ogg") ? "ogg" : "webm";
    let audio;
    try { audio = await readFile(join(AUDIO_DIR, `${found.id}.${extension}`)); }
    catch (error) { if (error.code === "ENOENT") return json(response, 404, { error: "Audio file is no longer available" }); throw error; }
    const commonHeaders = { "content-type": found.audioType, "accept-ranges": "bytes", "cache-control": "private, no-store" };
    const range = request.headers.range;
    if (range) {
      const parsed = parseByteRange(range, audio.length);
      if (!parsed) { response.writeHead(416, { ...commonHeaders, "content-range": `bytes */${audio.length}` }); return response.end(); }
      const { start, end } = parsed;
      const chunk = audio.subarray(start, end + 1);
      response.writeHead(206, { ...commonHeaders, "content-range": `bytes ${start}-${end}/${audio.length}`, "content-length": chunk.length });
      return response.end(request.method === "HEAD" ? undefined : chunk);
    }
    response.writeHead(200, { ...commonHeaders, "content-length": audio.length });
    return response.end(request.method === "HEAD" ? undefined : audio);
  }

  return json(response, 404, { error: "Not found" });
}

function cleanObject(input, keys, maxLength) {
  return Object.fromEntries(keys.map((key) => [key, String(input[key] ?? "").slice(0, maxLength)]));
}

function normalizeIntakeLanguage(value) {
  return ["en", "zh", "ms", "ta"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "en";
}

function cleanFactReviews(input) {
  return Object.fromEntries(Object.entries(input).slice(0, 30).map(([key, value]) => [key, { status: ["verified", "unknown"].includes(value?.status) ? value.status : "", value: String(value?.value ?? "").slice(0, 500), explanation: String(value?.explanation ?? "").slice(0, 1000) }]));
}

function applyReportPatch(report, input) {
  const now = new Date().toISOString();
  const facts = { ...report.facts }; for (const [key, value] of Object.entries(input.facts || {})) if (facts[key]) facts[key] = { ...facts[key], status: value?.status === "unknown" ? "unknown" : "verified", value: String(value?.value ?? "").slice(0, 500), explanation: String(value?.explanation ?? "").slice(0, 1000) };
  const schemes = report.schemes.map((scheme) => { const update = (input.schemes || []).find((item) => item.schemeId === scheme.schemeId); return update ? { ...scheme, reasoning: String(update.reasoning ?? scheme.reasoning).slice(0, 6000) } : scheme; });
  return { ...report, revision: report.revision + 1, updatedAt: now, preparedBy: input.preparedBy ? { ...report.preparedBy, ...cleanObject(input.preparedBy, ["name", "designation", "sso"], 200) } : report.preparedBy, applicant: input.applicant ? { ...report.applicant, summary: String(input.applicant.summary ?? report.applicant.summary).slice(0, 6000) } : report.applicant, sections: input.sections ? { ...report.sections, ...cleanObject(input.sections, ["presentingCircumstances", "assessment", "recommendedFollowUp", "safeguardsResolution"], 8000) } : report.sections, facts, schemes, transcripts: input.transcripts ? { ...report.transcripts, verified: String(input.transcripts.verified ?? report.transcripts.verified).slice(0, 30000) } : report.transcripts };
}

function amendedReportDraft(previous, version, at) {
  const draft = structuredClone(previous);
  delete draft.finalizedAt;
  return { ...draft, version, revision: 1, status: "draft", createdAt: at, updatedAt: at };
}

function refreshCaseAnalysis(item, schemes) {
  if (!item.transcript?.text || item.evidenceVersion >= 4) return item;
  const analysisTranscript = item.translation?.status === "ready" ? transcriptFromTranslation(item.translation.english) : item.transcript;
  const evidence = extractEvidence(analysisTranscript);
  const triageText = analysisTranscript.text || item.transcript.text;
  return { ...item, evidence, evidenceVersion: 4, evidenceProvider: item.evidenceProvider || "deterministic", callerProfile: buildCallerProfile(evidence), triage: triageTranscript(triageText, schemes, evidence) };
}

function buildFixtureCase(definition, schemes, index) {
  const createdAt = new Date(Date.now() - index * 60_000).toISOString();
  const words = definition.text.split(/\s+/).map((text, wordIndex) => ({ text, start: wordIndex * 0.45, end: wordIndex * 0.45 + 0.35 }));
  const transcript = { text: definition.text, originalText: definition.text, words, segments: words, languageCode: definition.languageCode, asrEngine: "fixed-fixture", ...(definition.lowConfidence ? { confidenceFlags: ["Detectable audio-quality problem or missing transcript portion"] } : {}) };
  const translation = definition.english ? { status: "ready", provider: "fixed-fixture", sourceLanguage: definition.languageCode, targetLanguage: "en", english: { text: definition.english, sentences: [{ id: 0, text: definition.english, sourceStart: 0 }] } } : { status: "not-required", sourceLanguage: definition.languageCode };
  const analysisTranscript = definition.english ? transcriptFromTranslation(translation.english) : transcript;
  const evidence = extractEvidence(analysisTranscript);
  const lowConfidence = Boolean(definition.lowConfidence);
  const triage = lowConfidence ? { status: "manual-review", shortlist: [], reason: "Automatic shortlist withheld because transcript confidence is low" } : triageTranscript(analysisTranscript.text, schemes, evidence);
  return { id: `fixture-${definition.id}`, isFixture: true, fixtureLabel: definition.label, createdAt, status: "needs-review", audioUrl: null, audioType: null, audioDurationMs: words.at(-1)?.end * 1000 || 0, intakeLanguage: definition.languageCode === "zh" ? "zh" : "en", intakeMode: "web-call-simulator", contact: { phone: "+6590000000", maskedPhone: "+65 •••• 0000", purpose: "SSO follow-up after case review" }, transcript, translation, evidence, evidenceLanguage: definition.english ? "english" : "original", evidenceVersion: 4, evidenceProvider: "deterministic", callerProfile: lowConfidence ? { summary: "Automatic summary withheld because the transcript requires confidence review.", characteristics: [], missingCoreDetails: [] } : buildCallerProfile(evidence), urgency: screenUrgency(definition.text), piiProposals: proposePiiRedactions(definition.text), triage, reviewReasons: [...(transcript.confidenceFlags || []), ...(triage.status === "manual-review" ? ["Triage requires officer review"] : [])], auditEvents: [{ at: createdAt, actor: "system", action: "fixture-loaded", detail: definition.label }] };
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const path = join(PUBLIC, safe);
  if (!path.startsWith(PUBLIC)) return json(response, 403, { error: "Forbidden" });
  try {
    const body = await readFile(path);
    response.writeHead(200, { "content-type": `${MIME[extname(path)] || "application/octet-stream"}; charset=utf-8` });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { error: "Not found" });
    throw error;
  }
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    json(response, 500, { error: error.message || "Internal server error" });
  }
}).listen(PORT, () => console.log(`SilverArch running at http://localhost:${PORT}`));
