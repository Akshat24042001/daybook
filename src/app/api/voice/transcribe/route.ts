import { NextResponse } from "next/server";
import { transcribe, VoiceError, voiceConfigured } from "@/lib/deepgram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Browser mic button -> Deepgram. Behind the login; the Deepgram key never reaches the browser. */
export async function POST(req: Request) {
  if (!voiceConfigured()) {
    return NextResponse.json({ ok: false, error: "Voice input is not set up yet: DEEPGRAM_API_KEY is missing." }, { status: 503 });
  }
  const type = req.headers.get("content-type") ?? "";
  if (!/^audio\//i.test(type) && !/^video\/webm/i.test(type)) {
    return NextResponse.json({ ok: false, error: "Send audio." }, { status: 415 });
  }
  const audio = await req.arrayBuffer();
  try {
    const text = await transcribe(audio, type);
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    if (e instanceof VoiceError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    console.error("[voice] failed:", (e as Error).name);
    return NextResponse.json({ ok: false, error: "Voice input failed. Try again." }, { status: 500 });
  }
}
