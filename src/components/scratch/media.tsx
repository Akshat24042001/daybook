"use client";

import { Download, ExternalLink, FileText, Loader2, Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { finishUploadAction, startUploadAction } from "@/app/scratch-actions";
import { cn } from "@/lib/cn";
import { fileView, type FileData } from "@/lib/scratch";
import { Markdown } from "../assistant/markdown";

export const fmtBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

/** Reads an image's size before upload (for layout without jumps). */
async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bmp = await createImageBitmap(file);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return {};
  }
}

/** PUTs the file straight to storage with progress (fetch cannot report upload progress). */
function putFile(url: string, file: Blob, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed: check your connection."));
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

export interface UploadDone {
  id: number;
  data: FileData;
  url: string | null;
}

/**
 * Uploads one file (or recorded memo) into the scratchpad: reserve an item, put the bytes into storage, confirm.
 * `onStart` gets the new item id as soon as it exists, so the page can show it with a progress bar.
 */
export async function uploadToScratch(
  date: string,
  kind: "file" | "voice",
  file: File,
  opts: { onStart?: (id: number, data: FileData) => void; onProgress?: (id: number, f: number) => void; extra?: { duration?: number; transcript?: string } } = {},
): Promise<UploadDone> {
  const size = await imageSize(file);
  const r = await startUploadAction(date, kind, { name: file.name, mime: file.type, size: file.size });
  if (!r.ok) throw new Error(r.error);
  opts.onStart?.(r.id, r.data);
  await putFile(r.uploadUrl, file, (f) => opts.onProgress?.(r.id, f));
  const done = await finishUploadAction(r.id, { ...size, ...opts.extra });
  if (!done.ok) throw new Error(done.error);
  return { id: r.id, data: done.data, url: done.url };
}

// ---------------------------------------------------------------- previews

function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < 200; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function TextPreview({ url, view, name }: { url: string; view: "text" | "csv" | "markdown"; name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        setText((await blob.slice(0, 1_000_000).text()) + (blob.size > 1_000_000 ? "\n…" : ""));
      })
      .catch((e) => (e as Error).name !== "AbortError" && setError("Could not load a preview."));
    return () => ctrl.abort();
  }, [url]);
  if (error) return <p className="text-sm text-subtle">{error}</p>;
  if (text === null) return <p className="flex items-center gap-2 text-sm text-subtle"><Loader2 className="h-4 w-4 animate-spin" /> Loading preview…</p>;
  if (view === "markdown") return <div className="max-h-[32rem] overflow-auto rounded-xl border border-border p-3"><Markdown text={text} /></div>;
  if (view === "csv") {
    const rows = parseCsv(text, /\.tsv$/i.test(name) ? "\t" : ",");
    return (
      <div className="max-h-[32rem] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn("border-t border-border/60", i === 0 && "bg-muted/60 font-medium")}>
                {r.map((c, j) => <td key={j} className="whitespace-nowrap px-2.5 py-1">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <pre className="max-h-[32rem] overflow-auto rounded-xl bg-muted p-3 font-mono text-xs leading-relaxed">{text}</pre>;
}

/** The right preview for a stored file, plus open and download. */
export function FilePreview({ data, url, kind }: { data: FileData; url: string | null; kind: "file" | "voice" }) {
  const [zoom, setZoom] = useState(false);
  const view = kind === "voice" ? "audio" : fileView(data.name, data.mime);
  const meta = [data.mime && !data.mime.includes("octet") ? data.mime.split("/")[1]?.toUpperCase() : null, data.size ? fmtBytes(data.size) : null,
    data.width && data.height ? `${data.width}×${data.height}` : null, data.duration ? `${Math.floor(data.duration / 60)}:${String(Math.round(data.duration % 60)).padStart(2, "0")}` : null]
    .filter(Boolean).join(" · ");

  if (!url) {
    return (
      <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-subtle">
        {data.status === "uploading" ? "Uploading…" : "This file cannot be shown right now (storage is not reachable)."}
      </p>
    );
  }
  const actions = (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-auto truncate text-subtle">{data.name}{meta ? ` · ${meta}` : ""}</span>
      {view === "office" ? (
        <a
          href={`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 hover:bg-muted"
          title="Opens Microsoft's free viewer with a link that expires in an hour"
        >
          <ExternalLink className="h-3.5 w-3.5" /> View in Office viewer
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer noopener" className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 hover:bg-muted">
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </a>
      )}
      <a href={url} download={data.name} className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 hover:bg-muted">
        <Download className="h-3.5 w-3.5" /> Download
      </a>
    </div>
  );

  return (
    <div className="space-y-2">
      {view === "image" ? (
        <>
          <button type="button" onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-xl border border-border bg-muted" title="Full screen">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={data.name}
              className="mx-auto max-h-[28rem] w-auto object-contain"
              style={data.width && data.height ? { aspectRatio: `${data.width} / ${data.height}` } : undefined}
              loading="lazy"
            />
          </button>
          {zoom ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setZoom(false)} role="dialog" aria-label={data.name}>
              <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Close"><X className="h-5 w-5" /></button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={data.name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : null}
        </>
      ) : view === "video" ? (
        <video src={url} controls preload="metadata" className="max-h-[28rem] w-full rounded-xl border border-border bg-black" />
      ) : view === "audio" ? (
        <audio src={url} controls preload="metadata" className="w-full" />
      ) : view === "pdf" ? (
        <iframe src={url} title={data.name} className="h-[70vh] w-full rounded-xl border border-border bg-white" />
      ) : view === "text" || view === "csv" || view === "markdown" ? (
        <TextPreview url={url} view={view} name={data.name} />
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <FileText className="h-8 w-8 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{data.name}</p>
            <p className="text-xs text-subtle">{view === "office" ? "Open it in the Office viewer, or download it." : "No preview for this type. Download to open it."}</p>
          </div>
        </div>
      )}
      {actions}
    </div>
  );
}

// ---------------------------------------------------------------- voice memo recorder

/** Records a voice memo in the browser; hands back the audio file and its length when stopped. */
export function VoiceRecorder({ onDone, onCancel }: { onDone: (file: File, seconds: number) => void; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
        const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = () => {
          stream?.getTracks().forEach((t) => t.stop());
          if (cancelled.current) return;
          const mime = r.mimeType || "audio/webm";
          const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
          const stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
          onDone(new File(chunks.current, `voice-memo-${stamp}.${ext}`, { type: mime.split(";")[0] }), (Date.now() - started.current) / 1000);
        };
        r.start(1000);
        rec.current = r;
        started.current = Date.now();
        timer = setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 250);
      } catch {
        setError("The microphone is blocked. Allow it in the browser to record.");
      }
    })();
    return () => {
      if (timer) clearInterval(timer);
      if (rec.current?.state === "recording") {
        cancelled.current = true;
        rec.current.stop();
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-bad/30 bg-bad/5 p-3">
      {error ? (
        <>
          <p className="flex-1 text-sm text-bad">{error}</p>
          <button onClick={onCancel} className="text-sm text-subtle hover:text-fg">Close</button>
        </>
      ) : (
        <>
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-bad text-white">
            <Mic className="h-4 w-4" />
            <span className="absolute inset-0 animate-ping rounded-full bg-bad/40" />
          </span>
          <span className="tabular flex-1 text-sm font-medium">
            Recording {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <button
            onClick={() => { cancelled.current = true; rec.current?.stop(); onCancel(); }}
            className="rounded-lg px-2.5 py-1.5 text-sm text-subtle hover:bg-muted hover:text-fg"
          >
            Discard
          </button>
          <button
            onClick={() => rec.current?.state === "recording" && rec.current.stop()}
            className="flex items-center gap-1.5 rounded-lg bg-bad px-3 py-1.5 text-sm font-semibold text-white"
          >
            <Square className="h-3.5 w-3.5" /> Stop & save
          </button>
        </>
      )}
    </div>
  );
}
