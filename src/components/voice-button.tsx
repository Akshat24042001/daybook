"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "./toast";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const MAX_SECONDS = 90;

/**
 * Tap to record, tap again to stop. The audio goes to our own /api/voice/transcribe (the Deepgram key stays
 * on the server) and the transcript is handed to `onText`.
 */
export function VoiceButton({
  onText,
  enabled,
  className,
  label = "Speak",
}: {
  onText: (text: string) => void;
  enabled: boolean;
  className?: string;
  label?: string;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  async function start() {
    if (!enabled) {
      toast("Voice input needs a Deepgram key. Add DEEPGRAM_API_KEY to the environment.", "error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("This browser cannot record audio.", "error");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = async () => {
        cleanup();
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        setState("sending");
        try {
          const res = await fetch("/api/voice/transcribe", { method: "POST", headers: { "content-type": type }, body: blob });
          const json = (await res.json()) as { ok: boolean; text?: string; error?: string };
          if (json.ok && json.text) onText(json.text);
          else toast(json.error ?? "Voice input failed.", "error");
        } catch {
          toast("Could not reach the server.", "error");
        } finally {
          setState("idle");
        }
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((n) => {
          if (n + 1 >= MAX_SECONDS) stop();
          return n + 1;
        });
      }, 1000);
    } catch {
      cleanup();
      toast("Microphone access was blocked. Allow it in the browser and try again.", "error");
    }
  }

  const recording = state === "recording";
  return (
    <button
      type="button"
      onClick={recording ? stop : state === "idle" ? start : undefined}
      disabled={state === "sending"}
      aria-label={recording ? "Stop recording" : label}
      title={enabled ? label : "Voice needs a Deepgram key"}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm transition-colors",
        recording ? "border-bad bg-bad text-white" : "border-border bg-surface text-subtle hover:bg-muted hover:text-fg",
        !enabled && "opacity-60",
        className,
      )}
    >
      {state === "sending" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <>
          <Square className="h-3.5 w-3.5 fill-current" />
          <span className="tabular text-xs">{seconds}s</span>
        </>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}
