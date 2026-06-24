import { createServer } from "node:http";
import { copyFile, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { getTimeGate, dateFromDemoHour } from "./src/domain/time-gate.mjs";
import { transcribeWithFallback } from "./src/services/asr.mjs";
import { mergeUrgencyResults, screenUrgency } from "./src/domain/urgency.mjs";
import { proposePiiRedactions } from "./src/domain/pii.mjs";
import { triageTranscript } from "./src/domain/triage.mjs";
import { loadEnv } from "./src/services/env.mjs";
import { buildCallerProfile, extractEvidence } from "./src/domain/evidence.mjs";
import { maskPhone, normalizeSingaporePhone } from "./src/domain/contact.mjs";
import { googleTranslateCapability, hasForeignLanguagePlaceholder, MIXED_LANGUAGE_REVIEW_REASON, normalizeForeignLanguagePlaceholders, requiresEnglishTranslation, transcriptFromTranslation, translateWithFallback, UNKNOWN_LANGUAGE_REVIEW_REASON } from "./src/services/translation.mjs";
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
const DEMO_AUDIO_DIR = join(ROOT, "demo", "audio");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".webm": "audio/webm" };
const DEMO_AUDIO_CASES = [
  { id: "demo-audio-en-zh", label: "Demo audio · English + Mandarin", file: "test1-en-zh.mp3", intakeLanguage: "zh", phone: "+6590000001" },
  { id: "demo-audio-en", label: "Demo audio · English AIC referral", file: "test2-en.mp3", intakeLanguage: "en", phone: "+6590000002" },
  { id: "demo-audio-ms", label: "Demo audio · Malay long-form", file: "test3-ms.mp3", intakeLanguage: "ms", phone: "+6590000003" },
  { id: "demo-audio-ta", label: "Demo audio · Tamil safeguard", file: "test4-ta.mp3", intakeLanguage: "ta", phone: "+6590000004" }
];

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

  const reanalyseMatch = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)\/reanalyse$/);
  if (request.method === "POST" && reanalyseMatch) {
    const cases = await readCases();
    const caseIndex = cases.findIndex((item) => item.id === reanalyseMatch[1]);
    if (caseIndex < 0) return json(response, 404, { error: "Case not found" });
    const current = cases[caseIndex];
    let audio;
    try { audio = await readStoredAudio(current); }
    catch (error) { return json(response, error.code === "ENOENT" ? 404 : 500, { error: error.code === "ENOENT" ? "Audio file is no longer available" : error.message }); }
    const at = new Date().toISOString();
    const analysis = await analyseAudio(audio, current.audioType);
    const changed = analysisFingerprint(current) !== analysisFingerprint({ ...current, ...analysis });
    if (changed) await removeReportStore(current.id);
    const cleared = changed ? clearStaleReview(current) : current;
    cases[caseIndex] = {
      ...cleared,
      ...analysis,
      status: changed && ["report-draft", "report-finalized", "accepted"].includes(current.status) ? "needs-review" : current.status,
      auditEvents: [
        ...(current.auditEvents || []),
        ...analysisAuditEvents(analysis, at),
        { at, actor: "system", action: "audio-reanalysed", detail: changed ? "Audio was reprocessed and generated case analysis changed" : "Audio was reprocessed with no generated analysis changes" }
      ]
    };
    await writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    return json(response, 200, { ...cases[caseIndex], reportReadiness: reportReadiness(cases[caseIndex], { reportDraftingAvailable: reportDraftingCapability() !== "unavailable" }) });
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
    const extension = audioExtensionFromType(request.headers["content-type"]);
    await mkdir(AUDIO_DIR, { recursive: true });
    await writeFile(join(AUDIO_DIR, `${id}.${extension}`), audio);
    const audioType = request.headers["content-type"] || "audio/webm";
    const createdAt = new Date().toISOString();
    const analysis = await analyseAudio(audio, audioType);
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
      ...analysis,
      auditEvents: [
        { at: createdAt, actor: "system", action: "case-created", detail: `Transcribed by ${analysis.transcript.asrEngine || "no provider"}` },
        ...analysisAuditEvents(analysis, createdAt)
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
    let audio;
    try { audio = await readStoredAudio(found); }
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

async function analyseAudio(audio, audioType = "audio/webm") {
  const transcript = await transcribeWithFallback({ buffer: audio, mimeType: audioType });
  const hasMixedLanguageGap = hasForeignLanguagePlaceholder(transcript.text);
  if (hasMixedLanguageGap) {
    transcript.text = normalizeForeignLanguagePlaceholders(transcript.text);
    transcript.words = ensurePlaceholderWords(transcript.text, transcript.words || transcript.segments || []);
    transcript.segments = transcript.words.map(({ text, start, end }) => ({ text, start, end }));
  }
  transcript.originalText = transcript.text;
  const reviewFlags = [];
  if (hasMixedLanguageGap) reviewFlags.push(MIXED_LANGUAGE_REVIEW_REASON);
  if (!transcript.transcriptionFailed && !transcript.languageCode) {
    reviewFlags.push(UNKNOWN_LANGUAGE_REVIEW_REASON);
  }
  const translationRequired = !transcript.transcriptionFailed && requiresEnglishTranslation(transcript);
  const translation = transcript.transcriptionFailed ? { status: "unavailable", errors: ["Transcription failed"] } : await translateWithFallback(transcript, { buffer: audio, mimeType: audioType });
  const evidenceTranscript = translation.status === "ready" ? transcriptFromTranslation(translation.english) : transcript;
  const evidenceExtraction = await extractEvidenceWithAI(evidenceTranscript);
  const evidence = evidenceExtraction.evidence;
  const lowConfidence = Boolean(transcript.confidenceFlags?.length);
  const callerProfile = lowConfidence ? { summary: "Automatic summary withheld because the transcript requires confidence review.", characteristics: [], missingCoreDetails: [] } : buildCallerProfile(evidence);
  const urgency = mergeUrgencyResults([
    screenUrgency(transcript.text),
    screenUrgency(translation.status === "ready" ? translation.english?.text : ""),
    screenUrgency(evidence.filter((item) => ["wellbeing", "medical"].includes(item.category)).map((item) => item.text).join(" "))
  ]);
  const schemes = JSON.parse(await readFile(join(ROOT, "data", "schemes.json"), "utf8"));
  const triageText = evidenceTranscript.text || transcript.text;
  const triage = transcript.transcriptionFailed ? { status: "manual-review", shortlist: [], reason: "Transcription failed" } : lowConfidence ? { status: "manual-review", shortlist: [], reason: "Automatic shortlist withheld because transcript confidence is low" } : triageTranscript(triageText, schemes, evidence);
  return {
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
    reviewReasons: uniqueStrings([...reviewFlags, ...(transcript.confidenceFlags || []), ...(triage.status === "manual-review" ? ["Triage requires officer review"] : []), ...(translation.status === "unavailable" && translationRequired ? ["English translation unavailable — language-assisted review required"] : [])])
  };
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function ensurePlaceholderWords(text = "", existingWords = []) {
  const normalized = normalizeForeignLanguagePlaceholders(text);
  if (!normalized.includes("[foreign language]")) return existingWords;
  const existingText = existingWords.map((word) => word.text).join(" ");
  if (existingText.includes("[foreign language]")) return existingWords;
  const tokens = normalized.match(/\[foreign language\]|\S+/g) || [];
  if (!tokens.length) return existingWords;
  const duration = Math.max(...existingWords.map((word) => Number(word.end) || 0), tokens.length * 0.45);
  const step = duration / tokens.length;
  return tokens.map((token, index) => ({
    text: token,
    start: Number((index * step).toFixed(2)),
    end: Number(((index + 1) * step).toFixed(2))
  }));
}

function analysisAuditEvents(analysis, at) {
  return [
    ...(analysis.transcript.fallbackReason ? [{ at, actor: "system", action: "asr-fallback", detail: `MERaLiON fallback: ${analysis.transcript.fallbackReason}` }] : []),
    { at, actor: "system", action: `translation-${analysis.translation.status}`, detail: analysis.translation.provider ? `English translation by ${analysis.translation.provider}${analysis.translation.fallbackReason ? ` after fallback: ${analysis.translation.fallbackReason}` : ""}` : analysis.translation.errors?.length ? `Translation unavailable: ${analysis.translation.errors.join("; ")}` : "English translation not required" },
    { at, actor: "system", action: `evidence-${analysis.evidenceProvider}`, detail: evidenceAuditDetail(analysis) }
  ];
}

function evidenceAuditDetail(analysis = {}) {
  if (analysis.evidenceProviderError) return `Rule-based evidence retained after AI evidence issue: ${analysis.evidenceProviderError}`;
  if (analysis.evidenceProvider === "openai") return `OpenAI selected ${analysis.evidence?.length || 0} timestamped evidence highlight${analysis.evidence?.length === 1 ? "" : "s"}`;
  if (analysis.evidenceProvider === "openai+deterministic-safety") return "OpenAI evidence used first with rule-based safety supplementation";
  return "Rule-based evidence extraction";
}

function analysisFingerprint(item = {}) {
  return JSON.stringify({
    transcriptText: item.transcript?.text || "",
    transcriptLanguage: item.transcript?.languageCode || "",
    translationStatus: item.translation?.status || "",
    translationText: item.translation?.english?.text || "",
    evidence: (item.evidence || []).map(({ category, text, start, end }) => ({ category, text, start, end })),
    urgency: item.urgency || {},
    pii: (item.piiProposals || []).map(({ type, value }) => ({ type, value })),
    shortlist: (item.triage?.shortlist || []).map(({ schemeId, name, reasoning, insufficientInformation }) => ({ schemeId, name, reasoning, insufficientInformation })),
    reviewReasons: item.reviewReasons || []
  });
}

function clearStaleReview(caseItem = {}) {
  const { reportSummary, reviewAcknowledgements, factReviews, consolidation, officerNote, ...rest } = caseItem;
  return rest;
}

function audioExtensionFromType(audioType = "") {
  const lower = String(audioType).toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  return "webm";
}

async function readStoredAudio(caseItem = {}) {
  return readFile(join(AUDIO_DIR, `${caseItem.id}.${audioExtensionFromType(caseItem.audioType)}`));
}

async function seedDemoAudioCases() {
  await mkdir(AUDIO_DIR, { recursive: true });
  const cases = await readCases();
  const retained = cases.filter((item) => !item.isFixture);
  await Promise.all(cases.filter((item) => item.isFixture).map((item) => removeReportStore(item.id)));
  const existingIds = new Set(retained.map((item) => item.id));
  const seeded = [];
  for (const [index, definition] of DEMO_AUDIO_CASES.entries()) {
    const source = join(DEMO_AUDIO_DIR, definition.file);
    const destination = join(AUDIO_DIR, `${definition.id}.mp3`);
    try {
      await copyFile(source, destination);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.warn(`Demo audio source missing: ${source}`);
        continue;
      }
      throw error;
    }
    if (existingIds.has(definition.id)) continue;
    const audio = await readFile(destination);
    const at = new Date(Date.now() - index * 60_000).toISOString();
    const analysis = await analyseAudio(audio, "audio/mpeg");
    seeded.push({
      id: definition.id,
      isDemoAudio: true,
      demoLabel: definition.label,
      createdAt: at,
      status: "needs-review",
      audioUrl: `/api/cases/${definition.id}/audio`,
      audioType: "audio/mpeg",
      audioDurationMs: 0,
      intakeLanguage: definition.intakeLanguage,
      intakeMode: "demo-audio-seed",
      contact: { phone: definition.phone, maskedPhone: maskPhone(definition.phone), purpose: "SSO follow-up after case review" },
      ...analysis,
      auditEvents: [
        { at, actor: "system", action: "demo-audio-seeded", detail: definition.label },
        { at, actor: "system", action: "case-created", detail: `Transcribed by ${analysis.transcript.asrEngine || "no provider"}` },
        ...analysisAuditEvents(analysis, at)
      ]
    });
  }
  if (seeded.length || retained.length !== cases.length) await writeFile(CASES_FILE, `${JSON.stringify([...seeded, ...retained], null, 2)}\n`);
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

await seedDemoAudioCases();

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
