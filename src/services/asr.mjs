export class AsrUnavailableError extends Error {}

export class StubMeralionProvider {
  name = "meralion";
  async transcribe() {
    throw new AsrUnavailableError("MERaLiON endpoint is not configured");
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
    form.append("file", new Blob([buffer], { type: mimeType }), mimeType.includes("ogg") ? "recording.ogg" : "recording.webm");
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
      confidenceFlags: lowConfidenceWords.length
        ? [`${lowConfidenceWords.length} low-confidence word${lowConfidenceWords.length === 1 ? "" : "s"} need audio review`]
        : []
    };
  }
}

export async function transcribeWithFallback(audio, {
  primary = new StubMeralionProvider(),
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
