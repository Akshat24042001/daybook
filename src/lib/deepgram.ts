/**
 * Speech to text through Deepgram's pre-recorded API. The key stays on the server
 * (DEEPGRAM_API_KEY); the browser and Telegram only ever send audio to our own endpoints.
 * Never log the key or the audio.
 */

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

export function voiceConfigured(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Spoken languages the app asks Deepgram (nova-3) for:
 * - "multi": English and Hindi, including switching mid-sentence (nova-3 code-switching). The default.
 * - "gu": Gujarati. Deepgram cannot auto-detect Gujarati, so it has to be chosen explicitly.
 * - "en" / "hi": a single language, if ever needed.
 */
export const VOICE_LANGUAGES = ["multi", "gu", "en", "hi"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export function voiceLanguage(requested?: string | null): string {
  if (requested && (VOICE_LANGUAGES as readonly string[]).includes(requested)) return requested;
  return process.env.DEEPGRAM_LANGUAGE || "multi";
}

export async function transcribe(audio: ArrayBuffer | Uint8Array, contentType: string, language?: string | null): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new VoiceError("Voice input is not set up yet: DEEPGRAM_API_KEY is missing.");
  const size = audio.byteLength;
  if (size < 800) throw new VoiceError("That recording was too short to hear anything.");
  if (size > MAX_BYTES) throw new VoiceError("That recording is too long. Keep voice notes under 10 minutes.");

  const base = (process.env.DEEPGRAM_API_BASE || "https://api.deepgram.com").replace(/\/$/, "");
  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    language: voiceLanguage(language),
    smart_format: "true",
    punctuate: "true",
  });

  let res: Response;
  try {
    res = await fetch(`${base}/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "content-type": contentType || "application/octet-stream" },
      body: audio as BodyInit,
      signal: AbortSignal.timeout(50_000),
    });
  } catch {
    throw new VoiceError("Could not reach the speech service. Try again.");
  }
  if (res.status === 401 || res.status === 403) throw new VoiceError("The Deepgram key was rejected. Check DEEPGRAM_API_KEY.");
  if (!res.ok) throw new VoiceError(`The speech service failed (HTTP ${res.status}).`);
  const json = (await res.json().catch(() => null)) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  } | null;
  const text = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!text) throw new VoiceError("I could not make out any words. Try again a bit closer to the mic.");
  return text;
}
