export const MIXED_LANGUAGE_REVIEW_REASON = "Mixed-language speech was retained as [foreign language] because ASR could not transcribe that segment fully — review audio if needed.";
export const UNKNOWN_LANGUAGE_REVIEW_REASON = "ASR could not confidently identify the spoken language — officer language review is required.";

export function hasForeignLanguagePlaceholder(text = "") {
  const value = String(text || "");
  const languagePlaceholder = /\[(?:\s*(?:speaking\s+)?(?:foreign|non-english|another|unknown)\s+language\s*)\]|\b(?:speaking\s+)?foreign language\b/i.test(value);
  const nonTranscribedSegments = value.match(/\[(?:\s*(?:inaudible|unintelligible|unclear|unknown|noise|silence)\s*)\]/gi) || [];
  return languagePlaceholder || nonTranscribedSegments.length >= 2;
}

export function normalizeForeignLanguagePlaceholders(text = "") {
  return String(text || "")
    .replace(/\[(?:\s*(?:speaking\s+)?(?:foreign|non-english|another|unknown)\s+language\s*)\]/gi, "[foreign language]")
    .replace(/\b(?:speaking\s+)?foreign language\b/gi, "[foreign language]")
    .replace(/\[(?:\s*(?:inaudible|unintelligible|unclear|unknown|noise|silence)\s*)\]/gi, "[foreign language]")
    .replace(/\[\[foreign language\]\]/gi, "[foreign language]")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasNonEnglishScript(text = "") {
  return /\p{Script=Han}|\p{Script=Tamil}/u.test(String(text || ""));
}

export function requiresEnglishTranslation(transcript = {}) {
  const language = String(transcript.languageCode || "").toLowerCase();
  if (hasForeignLanguagePlaceholder(transcript.text)) return true;
  if (language && !["en", "eng", "english"].includes(language)) return true;
  return hasNonEnglishScript(transcript.text);
}

export function timestampedSentences(transcript = {}) {
  const words = transcript.words || transcript.segments || [];
  const sentences = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (/[.!?。！？][”"']?$/.test(word.text)) {
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

export class GoogleTextTranslator {
  name = "google-translate";
  constructor({ apiKey = process.env.GOOGLE_TRANSLATE_API_KEY, enabled = process.env.GOOGLE_TRANSLATE_ENABLED !== "false", targetLanguage = process.env.GOOGLE_TRANSLATE_TARGET_LANG || "en", timeoutMs = Number(process.env.GOOGLE_TRANSLATE_TIMEOUT_MS || 30_000), fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey; this.enabled = enabled; this.targetLanguage = targetLanguage; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async translate(sentences) {
    if (!this.apiKey || !this.enabled) throw new Error("Google Cloud Translation is not configured");
    const response = await this.fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: sentences.map((sentence) => sentence.text), target: this.targetLanguage, format: "text" }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`Google Cloud Translation failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    const body = await response.json();
    const translations = body.data?.translations || [];
    if (translations.length !== sentences.length) throw new Error("Google Cloud Translation did not preserve sentence count");
    const translated = sentences.map((source, index) => ({
      ...source,
      text: translations[index].translatedText || "",
      sourceText: source.text,
      sourceStart: source.start,
      sourceEnd: source.end,
      detectedSourceLanguage: translations[index].detectedSourceLanguage || null
    }));
    return { provider: this.name, text: translated.map((sentence) => sentence.text).join(" "), sentences: translated, words: [] };
  }
}

export async function translateWithFallback(transcript, audio, { primary = new MeralionTranslator(), fallback = new GoogleTextTranslator() } = {}) {
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

export function googleTranslateCapability({ apiKey = process.env.GOOGLE_TRANSLATE_API_KEY, enabled = process.env.GOOGLE_TRANSLATE_ENABLED !== "false" } = {}) {
  if (!enabled) return "disabled";
  return apiKey ? "configured" : "unavailable";
}
