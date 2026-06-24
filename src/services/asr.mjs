export class AsrUnavailableError extends Error {}

export class MeralionProvider {
  name = "meralion";

  constructor({
    apiKey = process.env.MERALION_API_KEY,
    baseUrl = process.env.MERALION_API_URL || "http://meralion.org:8010",
    timeoutMs = Number(process.env.MERALION_TIMEOUT_MS || 30_000),
    fetchImpl = globalThis.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async transcribe({ buffer, mimeType = "audio/webm" }) {
    if (!this.apiKey) throw new AsrUnavailableError("MERALION_API_KEY is not configured");
    const audioUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const response = await this.fetch(`${this.baseUrl}/audio/transcription`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`MERaLiON transcription failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    const result = await response.json();
    const rawWords = result.words || result.segments?.flatMap((segment) => segment.words || []) || [];
    const words = rawWords.map((word) => ({
      text: word.text || word.word || "",
      start: Number(word.start ?? word.start_s ?? 0),
      end: Number(word.end ?? word.end_s ?? 0),
      speakerId: word.speaker_id || null,
      confidence: word.confidence ?? null
    })).filter((word) => word.text);
    return {
      text: result.text || result.transcript || result.transcription || words.map((word) => word.text).join(" "),
      words,
      segments: words.map(({ text, start, end }) => ({ text, start, end })),
      languageCode: result.language_code || result.language || null,
      languageProbability: result.language_probability ?? null,
      confidenceFlags: words.some((word) => typeof word.confidence === "number" && word.confidence < 0.45)
        ? ["MERaLiON identified low-confidence words that need audio review"] : []
    };
  }
}

export class ElevenLabsProvider {
  name = "elevenlabs";

  constructor({
    apiKey = process.env.ELEVENLABS_API_KEY,
    model = process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
    fetchImpl = globalThis.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  async transcribe({ buffer, mimeType = "audio/webm" }) {
    if (!this.apiKey) throw new AsrUnavailableError("ELEVENLABS_API_KEY is not configured");
    const form = new FormData();
    form.append("model_id", this.model);
    form.append("file", new Blob([buffer], { type: mimeType }), recordingFilename(mimeType));
    const response = await this.fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
      signal: AbortSignal.timeout(90_000)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`ElevenLabs transcription failed (${response.status}): ${detail.slice(0, 240)}`);
    }
    const result = await response.json();
    const words = (result.words || []).filter((word) => word.type === "word");
    const lowConfidenceWords = words.filter((word) => typeof word.logprob === "number" && word.logprob < -1.5);
    return {
      text: result.text || "",
      words: words.map(({ text, start, end, speaker_id, logprob }) => ({ text, start, end, speakerId: speaker_id, logprob })),
      segments: words.map(({ text, start, end }) => ({ text, start, end })),
      languageCode: result.language_code || null,
      languageProbability: result.language_probability ?? null,
      confidenceDetails: lowConfidenceWords.slice(0, 8).map((word) => ({ reason: "Low word confidence", text: word.text, start: word.start, end: word.end })),
      confidenceFlags: lowConfidenceWords.length
        ? [`${lowConfidenceWords.length} low-confidence word${lowConfidenceWords.length === 1 ? "" : "s"} need audio review`]
        : []
    };
  }
}

function recordingFilename(mimeType = "") {
  const lower = String(mimeType).toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return "recording.mp3";
  if (lower.includes("ogg")) return "recording.ogg";
  if (lower.includes("wav")) return "recording.wav";
  return "recording.webm";
}

export async function transcribeWithFallback(audio, {
  primary = new MeralionProvider(),
  fallback = new ElevenLabsProvider()
} = {}) {
  try {
    return { ...(await primary.transcribe(audio)), asrEngine: primary.name };
  } catch (primaryError) {
    try {
      return {
        ...(await fallback.transcribe(audio)),
        asrEngine: fallback.name,
        fallbackReason: primaryError.message
      };
    } catch (fallbackError) {
      return {
        text: "",
        segments: [],
        asrEngine: null,
        transcriptionFailed: true,
        confidenceFlags: ["Both transcription providers failed — play raw audio manually"],
        errors: [primaryError.message, fallbackError.message]
      };
    }
  }
}
