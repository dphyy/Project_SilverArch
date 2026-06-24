import test from "node:test";
import assert from "node:assert/strict";
import { MeralionProvider } from "../src/services/asr.mjs";
import { extractEvidenceWithAI, OpenAIEvidenceExtractor } from "../src/services/evidence-extractor.mjs";
import { translateWithFallback } from "../src/services/translation.mjs";

test("hosted MERaLiON request is primary and normalizes timestamps", async () => {
  const provider = new MeralionProvider({ apiKey: "key", baseUrl: "https://meralion.test", fetchImpl: async (url, options) => {
    assert.equal(url, "https://meralion.test/audio/transcription");
    assert.equal(options.headers.authorization, "Bearer key");
    assert.match(JSON.parse(options.body).audio_url, /^data:audio\/webm;base64,/);
    return new Response(JSON.stringify({ text: "hello", language: "en", words: [{ word: "hello", start: 1, end: 1.4, confidence: .9 }] }), { status: 200 });
  } });
  const result = await provider.transcribe({ buffer: Buffer.from("audio") });
  assert.equal(result.languageCode, "en");
  assert.equal(result.words[0].start, 1);
});

test("non-English translation uses MERaLiON first", async () => {
  let fallbackCalled = false;
  const primary = { name: "meralion", translate: async (sentences) => ({ text: "I need help.", sentences: [{ ...sentences[0], text: "I need help." }] }) };
  const fallback = { name: "google-translate", translate: async () => { fallbackCalled = true; } };
  const result = await translateWithFallback({ text: "我需要帮助。", languageCode: "zh", words: [{ text: "我需要帮助。", start: 2, end: 3 }] }, {}, { primary, fallback });
  assert.equal(result.provider, "meralion");
  assert.equal(fallbackCalled, false);
});

test("translation falls back to Google text translation with attribution and timestamps", async () => {
  const primary = { name: "meralion", translate: async () => { throw new Error("MERaLiON timeout"); } };
  const fallback = { name: "google-translate", translate: async (sentences) => ({ text: "Need help", sentences: [{ ...sentences[0], text: "Need help", sourceStart: sentences[0].start }] }) };
  const result = await translateWithFallback({ text: "需要帮助。", languageCode: "zh", words: [{ text: "需要帮助。", start: 4, end: 5 }] }, {}, { primary, fallback });
  assert.equal(result.provider, "google-translate");
  assert.equal(result.fallbackReason, "MERaLiON timeout");
  assert.equal(result.english.sentences[0].sourceStart, 4);
});

test("OpenAI evidence extraction is primary and maps exact quotes to highlights", async () => {
  const text = "I am from Singapore. I suffer from bone pain. I cannot earn money.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const ai = new OpenAIEvidenceExtractor({ apiKey: "test-key", model: "evidence-model", fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "evidence-model");
    assert.match(body.input, /I am from Singapore/);
    return new Response(JSON.stringify({ output_text: JSON.stringify([
      { category: "citizenship", quote: "from Singapore" },
      { category: "medical", quote: "suffer from bone pain" },
      { category: "income", quote: "cannot earn money" }
    ]) }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const result = await extractEvidenceWithAI({ text, words }, { ai, baseExtractor: () => [] });
  assert.equal(result.provider, "openai");
  assert.ok(result.evidence.some((item) => item.category === "citizenship" && item.source === "openai"));
  assert.ok(result.evidence.some((item) => item.category === "medical"));
  assert.ok(result.evidence.some((item) => item.category === "income"));
});

test("OpenAI evidence quotes that do not match the transcript are rejected", async () => {
  const text = "I have no income.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const ai = new OpenAIEvidenceExtractor({ apiKey: "test-key", fetchImpl: async () => new Response(JSON.stringify({ output_text: JSON.stringify([
    { category: "income", quote: "The applicant is unemployed and needs urgent help" }
  ]) }), { status: 200, headers: { "content-type": "application/json" } }) });
  const result = await extractEvidenceWithAI({ text, words }, { ai, baseExtractor: () => [] });
  assert.equal(result.provider, "deterministic");
  assert.equal(result.evidence.length, 0);
  assert.match(result.error, /no timestamp-mappable evidence/i);
});

test("deterministic safety evidence supplements OpenAI highlights", async () => {
  const text = "I am Singaporean and I don't want to be alive anymore.";
  const words = text.split(" ").map((word, index) => ({ text: word, start: index * 0.5, end: index * 0.5 + 0.4 }));
  const ai = new OpenAIEvidenceExtractor({ apiKey: "test-key", fetchImpl: async () => new Response(JSON.stringify({ output_text: JSON.stringify([
    { category: "citizenship", quote: "I am Singaporean" }
  ]) }), { status: 200, headers: { "content-type": "application/json" } }) });
  const result = await extractEvidenceWithAI({ text, words }, { ai });
  assert.equal(result.provider, "openai+deterministic-safety");
  assert.ok(result.evidence.some((item) => item.category === "citizenship" && item.source === "openai"));
  assert.ok(result.evidence.some((item) => item.category === "wellbeing"));
});
