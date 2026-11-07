"use client";

import { Check, Copy, Plus, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteStageAction, rotateTokenAction, saveConfigAction, saveStageAction, setAppsScriptUrlAction, setTransitionAction,
} from "@/app/sales-actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { SalesConfig } from "@/lib/sales/config";
import type { Stage, Transition } from "@/lib/sales/stages";

export interface SettingsData {
  cfg: SalesConfig;
  stages: Stage[];
  transitions: Transition[];
  captureToken: string;
  googleSecret: string;
  appsScriptUrl: string | null;
  baseUrl: string;
  env: { key: string; ok: boolean; what: string; free: string }[];
  lastGoogle: string | null;
  script: string;
}

function Card({ id, title, sub, children }: { id?: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-display text-base">{title}</h2>
      {sub ? <p className="mb-3 text-xs text-subtle">{sub}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function SettingsView({ d }: { d: SettingsData }) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const c = d.cfg;
  const [owner, setOwner] = useState({ ...c.owner, aliases: c.owner.aliases.join(", "), emails: c.owner.emails.join(", "), phones: c.owner.phones.join(", ") });
  const [voice, setVoice] = useState(c.voice_rules);
  const [countries, setCountries] = useState(c.countries.join("\n"));
  const [industries, setIndustries] = useState(c.industries.join("\n"));
  const [radar, setRadar] = useState(c.radar);
  const [rhythm, setRhythm] = useState({
    followup_days: c.followup_days.join(", "), ghost_after_days: c.ghost_after_days, reengage_days: c.reengage_days, reply_within_hours: c.reply_within_hours,
    ghost_revisit_days: c.ghost_revisit_days, brief_hour: c.brief_hour, review_dow: c.review_dow, review_hour: c.review_hour, unknown_email: c.unknown_email,
  });
  const [esc, setEsc] = useState(c.escalation);
  const [targets, setTargets] = useState(c.targets);
  const [postSale, setPostSale] = useState({ ...c.post_sale, checkin_days: c.post_sale.checkin_days.join(", ") });
  const [fx, setFx] = useState(Object.entries(c.fx).map(([k, v]) => `${k}=${v}`).join("\n"));
  const [prewrite, setPrewrite] = useState(c.autonomy.prewrite !== "suggest");
  const [scriptUrl, setScriptUrl] = useState(d.appsScriptUrl ?? "");
  const save = (patch: Partial<SalesConfig>) => start(async () => {
    const r = await saveConfigAction(patch);
    if (!r.ok) return toast(r.error, "error");
    toast("Saved");
    router.refresh();
  });
  const copy = (s: string, what = "Copied") => void navigator.clipboard.writeText(s).then(() => toast(what));
  const bookmarklet = `javascript:(()=>{const s=String(getSelection()||'').trim();const t=(s||document.body.innerText).slice(0,15000);window.open('${d.baseUrl}/sales/clip#'+encodeURIComponent(JSON.stringify({text:t,url:location.href,title:document.title})),'_blank')})()`;
  const script = d.script.replace("https://YOUR-APP.vercel.app", d.baseUrl).replace("PASTE-THE-SECRET-FROM-DAYBOOK", d.googleSecret);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl leading-tight">Sales settings</h1>
        <p className="text-sm text-subtle">Everything here can be changed any time. Nothing needs a redeploy.</p>
      </div>

      <Card title="Keys and services" sub="Add these in Vercel, Project Settings, Environment Variables, then redeploy. Everything listed is free or has a free tier.">
        <ul className="divide-y divide-border text-sm">
          {d.env.map((e) => (
            <li key={e.key} className="flex items-start gap-2 py-1.5">
              {e.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />}
              <div className="min-w-0"><code className="text-xs">{e.key}</code><p className="text-xs text-subtle">{e.what} · <span className="text-fg">{e.free}</span></p></div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Connect Google (Gmail, Calendar, Meet transcripts)" sub="Free, no Google Cloud project. A small script runs in your own Google account and syncs every 5 minutes.">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Open <a className="text-accent underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> (signed in as your Workspace account), New project.</li>
          <li>Delete the sample code, then paste this script (your URL and secret are already filled in): <Button size="sm" variant="outline" className="ml-1" onClick={() => copy(script, "Script copied")}><Copy className="h-3.5 w-3.5" /> Copy script</Button></li>
          <li>Pick the function <b>setup</b> in the toolbar and press Run. Allow the permissions it asks for.</li>
          <li>Deploy, New deployment, type Web app, Execute as Me, Who has access Anyone. Copy the URL ending in /exec and paste it here, so Daybook can send email from your Gmail:</li>
        </ol>
        <div className="mt-2 flex gap-2">
          <Input value={scriptUrl} onChange={(e) => setScriptUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="h-9 text-sm" />
          <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
            const r = await setAppsScriptUrlAction(scriptUrl);
            toast(r.ok ? "Saved" : r.error, r.ok ? "ok" : "error");
            router.refresh();
          })}>Save</Button>
        </div>
        <p className="mt-2 text-xs text-subtle">Last sync received: {d.lastGoogle ? new Date(d.lastGoogle).toLocaleString("en-IN") : "never"} · secret <code>{d.googleSecret.slice(0, 6)}…</code> <button type="button" className="text-accent" onClick={() => confirm("Rotate the secret? You must paste the new script again.") && start(async () => { await rotateTokenAction("google"); router.refresh(); })}>rotate</button></p>
      </Card>

      <Card title="Capture from anywhere" sub="For the channels with no API (LinkedIn, Instagram, personal WhatsApp), these are the 2-second ways in.">
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-semibold">Telegram (works everywhere, best on iPhone)</p>
            <p className="text-subtle">Forward any message, send a screenshot of a LinkedIn or Instagram chat, or share a WhatsApp chat export (Chat, Export chat, Without media, Telegram, Daybook bot). After a call or meeting, send a voice note. Start a text with &quot;lead:&quot; to force it into Sales.</p>
          </div>
          <div>
            <p className="font-semibold">Bookmarklet (desktop: LinkedIn messages, profiles, any post)</p>
            <p className="text-subtle">Drag this to your bookmarks bar. On a LinkedIn chat or profile, select the text you want (or nothing for the whole page) and click it.</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <a href={bookmarklet} className="rounded-xl border border-accent px-3 py-1.5 text-xs font-semibold text-accent" onClick={(e) => { e.preventDefault(); toast("Drag it to the bookmarks bar instead of clicking"); }}>+ Daybook</a>
              <Button size="sm" variant="ghost" onClick={() => copy(bookmarklet, "Bookmarklet copied")}><Copy className="h-3.5 w-3.5" /> Copy code</Button>
            </div>
          </div>
          <div>
            <p className="font-semibold">iPhone Shortcut (share sheet)</p>
            <ol className="list-decimal pl-5 text-subtle">
              <li>Shortcuts app, new shortcut, turn on &quot;Show in Share Sheet&quot; (accepts Text, URLs, Images).</li>
              <li>Add &quot;Get Contents of URL&quot;: URL <code className="text-fg">{d.baseUrl}/api/sales/capture</code>, Method POST, Request Body JSON with keys <code>token</code> = <code className="text-fg">{d.captureToken}</code>, <code>text</code> = Shortcut Input, <code>source</code> = shortcut.</li>
              <li>Name it &quot;Log to Daybook&quot;. Share any text, link or note into it; the result card arrives in Telegram.</li>
            </ol>
            <p className="mt-1 text-xs text-subtle">Tip: iOS call recording saves a transcript in Notes; share that note to the shortcut after a client call.</p>
            <p className="mt-1 text-xs text-subtle">Token <button type="button" className="text-accent" onClick={() => copy(d.captureToken, "Token copied")}>copy</button> · <button type="button" className="text-accent" onClick={() => confirm("Rotate the capture token? The old shortcut and bookmarklet stop working.") && start(async () => { await rotateTokenAction("capture"); router.refresh(); })}>rotate</button></p>
          </div>
        </div>
      </Card>

      <StageEditor stages={d.stages} transitions={d.transitions} />

      <Card title="You and your voice" sub="Drafts copy the voice of the messages you actually send. These rules sit on top.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} /></Field>
          <Field label="How you appear in chats" hint="Comma separated: names in WhatsApp exports and transcripts"><Input value={owner.aliases} onChange={(e) => setOwner({ ...owner, aliases: e.target.value })} /></Field>
          <Field label="Your emails"><Input value={owner.emails} onChange={(e) => setOwner({ ...owner, emails: e.target.value })} /></Field>
          <Field label="Your phones"><Input value={owner.phones} onChange={(e) => setOwner({ ...owner, phones: e.target.value })} /></Field>
          <Field label="Company"><Input value={owner.company} onChange={(e) => setOwner({ ...owner, company: e.target.value })} /></Field>
          <Field label="Website"><Input value={owner.website} onChange={(e) => setOwner({ ...owner, website: e.target.value })} /></Field>
          <Field label="Title"><Input value={owner.title} onChange={(e) => setOwner({ ...owner, title: e.target.value })} /></Field>
          <Field label="Email signature"><Textarea value={owner.signature} onChange={(e) => setOwner({ ...owner, signature: e.target.value })} className="min-h-[60px]" /></Field>
          <div className="sm:col-span-2"><Field label="Your booking link" hint="Calendly, Cal.com or similar. Drafts offer it whenever the next step is a call, so nobody has to go back and forth on times."><Input value={owner.booking_url ?? ""} onChange={(e) => setOwner({ ...owner, booking_url: e.target.value.trim() })} placeholder="https://cal.com/you/30min" /></Field></div>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium">What you sell</p>
            <p className="rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-subtle">
              Your offers, with packages and prices, live in <a href="/sales/playbook#offers" className="font-medium text-accent hover:underline">Playbook &gt; Offers</a>. Drafts, the radar and research all read them from there.
            </p>
          </div>
          <div className="sm:col-span-2"><Field label="Extra voice rules" hint={'e.g. "Use Haan ji with Indian clients", "never say kindly"'}><Textarea value={voice} onChange={(e) => setVoice(e.target.value)} className="min-h-[60px]" /></Field></div>
        </div>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ owner: { ...owner, aliases: csv(owner.aliases), emails: csv(owner.emails), phones: csv(owner.phones) }, voice_rules: voice })}>Save</Button></div>
      </Card>

      <Card id="targeting" title="Radar targeting" sub="One country per week, one industry per day. Adaptive gives more turns to the ones that bring results (see Radar > Plan for why); the digest always brings at least the daily minimum, and hunts until it does.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How to choose">
            <Select value={radar.targeting} onChange={(e) => setRadar({ ...radar, targeting: e.target.value as SalesConfig["radar"]["targeting"] })}>
              <option value="adaptive">Adaptive: more turns for what brings results</option>
              <option value="rotate">Even rotation, in list order</option>
            </Select>
          </Field>
          <Field label="Exploring share (%)" hint="Turns kept for the least-tested country or industry, so nothing is written off too early. 20 is a good default."><Input value={String(radar.explore_pct)} onChange={(e) => setRadar({ ...radar, explore_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} inputMode="numeric" /></Field>
          <Field label="Countries (one a week)"><Textarea value={countries} onChange={(e) => setCountries(e.target.value)} className="min-h-[140px]" /></Field>
          <Field label="Industries (one a day)"><Textarea value={industries} onChange={(e) => setIndustries(e.target.value)} className="min-h-[140px]" /></Field>
          <Field label="Qualified at score"><Input value={String(radar.min_score)} onChange={(e) => setRadar({ ...radar, min_score: Number(e.target.value) || 0 })} inputMode="numeric" /></Field>
          <Field label="At least this many a day"><Input value={String(radar.daily_min)} onChange={(e) => setRadar({ ...radar, daily_min: Math.max(1, Number(e.target.value) || 1) })} inputMode="numeric" /></Field>
          <Field label="Instant alert at score"><Input value={String(radar.alert_score)} onChange={(e) => setRadar({ ...radar, alert_score: Number(e.target.value) || 0 })} inputMode="numeric" /></Field>
          <Field label="Digest hour (0-23)"><Input value={String(radar.digest_hour)} onChange={(e) => setRadar({ ...radar, digest_hour: Number(e.target.value) || 0 })} inputMode="numeric" /></Field>
          <Field label="Max paid-tier searches a day" hint="Protects the free quotas. Tavily 1,000 a month is about 30 a day."><Input value={String(radar.search_daily_cap)} onChange={(e) => setRadar({ ...radar, search_daily_cap: Number(e.target.value) || 0 })} inputMode="numeric" /></Field>
          <Field label="Research leads automatically from score" hint="Qualified radar leads at or above this score get their company, contact details and people researched on their own. 101 turns it off."><Input value={String(radar.auto_research_score)} onChange={(e) => setRadar({ ...radar, auto_research_score: Number(e.target.value) || 0 })} inputMode="numeric" /></Field>
          <Field label="Searches per company research"><Input value={String(radar.enrich_queries)} onChange={(e) => setRadar({ ...radar, enrich_queries: Number(e.target.value) || 0 })} inputMode="numeric" /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ countries: lines(countries), industries: lines(industries), radar })}>Save</Button></div>
      </Card>

      <Card id="targets" title="Targets" sub="What you are aiming for. Insights works out your pace, the forecast and the outreach it takes from your own conversion rates.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Monthly revenue target (USD)" hint="Won deal value per month. 0 turns the target off."><Input value={String(targets.monthly_revenue_usd)} onChange={(e) => setTargets({ ...targets, monthly_revenue_usd: Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) })} inputMode="numeric" /></Field>
          <Field label="New conversations a week" hint="Used by the weekly review."><Input value={String(targets.weekly_conversations)} onChange={(e) => setTargets({ ...targets, weekly_conversations: Math.max(0, Number(e.target.value) || 0) })} inputMode="numeric" /></Field>
          <Field label="Outreach messages a day" hint="Shown on Today: first messages and follow-ups you send."><Input value={String(targets.daily_outreach)} onChange={(e) => setTargets({ ...targets, daily_outreach: Math.max(0, Number(e.target.value) || 0) })} inputMode="numeric" /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ targets })}>Save</Button></div>
      </Card>

      <Card id="after-sale" title="After the sale" sub="Revenue from people who already paid you is the cheapest you will ever earn. These become moves once the work is delivered.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Check in after delivery (days)" hint="Comma separated, e.g. 30, 90"><Input value={postSale.checkin_days} onChange={(e) => setPostSale({ ...postSale, checkin_days: e.target.value })} /></Field>
          <Field label="Suggest more work after (days)" hint="An offer they have not bought yet, from your catalogue. 0 turns it off."><Input value={String(postSale.upsell_after_days)} onChange={(e) => setPostSale({ ...postSale, upsell_after_days: Math.max(0, Number(e.target.value) || 0) })} inputMode="numeric" /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={postSale.retainer} onChange={(e) => setPostSale({ ...postSale, retainer: e.target.checked })} /> Offer a monthly retainer at delivery</label>
        </div>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ post_sale: { ...postSale, checkin_days: csv(postSale.checkin_days).map(Number).filter((n) => n > 0) } })}>Save</Button></div>
      </Card>

      <Card title="Rhythm" sub="When things become moves, and when Daybook pings you.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Follow-ups after first touch (days)" hint="The last one is the breakup message"><Input value={rhythm.followup_days} onChange={(e) => setRhythm({ ...rhythm, followup_days: e.target.value })} /></Field>
          <Field label="Mark Ghosted after (days)"><Input value={String(rhythm.ghost_after_days)} onChange={(e) => setRhythm({ ...rhythm, ghost_after_days: Number(e.target.value) || 21 })} /></Field>
          <Field label="Revisit ghosted after (days)"><Input value={String(rhythm.ghost_revisit_days)} onChange={(e) => setRhythm({ ...rhythm, ghost_revisit_days: Number(e.target.value) || 60 })} /></Field>
          <Field label="Re-engage quiet deals after (days)"><Input value={String(rhythm.reengage_days)} onChange={(e) => setRhythm({ ...rhythm, reengage_days: Number(e.target.value) || 7 })} /></Field>
          <Field label="Reply to inbound within (hours)"><Input value={String(rhythm.reply_within_hours)} onChange={(e) => setRhythm({ ...rhythm, reply_within_hours: Number(e.target.value) || 3 })} /></Field>
          <Field label="Morning brief hour"><Input value={String(rhythm.brief_hour)} onChange={(e) => setRhythm({ ...rhythm, brief_hour: Number(e.target.value) || 9 })} /></Field>
          <Field label="Weekly review day">
            <Select value={String(rhythm.review_dow)} onChange={(e) => setRhythm({ ...rhythm, review_dow: Number(e.target.value) })}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dname, i) => <option key={dname} value={i + 1}>{dname}</option>)}</Select>
          </Field>
          <Field label="Weekly review hour"><Input value={String(rhythm.review_hour)} onChange={(e) => setRhythm({ ...rhythm, review_hour: Number(e.target.value) || 18 })} /></Field>
          <Field label="Emails from unknown people">
            <Select value={rhythm.unknown_email} onChange={(e) => setRhythm({ ...rhythm, unknown_email: e.target.value as SalesConfig["unknown_email"] })}>
              <option value="ask">AI decides, you confirm in Telegram</option>
              <option value="auto">AI decides, no ping</option>
              <option value="off">Ignore</option>
            </Select>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={prewrite} onChange={(e) => setPrewrite(e.target.checked)} /> Pre-write drafts for the top moves before the morning brief</label>
        <p className="mt-1 text-xs text-subtle">Autonomy: Daybook writes, you send with one tap. Client messages are never sent without your tap; one wrong auto-message costs more than it saves. Emails go out from your own Gmail once Google is connected.</p>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ ...rhythm, followup_days: csv(rhythm.followup_days).map(Number).filter((n) => n > 0), autonomy: { ...c.autonomy, prewrite: prewrite ? "draft" : "suggest" } })}>Save</Button></div>
      </Card>

      <Card title="Emergency phone calls" sub="OmniDimension (free tier) calls your phone only for these, at most a few times a day, never in quiet hours.">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={esc.enabled} onChange={(e) => setEsc({ ...esc, enabled: e.target.checked })} /> Allow calls</label>
        <div className="mt-2 grid gap-1.5 text-sm">
          {[["quote_accepted", "A client accepts a quote"], ["proposal_hot", "A proposal is opened 3+ times in 2 hours"], ["hot_inbound", "A hot inbound lead arrives"]].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={esc.on.includes(k)} onChange={(e) => setEsc({ ...esc, on: e.target.checked ? [...esc.on, k] : esc.on.filter((x) => x !== k) })} /> {l}</label>
          ))}
        </div>
        <div className="mt-2 max-w-[200px]"><Field label="Max calls per day"><Input value={String(esc.max_per_day)} onChange={(e) => setEsc({ ...esc, max_per_day: Number(e.target.value) || 0 })} /></Field></div>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ escalation: esc })}>Save</Button></div>
      </Card>

      <Card title="Currency rates" sub="Value of 1 unit in USD, used for pipeline totals. Update when they drift.">
        <Textarea value={fx} onChange={(e) => setFx(e.target.value)} className="min-h-[140px] font-mono text-xs" />
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => save({ fx: Object.fromEntries(lines(fx).map((l) => l.split("=")).filter((p) => p.length === 2 && Number(p[1]) > 0).map(([k, v]) => [k.trim().toUpperCase(), Number(v)])) })}>Save</Button></div>
      </Card>
    </div>
  );
}

