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

export async function transcribe(audio: ArrayBuffer | Uint8Array, contentType: string): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new VoiceError("Voice input is not set up yet: DEEPGRAM_API_KEY is missing.");
  const size = audio.byteLength;
  if (size < 800) throw new VoiceError("That recording was too short to hear anything.");
  if (size > MAX_BYTES) throw new VoiceError("That recording is too long. Keep voice notes under a couple of minutes.");

  const base = (process.env.DEEPGRAM_API_BASE || "https://api.deepgram.com").replace(/\/$/, "");
  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    language: process.env.DEEPGRAM_LANGUAGE || "en",
    smart_format: "true",
    punctuate: "true",
  });

  let res: Response;
  try {
    res = await fetch(`${base}/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "content-type": contentType || "application/octet-stream" },
      body: audio as BodyInit,
      signal: AbortSignal.timeout(30_000),
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
