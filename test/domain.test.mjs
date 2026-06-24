import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTimeGate, dateFromDemoHour } from "../src/domain/time-gate.mjs";
import { ElevenLabsProvider, transcribeWithFallback } from "../src/services/asr.mjs";
import { screenUrgency } from "../src/domain/urgency.mjs";
import { proposePiiRedactions } from "../src/domain/pii.mjs";
import { triageTranscript } from "../src/domain/triage.mjs";
import { buildCallerProfile, extractEvidence } from "../src/domain/evidence.mjs";
import { normalizeSingaporePhone } from "../src/domain/contact.mjs";
import { extractTypedFacts } from "../src/domain/facts.mjs";
import { parseByteRange } from "../src/domain/audio.mjs";

test("hotline is open from 7am Singapore time", () => {
  assert.equal(getTimeGate(dateFromDemoHour(7)).mode, "open");
  assert.equal(getTimeGate(dateFromDemoHour(23)).mode, "open");
});

test("hotline is after-hours from midnight through 6:59am", () => {
  assert.equal(getTimeGate(dateFromDemoHour(0)).mode, "after-hours");
  assert.equal(getTimeGate(dateFromDemoHour(6)).canRecord, true);
});

test("ASR falls back only when primary fails and attributes engine", async () => {
  const primary = { name: "meralion", transcribe: async () => { throw new Error("timeout"); } };
  const fallback = { name: "elevenlabs", transcribe: async () => ({ text: "hello", segments: [] }) };
  const result = await transcribeWithFallback({ buffer: Buffer.from("audio") }, { primary, fallback });
  assert.equal(result.asrEngine, "elevenlabs");
  assert.equal(result.fallbackReason, "timeout");
});

test("ASR does not invoke fallback after primary success", async () => {
  let fallbackCalled = false;
  const primary = { name: "meralion", transcribe: async () => ({ text: "ok" }) };
  const fallback = { name: "elevenlabs", transcribe: async () => { fallbackCalled = true; } };
  assert.equal((await transcribeWithFallback(null, { primary, fallback })).asrEngine, "meralion");
  assert.equal(fallbackCalled, false);
});

test("ElevenLabs normalizes word timestamps and language metadata", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers["xi-api-key"], "test-key");
    assert.equal(options.body.get("model_id"), "scribe_v2");
    return new Response(JSON.stringify({
      text: "Need help",
      language_code: "en",
      language_probability: 0.98,
      words: [{ text: "Need", start: 0.1, end: 0.4, type: "word", speaker_id: "speaker_0", logprob: -0.1 }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await new ElevenLabsProvider({ apiKey: "test-key", fetchImpl }).transcribe({ buffer: Buffer.from("audio"), mimeType: "audio/webm" });
  assert.equal(result.languageCode, "en");
  assert.deepEqual(result.segments[0], { text: "Need", start: 0.1, end: 0.4 });
});

test("triage preserves missing facts and appeal context", () => {
  const schemes = [{ scheme_id: "smta", name: "SMTA", hard_ceilings: [{ field: "citizenship", rule: "SC or PR" }], flexible_criteria: [{ field: "income", benchmark: "800", note: "flexible" }] }];
  const result = triageTranscript("I lost my job and have high medical bills", schemes);
  assert.equal(result.status, "manual-review");
  assert.deepEqual(result.shortlist[0].insufficientInformation, ["citizenship not stated"]);
  assert.ok(result.shortlist[0].appealRelevant.includes("Medical burden mentioned"));
});

test("key evidence retains exact word timestamps and builds a caller profile", () => {
  const text = "I am a Singapore citizen I am 43 years old my monthly income is $1200 I have two children and I lost my job due to medical bills";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.4, end: index * 0.4 + 0.3 }));
  const evidence = extractEvidence({ text, words });
  assert.ok(evidence.some((item) => item.category === "citizenship" && item.text === "Singapore citizen"));
  assert.ok(evidence.some((item) => item.category === "age" && Math.abs(item.start - 2) < 0.001));
  assert.ok(evidence.some((item) => item.category === "income" && item.text.includes("$1200")));
  assert.ok(evidence.some((item) => item.category === "family" && item.text.includes("two children")));
  assert.ok(evidence.some((item) => item.category === "employment" && item.text === "lost my job"));
  const profile = buildCallerProfile(evidence);
  assert.equal(profile.missingCoreDetails.length, 0);
  assert.ok(profile.characteristics.some((item) => item.category === "medical"));
});

test("urgent language and proposed PII are separate signals", () => {
  assert.equal(screenUrgency("Someone is attacking me now").urgent, true);
  const proposals = proposePiiRedactions("Call me at 9123 4567, NRIC S1234567D");
  assert.deepEqual(proposals.map((item) => item.type), ["possible NRIC/FIN", "possible phone number"]);
  assert.ok(proposals.every((item) => item.status === "proposed"));
});

test("Singapore callback numbers are validated and normalized", () => {
  assert.equal(normalizeSingaporePhone("+65 9123-4567"), "+6591234567");
  assert.equal(normalizeSingaporePhone("6123 4567"), "+6561234567");
  assert.equal(normalizeSingaporePhone("71234567"), null);
});