const REQ_LABEL: Record<string, string> = { none: "free", reason: "reason", date: "date", quote: "quote" };

function StageEditor({ stages, transitions }: { stages: Stage[]; transitions: Transition[] }) {
  const [rows, setRows] = useState(stages);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const edge = (f: number, t: number) => transitions.find((x) => x.from_stage === f && x.to_stage === t)?.requires ?? null;
  const saveRow = (s: Stage) => start(async () => {
    const r = await saveStageAction(s);
    if (!r.ok) return toast(r.error, "error");
    toast("Saved");
    router.refresh();
  });
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-display text-base">Pipeline flow (the state machine)</h2>
      <p className="mb-3 text-xs text-subtle">Stages and which moves are allowed. Automation targets the built-in stages by role, so renaming is always safe. A move can require a reason (Lost), a revisit date (Nurture, On hold) or a sent quote (Proposal).</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="text-left text-subtle"><tr><th className="p-1.5">On</th><th className="p-1.5">Stage</th><th className="p-1.5">Kind</th><th className="p-1.5">Win %</th><th className="p-1.5">Limit (days)</th><th className="p-1.5">Order</th><th className="p-1.5">Colour</th><th className="p-1.5" /></tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-1.5"><input type="checkbox" checked={s.active} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, active: e.target.checked } : r)))} aria-label="Active" /></td>
                <td className="p-1.5"><Input value={s.name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className="h-8 text-xs" />{s.role ? <span className="text-[10px] text-subtle">built-in: {s.role}</span> : <span className="text-[10px] text-subtle">custom</span>}</td>
                <td className="p-1.5"><Select value={s.category} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, category: e.target.value as Stage["category"] } : r)))} className="h-8 w-24 text-xs">{["open", "won", "parked", "lost"].map((k) => <option key={k}>{k}</option>)}</Select></td>
                <td className="p-1.5"><Input value={String(s.probability)} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, probability: Number(e.target.value) || 0 } : r)))} className="h-8 w-16 text-xs" /></td>
                <td className="p-1.5"><Input value={s.sla_days ? String(s.sla_days) : ""} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, sla_days: Number(e.target.value) || null } : r)))} className="h-8 w-16 text-xs" /></td>
                <td className="p-1.5"><Input value={String(s.sort)} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, sort: Number(e.target.value) || 0 } : r)))} className="h-8 w-16 text-xs" /></td>
                <td className="p-1.5"><input type="color" value={s.color} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)))} aria-label="Colour" className="h-8 w-10 rounded border border-border bg-transparent" /></td>
                <td className="p-1.5 whitespace-nowrap">
                  <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => saveRow(rows[i])}>Save</Button>
                  {!s.role ? <Button size="sm" variant="ghost" className="h-7" onClick={() => confirm(`Delete ${s.name}?`) && start(async () => { const r = await deleteStageAction(s.id); if (!r.ok) toast(r.error, "error"); router.refresh(); })}><X className="h-3.5 w-3.5" /></Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => start(async () => {
        await saveStageAction({ name: "New stage", category: "open", probability: 30, sort: 65 });
        router.refresh();
      })}><Plus className="h-3.5 w-3.5" /> Add a stage</Button>

      <h3 className="mt-5 text-sm font-semibold">Allowed moves</h3>
      <p className="mb-2 text-xs text-subtle">Row = from, column = to. Each cell: blank (not allowed), free, or what it needs.</p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead><tr><th className="sticky left-0 bg-surface p-1 text-left">from \ to</th>{stages.map((s) => <th key={s.id} className="p-1 align-bottom"><div className="w-16 truncate text-left" title={s.name}>{s.name}</div></th>)}</tr></thead>
          <tbody>
            {stages.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="sticky left-0 bg-surface p-1 pr-2 font-medium">{f.name}</td>
                {stages.map((t) => {
                  const v = edge(f.id, t.id);
                  return (
                    <td key={t.id} className="p-0.5">
                      {f.id === t.id ? <span className="block w-16 text-center text-subtle">·</span> : (
                        <select
                          value={v ?? ""}
                          onChange={(e) => start(async () => {
                            const val = e.target.value;
                            const r = await setTransitionAction(f.id, t.id, val ? (val as Transition["requires"]) : null);
                            if (!r.ok) toast(r.error, "error");
                            router.refresh();
                          })}
                          className={cn("h-6 w-16 rounded border border-border bg-bg text-[10px]", v && "border-accent/50 text-accent")}
                          aria-label={`${f.name} to ${t.name}`}
                        >
                          <option value="" />
                          {Object.entries(REQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {busy ? <p className="mt-1 flex items-center gap-1 text-xs text-subtle"><RefreshCw className="h-3 w-3 animate-spin" /> saving</p> : null}
    </section>
  );
}
