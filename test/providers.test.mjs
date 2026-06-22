import test from "node:test";
import assert from "node:assert/strict";
import { MeralionProvider } from "../src/services/asr.mjs";
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
  const fallback = { name: "elevenlabs-dubbing", translate: async () => { fallbackCalled = true; } };
  const result = await translateWithFallback({ text: "我需要帮助。", languageCode: "zh", words: [{ text: "我需要帮助。", start: 2, end: 3 }] }, {}, { primary, fallback });
  assert.equal(result.provider, "meralion");
  assert.equal(fallbackCalled, false);
});

test("translation falls back to ElevenLabs Dubbing with attribution", async () => {
  const primary = { name: "meralion", translate: async () => { throw new Error("MERaLiON timeout"); } };
  const fallback = { name: "elevenlabs-dubbing", translate: async () => ({ text: "Need help", sentences: [{ text: "Need help", sourceStart: 4 }] }) };
  const result = await translateWithFallback({ text: "需要帮助", languageCode: "zh" }, {}, { primary, fallback });
  assert.equal(result.provider, "elevenlabs-dubbing");
  assert.equal(result.fallbackReason, "MERaLiON timeout");
});
