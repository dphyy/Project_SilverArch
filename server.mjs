import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { getTimeGate, dateFromDemoHour } from "./src/domain/time-gate.mjs";
import { transcribeWithFallback } from "./src/services/asr.mjs";
import { screenUrgency } from "./src/domain/urgency.mjs";
import { proposePiiRedactions } from "./src/domain/pii.mjs";
import { triageTranscript } from "./src/domain/triage.mjs";
import { loadEnv } from "./src/services/env.mjs";
import { buildCallerProfile, extractEvidence } from "./src/domain/evidence.mjs";

const ROOT = new URL(".", import.meta.url).pathname;
await loadEnv(join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = join(ROOT, "public");
const CASES_FILE = join(ROOT, "data", "cases.json");
const AUDIO_DIR = join(ROOT, "data", "audio");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

async function readCases() {
  try { return JSON.parse(await readFile(CASES_FILE, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
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
      fallbackModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2"
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
    return json(response, 200, await readCases());
  }

  if (request.method === "POST" && url.pathname === "/api/cases") {
    if (getTimeGate().canRecord === false && request.headers["x-demo-override"] !== "after-hours") {
      return json(response, 403, { error: "Recording is disabled while the live hotline is open." });
    }

    const audio = await readBody(request);
    if (!audio.length) return json(response, 400, { error: "No recording received." });
    const id = randomUUID();
    const extension = request.headers["content-type"]?.includes("ogg") ? "ogg" : "webm";
    await mkdir(AUDIO_DIR, { recursive: true });
    await writeFile(join(AUDIO_DIR, `${id}.${extension}`), audio);
    const audioType = request.headers["content-type"] || "audio/webm";
    const transcript = await transcribeWithFallback({ buffer: audio, mimeType: audioType });
    const evidence = extractEvidence(transcript);
    const callerProfile = buildCallerProfile(evidence);
    const urgency = screenUrgency(transcript.text);
    const schemes = JSON.parse(await readFile(join(ROOT, "data", "schemes.json"), "utf8"));
    const triage = transcript.transcriptionFailed ? { status: "manual-review", shortlist: [], reason: "Transcription failed" } : triageTranscript(transcript.text, schemes);
    const createdAt = new Date().toISOString();
    const newCase = {
      id,
      createdAt,
      status: "needs-review",
      audioUrl: `/api/cases/${id}/audio`,
      audioType,
      transcript,
      evidence,
      callerProfile,
      urgency,
      piiProposals: proposePiiRedactions(transcript.text),
      triage,
      reviewReasons: [...(transcript.confidenceFlags || []), ...(triage.status === "manual-review" ? ["Triage requires officer review"] : [])],
      auditEvents: [{ at: createdAt, actor: "system", action: "case-created", detail: `Transcribed by ${transcript.asrEngine || "no provider"}` }]
    };
    const cases = await readCases();
    cases.unshift(newCase);
    await writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    return json(response, 201, newCase);
  }

  const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
  if (request.method === "PATCH" && caseMatch) {
    const input = JSON.parse((await readBody(request, 64 * 1024)).toString("utf8"));
    const allowed = new Set(["accepted", "escalated", "needs-review"]);
    if (!allowed.has(input.status)) return json(response, 400, { error: "Invalid review status" });
    const cases = await readCases();
    const index = cases.findIndex((item) => item.id === caseMatch[1]);
    if (index < 0) return json(response, 404, { error: "Case not found" });
    const at = new Date().toISOString();
    cases[index] = {
      ...cases[index],
      status: input.status,
      auditEvents: [...(cases[index].auditEvents || []), { at, actor: "officer", action: `case-${input.status}`, detail: input.note || "Status updated in officer dashboard" }]
    };
    await writeFile(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    return json(response, 200, cases[index]);
  }

  const audioMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/audio$/);
  if (request.method === "GET" && audioMatch) {
    const found = (await readCases()).find((item) => item.id === audioMatch[1]);
    if (!found) return json(response, 404, { error: "Case not found" });
    const extension = found.audioType.includes("ogg") ? "ogg" : "webm";
    let audio;
    try { audio = await readFile(join(AUDIO_DIR, `${found.id}.${extension}`)); }
    catch (error) { if (error.code === "ENOENT") return json(response, 404, { error: "Audio file is no longer available" }); throw error; }
    response.writeHead(200, { "content-type": found.audioType, "content-length": audio.length });
    return response.end(audio);
  }

  return json(response, 404, { error: "Not found" });
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
