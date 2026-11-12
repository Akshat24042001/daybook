import { NextResponse } from "next/server";
import { transcribe, VoiceError, voiceConfigured } from "@/lib/deepgram";
import { currentRep, NotSignedIn } from "@/lib/team/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The mic for the sales team: same speech service, behind their own sign-in. */
export async function POST(req: Request) {
  try {
    await currentRep();
  } catch (e) {
    if (e instanceof NotSignedIn) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    throw e;
  }
  if (!voiceConfigured()) return NextResponse.json({ ok: false, error: "Voice input is not set up." }, { status: 503 });
  const type = req.headers.get("content-type") ?? "";
  if (!/^audio\//i.test(type) && !/^video\/webm/i.test(type)) return NextResponse.json({ ok: false, error: "Send audio." }, { status: 415 });
  const audio = await req.arrayBuffer();
  if (audio.byteLength > 12 * 1024 * 1024) return NextResponse.json({ ok: false, error: "That recording is too long." }, { status: 413 });
  try {
    return NextResponse.json({ ok: true, text: await transcribe(audio, type, new URL(req.url).searchParams.get("lang")) });
  } catch (e) {
    if (e instanceof VoiceError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    return NextResponse.json({ ok: false, error: "Voice input failed. Try again." }, { status: 500 });
  }
}
