"use client";
// Share a radar lead: everything known about it, copied or sent in one go (WhatsApp, email, any app, Telegram, Claude, a file).
import { Bot, Check, Copy, Download, Loader2, Mail, MessageCircle, Send, Share2 } from "lucide-react";
import { useState, useTransition } from "react";
import { dealShareAction, dealToTelegramAction, leadShareAction, leadToTelegramAction } from "@/app/sales-actions";
import { Button, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { LeadShare } from "@/lib/sales/lead-share";

type Format = "full" | "whatsapp" | "claude" | "json";
const TABS: [Format, string, string][] = [
  ["full", "Full details", "Every section: contacts, where it stands, the need, the business, the conversation and what was found."],
  ["whatsapp", "WhatsApp", "The essentials, formatted for WhatsApp and short enough to send."],
  ["claude", "For Claude", "The full lead with instructions to verify it, research further and advise. Nothing invented."],
  ["json", "Data", "The same facts as structured data, for Claude or another tool."],
];
// claude.ai opens a new chat with the text when it fits in a link; longer text is copied for you to paste
const CLAUDE_LINK_MAX = 6000;

/** Share a radar lead (itemId) or a deal (dealId). */
export function ShareLead({ itemId, dealId, title }: { itemId?: number; dealId?: number; title: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<LeadShare | null>(null);
  const [fmt, setFmt] = useState<Format>("full");
  const [copied, setCopied] = useState<Format | null>(null);
  const [busy, start] = useTransition();

  const load = () => {
    setOpen(true);
    start(async () => {
      const r = dealId ? await dealShareAction(dealId) : await leadShareAction(itemId!);
      if (!r.ok) return toast(r.error, "error");
      setShare(r.share);
    });
  };
  const text = share ? share[fmt] : "";
  const copy = async (t: string, f: Format, what = "Copied") => {
    try {
      await navigator.clipboard.writeText(t);
      setCopied(f);
      toast(what);
      setTimeout(() => setCopied(null), 2000);
      return true;
    } catch {
      toast("Your browser blocked copying. Select the text and copy it.", "error");
      return false;
    }
  };
  const download = () => {
    if (!share) return;
    const blob = new Blob([fmt === "json" ? share.json : fmt === "whatsapp" ? share.whatsapp : fmt === "claude" ? share.claude : share.full], { type: fmt === "json" ? "application/json" : "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fmt === "json" ? share.filename.replace(/\.md$/, ".json") : share.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const native = async () => {
    if (!share) return;
    try {
      await navigator.share({ title: `Lead: ${share.title}`, text: fmt === "json" ? share.full : text });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Sharing is not available here. Copy instead.", "error");
    }
  };
  const toClaude = async () => {
    if (!share) return;
    const ok = await copy(share.claude, "claude", share.claude.length > CLAUDE_LINK_MAX ? "Copied for Claude. Paste it into the chat that just opened." : "Copied for Claude too");
    const url = share.claude.length <= CLAUDE_LINK_MAX ? `https://claude.ai/new?q=${encodeURIComponent(share.claude)}` : "https://claude.ai/new";
    if (ok || share.claude.length <= CLAUDE_LINK_MAX) window.open(url, "_blank", "noopener");
  };
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" onClick={load} aria-label="Share this lead"><Share2 className="h-4 w-4" /> Share</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Share this lead" description={title.slice(0, 120)}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Format">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={fmt === k} onClick={() => setFmt(k)}
                className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", fmt === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle hover:bg-muted")}>{l}</button>
            ))}
          </div>
          <p className="text-xs text-subtle">{TABS.find((t) => t[0] === fmt)![2]}</p>
          {!share ? (
            <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-6 text-sm text-subtle"><Loader2 className="h-4 w-4 animate-spin" /> Gathering everything about this lead…</p>
          ) : (
            <>
              <textarea readOnly value={text} aria-label="What will be shared" onFocus={(e) => e.currentTarget.select()}
                className="h-72 w-full resize-y rounded-xl border border-border bg-bg p-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent/60" />
              <p className="text-[11px] text-subtle">{text.length.toLocaleString("en-IN")} characters</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="primary" onClick={() => copy(text, fmt)}>{copied === fmt ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === fmt ? "Copied" : "Copy"}</Button>
                <a className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-muted" href={`https://wa.me/?text=${encodeURIComponent(share.whatsapp)}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> Send on WhatsApp</a>
                <Button variant="outline" onClick={toClaude}><Bot className="h-4 w-4" /> Ask Claude about it</Button>
                <a className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-muted" href={`mailto:?subject=${encodeURIComponent(`Lead: ${share.title.slice(0, 90)}`)}&body=${encodeURIComponent((fmt === "whatsapp" ? share.whatsapp : share.full).slice(0, 1800))}`}><Mail className="h-4 w-4" /> Email it</a>
                <Button variant="outline" disabled={busy} onClick={() => start(async () => {
                  const r = dealId ? await dealToTelegramAction(dealId) : await leadToTelegramAction(itemId!);
                  toast(r.ok ? `Sent to your Telegram${r.parts > 1 ? ` in ${r.parts} parts` : ""}. Forward it from there.` : r.error, r.ok ? "ok" : "error");
                })}><Send className="h-4 w-4" /> Send to my Telegram</Button>
                <Button variant="outline" onClick={download}><Download className="h-4 w-4" /> Download {fmt === "json" ? ".json" : ".md"}</Button>
                {canNative ? <Button variant="outline" className="sm:col-span-2" onClick={native}><Share2 className="h-4 w-4" /> Share to another app</Button> : null}
              </div>
              <p className="text-[11px] text-subtle">Email takes the first part only (email links are short): use Copy or Download for everything. Contacts in here are personal data: share with people you trust.</p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
