import test from "node:test";
import assert from "node:assert/strict";
import { getTimeGate, dateFromDemoHour } from "../src/domain/time-gate.mjs";
import { ElevenLabsProvider, transcribeWithFallback } from "../src/services/asr.mjs";
import { screenUrgency } from "../src/domain/urgency.mjs";
import { proposePiiRedactions } from "../src/domain/pii.mjs";
import { triageTranscript } from "../src/domain/triage.mjs";
import { buildCallerProfile, extractEvidence } from "../src/domain/evidence.mjs";

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
