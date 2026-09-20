import { voiceConfigured } from "./deepgram";

/** Server-side check used by pages to decide whether the mic buttons are live. */
export function deepgramReady(): boolean {
  return voiceConfigured();
}
