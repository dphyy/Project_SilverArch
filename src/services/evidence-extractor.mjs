import { evidenceFromQuote, extractEvidence, mergeEvidence } from "../domain/evidence.mjs";

const EVIDENCE_SCHEMA_HINT = `Return only JSON with this shape:
[
  {"category":"citizenship|age|income|employment|medical|wellbeing|family|housing|caregiving|education","quote":"exact short quote copied from the transcript","requiresVerification":false}
]`;

const SYSTEM_PROMPT = `You identify officer-review evidence in translated social assistance intake transcripts.
Return short exact quotes from the transcript only. Do not paraphrase and do not infer facts.
Prioritize evidence that could justify triage or a supporting report: citizenship or residency, age, financial hardship, employment or inability to work, health or medical needs, wellbeing/safety, family/dependants, housing, caregiving, education or fees.
Exclude names, NRICs, phone numbers and administrative filler.`;

export class OpenAIEvidenceExtractor {
  name = "openai";
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_EVIDENCE_MODEL || process.env.OPENAI_REPORT_MODEL || "gpt-4.1-mini", timeoutMs = Number(process.env.OPENAI_EVIDENCE_TIMEOUT_MS || 30_000), fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey; this.model = model; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  configured() {
    return Boolean(this.apiKey);
  }
  async extract(transcript = {}) {
    if (!this.apiKey) return [];
    const text = String(transcript.text || (transcript.words || transcript.segments || []).map((word) => word.text).join(" ")).trim();
    if (!text) return [];
    const response = await this.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, store: false, temperature: 0, instructions: SYSTEM_PROMPT, input: `${EVIDENCE_SCHEMA_HINT}\n\nTranscript:\n${text}` }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`OpenAI evidence extraction failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    const body = await response.json();
    const output = body.output_text || (body.output || []).flatMap((item) => item.content || []).map((part) => part.text || "").join("");
    const parsed = JSON.parse(stripCodeFence(output));
    if (!Array.isArray(parsed)) throw new Error("OpenAI evidence extraction did not return an array");
    return parsed.slice(0, 24).map((item) => evidenceFromQuote(transcript, { ...item, source: this.name })).filter(Boolean);
  }
}

export async function extractEvidenceWithAI(transcript = {}, { baseExtractor = extractEvidence, ai = new OpenAIEvidenceExtractor() } = {}) {
  const deterministic = baseExtractor(transcript);
  if (!ai.configured?.()) return { evidence: deterministic, provider: "deterministic" };
  try {
    const modelEvidence = await ai.extract(transcript);
    return { evidence: mergeEvidence(deterministic, modelEvidence), provider: modelEvidence.length ? ai.name : "deterministic", modelEvidenceCount: modelEvidence.length };
  } catch (error) {
    return { evidence: deterministic, provider: "deterministic", error: error.message };
  }
}

export function evidenceExtractionCapability({ openaiKey = process.env.OPENAI_API_KEY } = {}) {
  return openaiKey ? "openai-configured" : "deterministic";
}

function stripCodeFence(value) {
  return String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
