export function requiresEnglishTranslation(transcript = {}) {
  const language = String(transcript.languageCode || "").toLowerCase();
  if (language && !["en", "eng", "english"].includes(language)) return true;
  return /\p{Script=Han}|\p{Script=Tamil}/u.test(transcript.text || "");
}

export function timestampedSentences(transcript = {}) {
  const words = transcript.words || transcript.segments || [];
  const sentences = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (/[.!?][”"']?$/.test(word.text)) {
      sentences.push(toSentence(current, sentences.length));
      current = [];
    }
  }
  if (current.length) sentences.push(toSentence(current, sentences.length));
  if (!sentences.length && transcript.text) sentences.push({ id: "sentence-0", text: transcript.text, start: 0, end: 0 });
  return sentences;
}

export function transcriptFromTranslation(translation = {}) {
  if (translation.words?.length) return { text: translation.text, words: translation.words, segments: translation.words };
  const words = (translation.sentences || []).flatMap((sentence) => {
    const tokens = sentence.text.split(/\s+/).filter(Boolean);
    const start = Number(sentence.sourceStart ?? sentence.start) || 0;
    const end = Number(sentence.sourceEnd ?? sentence.end) || start;
    const step = tokens.length ? Math.max(0, end - start) / tokens.length : 0;
    return tokens.map((text, index) => ({ text, start: start + step * index, end: start + step * (index + 1) }));
  });
  return { text: translation.text || "", words, segments: words };
}

function toSentence(words, index) {
  return { id: `sentence-${index}`, text: words.map((word) => word.text).join(" "), start: Number(words[0].start) || 0, end: Number(words.at(-1).end) || 0 };
}

export class MeralionTranslator {
  name = "meralion";
  constructor({ apiKey = process.env.MERALION_API_KEY, baseUrl = process.env.MERALION_API_URL || "http://meralion.org:8010", model = process.env.MERALION_TRANSLATION_MODEL || "MERaLiON/MERaLiON-3-10B", timeoutMs = Number(process.env.MERALION_TIMEOUT_MS || 30_000), fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey; this.baseUrl = baseUrl.replace(/\/$/, ""); this.model = model; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async translate(sentences) {
    if (!this.apiKey) throw new Error("MERALION_API_KEY is not configured");
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, temperature: 0, messages: [{ role: "system", content: "Translate each testimony sentence to clear English. Return only a JSON array with the same id and an englishText field. Do not add or infer facts." }, { role: "user", content: JSON.stringify(sentences.map(({ id, text }) => ({ id, text }))) }] }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`MERaLiON translation failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content || body.text || "";
    const parsed = JSON.parse(String(content).replace(/^```json\s*|\s*```$/g, ""));
    if (!Array.isArray(parsed) || parsed.length !== sentences.length) throw new Error("MERaLiON translation did not preserve sentence IDs");
    const translated = sentences.map((source) => {
      const match = parsed.find((item) => item.id === source.id);
      if (!match?.englishText) throw new Error(`Missing translation for ${source.id}`);
      return { ...source, text: match.englishText, sourceText: source.text, sourceStart: source.start, sourceEnd: source.end };
    });
    return { provider: this.name, text: translated.map((sentence) => sentence.text).join(" "), sentences: translated, words: [] };
  }
}

export class ElevenLabsDubbingTranslator {
  name = "elevenlabs-dubbing";
  constructor({ apiKey = process.env.ELEVENLABS_API_KEY, enabled = process.env.ELEVENLABS_DUBBING_ENABLED === "true", pollIntervalMs = Number(process.env.TRANSLATION_POLL_INTERVAL_MS || 2_000), timeoutMs = Number(process.env.TRANSLATION_TIMEOUT_MS || 180_000), fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey; this.enabled = enabled; this.pollIntervalMs = pollIntervalMs; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async translate(_sentences, { buffer, mimeType = "audio/webm" }) {
    if (!this.apiKey || !this.enabled) throw new Error("ElevenLabs Dubbing is not configured");
    const form = new FormData();
    form.append("target_lang", process.env.ELEVENLABS_DUBBING_TARGET_LANG || "en");
    form.append("source_lang", "auto");
    form.append("name", `SilverArch ${Date.now()}`);
    form.append("file", new Blob([buffer], { type: mimeType }), mimeType.includes("ogg") ? "recording.ogg" : "recording.webm");
    const createdResponse = await this.fetch("https://api.elevenlabs.io/v1/dubbing", { method: "POST", headers: { "xi-api-key": this.apiKey }, body: form });
    if (!createdResponse.ok) throw new Error(`ElevenLabs Dubbing creation failed (${createdResponse.status}): ${(await createdResponse.text()).slice(0, 240)}`);
    const { dubbing_id: dubbingId } = await createdResponse.json();
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const statusResponse = await this.fetch(`https://api.elevenlabs.io/v1/dubbing/${dubbingId}`, { headers: { "xi-api-key": this.apiKey } });
      if (!statusResponse.ok) throw new Error(`ElevenLabs Dubbing status failed (${statusResponse.status})`);
      const status = await statusResponse.json();
      if (status.status === "failed") throw new Error(status.error || "ElevenLabs Dubbing failed");
      if (status.status === "dubbed") break;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    if (Date.now() >= deadline) throw new Error("ElevenLabs Dubbing timed out");
    const transcriptResponse = await this.fetch(`https://api.elevenlabs.io/v1/dubbing/${dubbingId}/transcripts/en/format/json`, { headers: { "xi-api-key": this.apiKey } });
    if (!transcriptResponse.ok) throw new Error(`ElevenLabs translated transcript failed (${transcriptResponse.status})`);
    const body = await transcriptResponse.json();
    const utterances = body.json?.utterances || body.utterances || [];
    const sentences = utterances.map((utterance, index) => ({ id: `sentence-${index}`, text: utterance.text, start: Number(utterance.start_s) || 0, end: Number(utterance.end_s) || 0, sourceStart: Number(utterance.start_s) || 0, sourceEnd: Number(utterance.end_s) || 0 }));
    const words = utterances.flatMap((utterance) => (utterance.words || []).map((word) => ({ text: word.text, start: Number(word.start_s) || 0, end: Number(word.end_s) || 0 })));
    return { provider: this.name, dubbingId, text: sentences.map((sentence) => sentence.text).join(" "), sentences, words };
  }
}

export async function translateWithFallback(transcript, audio, { primary = new MeralionTranslator(), fallback = new ElevenLabsDubbingTranslator() } = {}) {
  if (!requiresEnglishTranslation(transcript)) return { status: "not-required", sourceLanguage: transcript.languageCode || "eng" };
  const sentences = timestampedSentences(transcript);
  try {
    return { status: "ready", sourceLanguage: transcript.languageCode, english: await primary.translate(sentences, audio), provider: primary.name };
  } catch (primaryError) {
    try {
      return { status: "ready", sourceLanguage: transcript.languageCode, english: await fallback.translate(sentences, audio), provider: fallback.name, fallbackReason: primaryError.message };
    } catch (fallbackError) {
      return { status: "unavailable", sourceLanguage: transcript.languageCode, errors: [primaryError.message, fallbackError.message] };
    }
  }
}

export async function probeElevenLabsDubbing({ apiKey = process.env.ELEVENLABS_API_KEY, enabled = process.env.ELEVENLABS_DUBBING_ENABLED === "true", fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || !enabled) return "unavailable";
  try {
    const response = await fetchImpl("https://api.elevenlabs.io/v1/dubbing?page_size=1", { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(5_000) });
    return response.ok ? "verified" : "configured-unverified";
  } catch { return "configured-unverified"; }
}