test("spoken age, name strength, indirect income and sentence starts are extracted", () => {
  const text = "Yesterday was difficult. I'm Bobby, and I am thirty-five years old. My income is basically zero.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const evidence = extractEvidence({ text, words });
  assert.equal(evidence.find((item) => item.category === "name").requiresVerification, true);
  assert.match(evidence.find((item) => item.category === "age").text, /thirty-five years old/i);
  assert.ok(evidence.find((item) => item.category === "age").sentenceStart > 0);
  const facts = extractTypedFacts(text);
  assert.equal(facts.applicantAge, 35);
  assert.equal(facts.householdIncome, 0);
});

test("MC is surfaced as work interruption and caller rundown removes overlapping age matches", () => {
  const text = "I'm Bobby. I am thirty-five years old, Singaporean. My income is basically zero because I'm on MC.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const evidence = extractEvidence({ text, words });
  assert.equal(evidence.filter((item) => item.category === "age").length, 1);
  assert.equal(evidence.filter((item) => item.category === "employment" && /on MC/i.test(item.text)).length, 1);
  assert.equal(evidence.filter((item) => item.category === "income" && /on MC/i.test(item.text)).length, 0);
  const profile = buildCallerProfile(evidence);
  assert.equal(new Set(profile.characteristics.map((item) => `${item.category}:${item.value.toLowerCase()}`)).size, profile.characteristics.length);
  assert.ok(profile.characteristics.some((item) => item.category === "employment" && /on MC/i.test(item.value)));
  assert.equal(extractTypedFacts(text).hardship.medical, true);
});

test("scheme-relevant evidence includes cited role, family age and clinic bill phrases", () => {
  const text = "I was a Grab driver but injured my back. My household income is basically zero. I have two children aged nine and ten. I need help with a clinic bill.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const evidence = extractEvidence({ text, words });
  assert.ok(evidence.some((item) => item.category === "employment" && /driver/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "income" && /household income is basically zero/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "family" && /two children aged nine and ten/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "medical" && /clinic bill/i.test(item.text)));
});

test("essential utility fee evidence is extracted and kept in scheme citations", () => {
  const text = "My income is basically zero. The fees are insufficient to cover electricity usage. Electricity bills are expensive. I have two children. I am Singaporean.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const evidence = extractEvidence({ text, words });
  assert.ok(evidence.some((item) => item.category === "income" && /fees are insufficient to cover electricity usage/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "income" && /Electricity bills are expensive/i.test(item.text)));
  const schemes = [{ scheme_id: "smta", name: "SMTA", hard_ceilings: [], flexible_criteria: [{ field: "income", benchmark: "800" }] }];
  const triage = triageTranscript(text, schemes, evidence);
  assert.ok(triage.shortlist[0].appealRelevant.includes("Utility bills or essential fees mentioned"));
  assert.ok(triage.shortlist[0].evidenceRefs.some((item) => /fees are insufficient/i.test(item.quote)));
  assert.ok(triage.shortlist[0].evidenceRefs.some((item) => /Electricity bills are expensive/i.test(item.quote)));
});

test("translated testimony highlights citizenship, financial, health and care evidence", () => {
  const text = "I am from Singapore and I am 60 years old this year. I'm not working tonight, I have no work, I can't earn money. I suffer from bone pain all over my body, I'm in poor health, and I love seeing doctors, but I don't have enough money. I have children and grandchildren to take care of, and I also have elderly people to love and care for.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.4, end: index * 0.4 + 0.3 }));
  const evidence = extractEvidence({ text, words });
  assert.ok(evidence.some((item) => item.category === "citizenship" && /from Singapore/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "employment" && /not working|no work/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "income" && /can't earn money|don't have enough money/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "medical" && /bone pain|poor health|seeing doctors/i.test(item.text)));
  assert.ok(evidence.some((item) => item.category === "caregiving" && /take care of|care for/i.test(item.text)));
});

test("AIC referral schemes can be shortlisted from care and mobility evidence", () => {
  const schemes = JSON.parse(readFileSync(new URL("../data/schemes.json", import.meta.url), "utf8"));
  const text = "My elderly mother is frail and cannot bathe or transfer without help. I am her caregiver and we need a wheelchair and caregiver training.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.4, end: index * 0.4 + 0.3 }));
  const evidence = extractEvidence({ text, words });
  const triage = triageTranscript(text, schemes, evidence);
  assert.equal(triage.shortlist.length, 3);
  assert.ok(triage.shortlist.some((scheme) => scheme.schemeId.startsWith("aic_")));
  assert.ok(triage.shortlist.some((scheme) => /referral consideration only/i.test(scheme.reasoning)));
});

test("hard ceilings remain unknown until stated and only violations exclude", () => {
  const scheme = [{ scheme_id: "chas", name: "CHAS", hard_ceilings: [], flexible_criteria: [] }];
  const unknown = triageTranscript("I need help with a clinic bill", scheme);
  assert.equal(unknown.shortlist[0].hardCeilings[0].status, "unknown");
  const violated = triageTranscript("I am a foreigner and need help with a clinic bill", scheme);
  assert.equal(violated.shortlist.length, 0);
  assert.equal(violated.excluded[0].schemeId, "chas");
});

test("urgency categories remain distinct", () => {
  assert.equal(screenUrgency("I want to end my life").category, "self-harm");
  assert.equal(screenUrgency("My partner is attacking me now").category, "family-violence");
  assert.equal(screenUrgency("A stranger has a weapon and I am in danger").category, "immediate-danger");
});

test("audio byte ranges support ordinary, suffix and invalid requests", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.equal(parseByteRange("bytes=120-130", 100), false);
});
