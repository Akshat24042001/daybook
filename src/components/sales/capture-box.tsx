"use client";

import { Check, ImagePlus, Loader2, Send, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { logToDealAction, resolveCaptureAction, undoCaptureAction } from "@/app/sales-actions";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { VoiceButton } from "@/components/voice-button";
import { cn } from "@/lib/cn";
import type { CaptureResult } from "@/lib/sales/ingest";

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

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** What the capture did, in plain lines, so you can see where everything went. */
function Filed({ r, onUndo }: { r: CaptureResult; onUndo?: () => void }) {
  const lines: string[] = [];
  if (r.created_deal) lines.push("New lead created");
  if (r.message_count) lines.push(`${r.message_count} message${r.message_count > 1 ? "s" : ""} logged${r.channel ? ` (${r.channel.replace("_", " ")})` : ""}`);
  else if (r.interactions?.length) lines.push(`Logged to the timeline${r.channel ? ` (${r.channel.replace("_", " ")})` : ""}`);
  if (r.already) lines.push(`${r.already} message${r.already > 1 ? "s were" : " was"} already on the deal, not logged again`);
  for (const c of r.commitment_texts ?? []) lines.push(`Promise: ${c}`);
  if (r.meeting_at) lines.push(`Meeting: ${when(r.meeting_at)}`);
  if (r.moved) lines.push(`Moved to ${r.moved}`);
  if (r.shots) lines.push(`${r.shots} screenshot${r.shots > 1 ? "s" : ""} saved on the deal`);
  if (r.filled?.length) lines.push(`Filled in: ${[...new Set(r.filled)].join(", ")}`);
  return (
    <div className="mt-3 rounded-xl border border-good/30 bg-good-muted/40 p-3 text-sm" aria-label="What was filed">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          <Check className="mr-1 inline h-4 w-4 text-good" />
          Filed to {r.deal_id ? <Link href={`/sales/deal/${r.deal_id}`} className="text-accent underline-offset-2 hover:underline">{r.deal_title ?? "the deal"}</Link> : "Sales"}
        </p>
        {onUndo ? <button type="button" onClick={onUndo} className="text-xs text-subtle hover:text-fg hover:underline">Undo</button> : null}
      </div>
      {r.summary ? <p className="mt-1 text-subtle">{r.summary}</p> : null}
      {lines.length ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px]">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      ) : null}
      {r.next_step ? <p className="mt-1.5 text-[13px]"><span className="font-medium">Next step:</span> {r.next_step}</p> : null}
      {r.suggestion ? (
        <p className="mt-1.5 text-[13px]">
          <span className="font-medium">Suggested:</span> {r.suggestion.label}{" "}
          {r.deal_id ? <Link href={`/sales/deal/${r.deal_id}`} className="text-accent hover:underline">Open the deal to do it</Link> : null}
        </p>
      ) : null}
    </div>
  );
}

export function CaptureBox({ dealId, voiceEnabled, placeholder, compact }: { dealId: number | null; voiceEnabled: boolean; placeholder?: string; compact?: boolean }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [direction, setDirection] = useState("");
  const [pending, start] = useTransition();
  const [last, setLast] = useState<CaptureResult | null>(null);
  // the capture could not tell who it was about: ask
  const [ask, setAsk] = useState<CaptureResult | null>(null);
  const [newName, setNewName] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  const addFiles = async (files: FileList | File[]) => {
    const all = Array.from(files);
    // a WhatsApp export or any text file: its text goes into the box
    for (const f of all.filter((x) => x.type.startsWith("text/") || /\.txt$/i.test(x.name))) {
      const t = await f.text();
      setText((cur) => (cur ? `${cur}\n${t}` : t));
    }
    const list = all.filter((f) => f.type.startsWith("image/")).slice(0, 4 - images.length);
    if (all.some((f) => f.type.startsWith("image/")) && !list.length) toast("Up to 4 screenshots at a time.", "error");
    const urls = await Promise.all(list.map(toDataUrl));
    setImages((cur) => [...cur, ...urls].slice(0, 4));
  };

  const undo = (id: number) =>
    start(async () => {
      const r = await undoCaptureAction(id);
      if (!r.ok) return toast(r.error, "error");
      setLast(null);
      toast("Undone");
      router.refresh();
    });

  const handle = (res: CaptureResult) => {
    if (res.skipped) {
      toast(res.skipped);
      return;
    }
    if (res.candidates?.length || !res.deal_id) {
      setAsk(res);
      setLast(null);
      return;
    }
    setAsk(null);
    setLast(res);
    toast(res.created_deal ? "New lead created" : "Filed");
    setText("");
    setImages([]);
    router.refresh();
  };

  const submit = () =>
    start(async () => {
      const r = await logToDealAction(dealId, text, { channel: channel || undefined, direction: (direction || undefined) as "in" | "out" | "both" | undefined, images });
      if (!r.ok) return toast(r.error, "error");
      handle(r.result);
    });

  const resolve = (who: { person_id?: number; newPersonName?: string }) =>
    start(async () => {
      if (!ask?.capture_id) return;
      const r = await resolveCaptureAction(ask.capture_id, who);
      if (!r.ok) return toast(r.error, "error");
      setNewName("");
      handle(r.result);
    });

  return (
    <div
      className={cn("rounded-2xl border border-border bg-surface p-3 transition-colors", over && "border-accent bg-accent-muted/40")}
      onPaste={(e) => e.clipboardData.files.length && void addFiles(e.clipboardData.files)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "Paste a chat, an email, meeting notes, or just say what happened. Paste or drop screenshots too. AI files it: who, what, promises, next step, and the details it finds."}
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
        <input ref={fileRef} type="file" accept="image/*,.txt,text/plain" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Add screenshot">
          <ImagePlus className="h-4 w-4" /> Screenshot
        </Button>
        <VoiceButton enabled={voiceEnabled} onText={(t) => setText((cur) => (cur ? `${cur}\n${t}` : t))} showLabel label="Speak" />
        <Button size="sm" variant="primary" className="ml-auto" disabled={pending || (!text.trim() && !images.length)} onClick={submit}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {pending ? "Reading…" : "Log it"}
        </Button>
      </div>

      {ask ? (
        <div className="mt-3 rounded-xl border border-warn/40 bg-warn-muted/40 p-3 text-sm" aria-label="Who is this">
          <p className="font-semibold">{ask.candidates?.length ? "Which one is this?" : "Who is this about?"}</p>
          {ask.summary ? <p className="mt-0.5 text-subtle">{ask.summary}</p> : null}
          {ask.candidates?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {ask.candidates.map((c) => (
                <Button key={c.id} size="sm" variant="outline" disabled={pending} onClick={() => resolve({ person_id: c.id })}>
                  {c.full_name}{c.title ? ` · ${c.title}` : ""}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Or a new person: their name" aria-label="New person's name" className="h-8 max-w-xs text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) resolve({ newPersonName: newName }); }} />
            <Button size="sm" variant="primary" disabled={pending || !newName.trim()} onClick={() => resolve({ newPersonName: newName })}>
              <UserPlus className="h-4 w-4" /> New lead
            </Button>
            <button type="button" className="text-xs text-subtle hover:text-fg" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {last && !pending ? <Filed r={last} onUndo={last.capture_id ? () => undo(last.capture_id!) : undefined} /> : null}
    </div>
  );
}
