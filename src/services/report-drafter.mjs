import { REPORT_FACTS, buildReportMaterial } from "../domain/report.mjs";

const REPORT_SCHEMA_HINT = `Return only JSON with this shape:
{
  "applicantSummary": "brief formal summary",
  "presentingCircumstances": "formal factual paragraph",
  "assessment": "formal officer-review assessment paragraph",
  "recommendedFollowUp": "formal follow-up paragraph",
  "safeguardsResolution": "formal safeguards/review flags paragraph or empty string",
  "facts": {
    "citizenship": {"status":"verified|unknown","value":"...","explanation":"..."},
    "applicantAge": {"status":"verified|unknown","value":"...","explanation":"..."},
    "householdIncome": {"status":"verified|unknown","value":"...","explanation":"..."},
    "householdSize": {"status":"verified|unknown","value":"...","explanation":"..."},
    "employment": {"status":"verified|unknown","value":"...","explanation":"..."}
  },
  "schemes": [{"schemeId":"...", "reasoning":"formal triage-only reasoning"}]
}`;

const SYSTEM_PROMPT = `You draft supporting case reports for Social Service Office review in Singapore.
Write in formal, neutral, factual language.
Do not invent facts. Preserve uncertainty and mark unavailable information as unknown with an explanation.
Scheme discussion is triage support only and must not say the caller is eligible.
Use the provided transcript, translation, evidence timestamps, caller profile, review flags and scheme shortlist only.`;

export class MeralionReportDrafter {
  name = "meralion";
  constructor({ apiKey = process.env.MERALION_API_KEY, baseUrl = process.env.MERALION_API_URL || "http://meralion.org:8010", model = process.env.MERALION_REPORT_MODEL || process.env.MERALION_TRANSLATION_MODEL || "MERaLiON/MERaLiON-3-10B", timeoutMs = Number(process.env.REPORT_DRAFT_TIMEOUT_MS || 60_000), fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey; this.baseUrl = baseUrl.replace(/\/$/, ""); this.model = model; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async draft(caseItem) {
    if (!this.apiKey) throw new Error("MERALION_API_KEY is not configured for report drafting");
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, temperature: 0.2, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `${REPORT_SCHEMA_HINT}\n\nCase material:\n${JSON.stringify(buildReportMaterial(caseItem))}` }] }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`MERaLiON report drafting failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    const body = await response.json();
    return normalizeDraft(JSON.parse(stripCodeFence(body.choices?.[0]?.message?.content || body.text || "")), this.name);
  }
}

export class OpenAIReportDrafter {
  name = "openai";
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_REPORT_MODEL || "gpt-4.1-mini", timeoutMs = Number(process.env.OPENAI_REPORT_TIMEOUT_MS || 60_000), fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey; this.model = model; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async draft(caseItem) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured for report drafting");
    const response = await this.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, store: false, temperature: 0.2, instructions: SYSTEM_PROMPT, input: `${REPORT_SCHEMA_HINT}\n\nCase material:\n${JSON.stringify(buildReportMaterial(caseItem))}` }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`OpenAI report drafting failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    const body = await response.json();
    const output = body.output_text || (body.output || []).flatMap((item) => item.content || []).map((part) => part.text || "").join("");
    return normalizeDraft(JSON.parse(stripCodeFence(output)), this.name);
  }
}

export async function draftReportWithFallback(caseItem, { primary = new MeralionReportDrafter(), fallback = new OpenAIReportDrafter() } = {}) {
  try {
    return await primary.draft(caseItem);
  } catch (primaryError) {
    try {
      const draft = await fallback.draft(caseItem);
      return { ...draft, fallbackReason: primaryError.message };
    } catch (fallbackError) {
      const error = new Error(`Report drafting unavailable: ${primaryError.message}; ${fallbackError.message}`);
      error.causes = [primaryError.message, fallbackError.message];
      throw error;
    }
  }
}

export function reportDraftingCapability({ meralionKey = process.env.MERALION_API_KEY, openaiKey = process.env.OPENAI_API_KEY } = {}) {
  if (meralionKey) return openaiKey ? "meralion-configured-openai-fallback" : "meralion-configured";
  if (openaiKey) return "openai-configured";
  return "unavailable";
}

function normalizeDraft(input = {}, provider) {
  const sections = {
    presentingCircumstances: clean(input.presentingCircumstances),
    assessment: clean(input.assessment),
    recommendedFollowUp: clean(input.recommendedFollowUp),
    safeguardsResolution: clean(input.safeguardsResolution)
  };
  const facts = Object.fromEntries(REPORT_FACTS.map(([key, label]) => {
    const fact = input.facts?.[key] || {};
    const status = fact.status === "verified" ? "verified" : "unknown";
    return [key, { label, status, value: clean(fact.value), explanation: clean(fact.explanation || (status === "unknown" ? "Not stated in the available transcript." : "")) }];
  }));
  const schemes = Array.isArray(input.schemes) ? input.schemes.map((scheme) => ({ schemeId: clean(scheme.schemeId), reasoning: clean(scheme.reasoning) })) : [];
  return { provider, applicantSummary: clean(input.applicantSummary), sections, facts, schemes };
}

function clean(value) {
  return String(value ?? "").trim();
}

function stripCodeFence(value) {
  return String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
