"use client";

import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { logToDealAction, undoCaptureAction } from "@/app/sales-actions";
import { Button, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { VoiceButton } from "@/components/voice-button";

/** Shrinks a screenshot to a sensible size before it goes to the AI. */
async function toDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

export function CaptureBox({ dealId, voiceEnabled, placeholder, compact }: { dealId: number | null; voiceEnabled: boolean; placeholder?: string; compact?: boolean }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [direction, setDirection] = useState("");
  const [pending, start] = useTransition();
  const [last, setLast] = useState<{ id: number; summary: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 4 - images.length);
    const urls = await Promise.all(list.map(toDataUrl));
    setImages((cur) => [...cur, ...urls].slice(0, 4));
  };

  const submit = () =>
    start(async () => {
      const r = await logToDealAction(dealId, text, { channel: channel || undefined, direction: (direction || undefined) as "in" | "out" | "both" | undefined, images });
      if (!r.ok) {
        toast(r.error, "error");
        return;
      }
      const res = r.result;
      if (res.skipped) toast(res.skipped);
      else if (res.candidates?.length) toast(`Not sure who this is: ${res.candidates.map((c) => c.full_name).join(", ")}. Log it from the deal page instead.`, "error");
      else if (!res.deal_id) toast("Could not tell who this is about. Open the deal and paste it there.", "error");
      else {
        setLast({ id: res.capture_id ?? 0, summary: res.summary ?? "Logged" });
        toast(res.created_deal ? "New lead created" : "Logged", "ok", res.capture_id ? { label: "Undo", onClick: () => void undoCaptureAction(res.capture_id!).then(() => router.refresh()) } : undefined);
        if (!dealId && res.deal_id) router.push(`/sales/deal/${res.deal_id}`);
      }
      setText("");
      setImages([]);
      router.refresh();
    });

  return (
    <div className="rounded-2xl border border-border bg-surface p-3" onPaste={(e) => e.clipboardData.files.length && void addFiles(e.clipboardData.files)}>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "Paste a chat, an email, meeting notes, or just say what happened. Paste a screenshot too. AI files it: who, what, promises, next step."}
        className={compact ? "min-h-[64px]" : "min-h-[96px]"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      {images.length ? (
        <div className="mt-2 flex gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />
              <button type="button" aria-label="Remove" onClick={() => setImages((c) => c.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-fg p-0.5 text-bg">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel" className="h-8 w-36 text-xs">
          <option value="">Channel: auto</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="linkedin">LinkedIn</option>
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
          <option value="in_person">In person</option>
          <option value="instagram">Instagram</option>
          <option value="note">Note</option>
        </Select>
        <Select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Who wrote it" className="h-8 w-36 text-xs">
          <option value="">From: auto</option>
          <option value="in">From them</option>
          <option value="out">From me</option>
          <option value="both">Both / meeting</option>
        </Select>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Add screenshot">
          <ImagePlus className="h-4 w-4" /> Screenshot
        </Button>
        <VoiceButton enabled={voiceEnabled} onText={(t) => setText((cur) => (cur ? `${cur}\n${t}` : t))} showLabel label="Speak" />
        <Button size="sm" variant="primary" className="ml-auto" disabled={pending || (!text.trim() && !images.length)} onClick={submit}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {pending ? "Reading…" : "Log it"}
        </Button>
      </div>
      {last && !pending ? <p className="mt-2 text-xs text-subtle">Last: {last.summary}</p> : null}
    </div>
  );
}
