"use server";

import { revalidatePath } from "next/cache";
import { one, q, UserError } from "@/lib/db";
import { journaled } from "@/lib/undo";
import { completeMove, markOpened, sendMoveEmail, targetsFor } from "@/lib/sales/act";
import { salesConfig, updateSalesConfig, type SalesConfig } from "@/lib/sales/config";
import {
  addCommitment, addPayment, createDeal, deletePayment, editInteraction, logActivity, markPaid, recomputeTouches, setCommitment, updateDeal, deleteDeal,
  type NewActivity,
} from "@/lib/sales/deals";
import { closeDeal, type ClosePayload } from "@/lib/sales/closing";
import { updateCompany, updatePerson } from "@/lib/sales/records";
import { addPackageItems, applyItemTotals, deleteItem, saveItem } from "@/lib/sales/items";
import { savePipeline, saveMember } from "@/lib/sales/org";
import { bulkDeals, importDeals, type BulkOp } from "@/lib/sales/bulk";
import { saveCustomField, setCustomFieldActive, type CustomType, type Scope } from "@/lib/sales/custom-fields";
import { createLinkDoc, createQuote, deleteDoc, markDocSent, newRevision, saveRevision, type RevisionRow } from "@/lib/sales/docs";
import { auditCompany } from "@/lib/sales/enrich";
import { researchRadarItem, researchView, startResearch, type ResearchView } from "@/lib/sales/research";
import { ensureCompany, mergePeople, upsertPerson } from "@/lib/sales/identity";
import { capture, processCapture, undoCapture, type CaptureResult } from "@/lib/sales/ingest";
import { enqueue } from "@/lib/sales/jobs";
import { addCustomMove, draftForMove, getMove, refreshMoves, setMoveStatus, snoozeMove, type MoveRow } from "@/lib/sales/moves";
import { deleteHunt, recentRuns, runHuntNow, saveHunt, setHuntEnabled, type HuntInput, type HuntRun } from "@/lib/sales/hunts";
import { radarToDeal, runRadar, qualifyPending, sendBackToRadar, setRadarHidden, setRadarStatus, dailyDigest, type SendBack } from "@/lib/sales/radar";
import { deleteStage, moveDeal, saveStage, setTransition, type Category, type Requirement } from "@/lib/sales/stages";
import { fileStore, newPath } from "@/lib/storage";
import { addBlock, removeBlock, type BlockKind } from "@/lib/sales/blocklist";
import { deleteOffer, saveOffer } from "@/lib/sales/offers";
import { renameObjection, saveAnswer, suggestAnswer, syncObjections } from "@/lib/sales/objections";
import { deleteProof, draftProof, saveProof } from "@/lib/sales/proofs";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object = object>(fn: () => Promise<T | void>, paths: string[] = ["/sales"]): Promise<Result<T>> {
  try {
    const out = (await journaled("web", async () => (await fn()) ?? ({} as T))).value;
    for (const p of paths) revalidatePath(p, p.includes("[") ? "page" : undefined);
    return { ok: true, ...(out as T) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[sales] action failed:", (e as Error).name, (e as Error).message);
    return { ok: false, error: (e as Error).message.slice(0, 200) || "Something went wrong. Try again." };
  }
}

const ALL = ["/sales", "/sales/pipeline", "/sales/deal/[id]"];

// ------------------------------------------------------------------ moves
export async function draftMoveAction(id: number, channel?: string) {
  return run<{ move: MoveRow | null }>(async () => ({ move: await draftForMove(id, channel) }), []);
}
/** You confirmed you sent it via this button: log it on that channel and close the move. */
export async function moveSentAction(id: number, targetId: string, text?: string) {
  return run(async () => {
    const m = await getMove(id);
    if (!m) throw new UserError("That move is gone.");
    const t = targetsFor(m, false).find((x) => x.id === targetId) ?? targetsFor(m, true).find((x) => x.id === targetId);
    await completeMove(id, t?.log ?? null, { text, where: t?.where ?? null });
  }, ALL);
}
/** Remembers which button you opened (and keeps your edited draft). Logs nothing. */
export async function moveOpenedAction(id: number, targetId: string, text?: string, subject?: string | null) {
  return run(async () => {
    if (text !== undefined) await q("update sales_moves set draft = $2, draft_subject = coalesce($3, draft_subject) where id = $1", [id, text, subject ?? null]);
    await markOpened(id, targetId);
  }, []);
}
export async function moveStatusAction(id: number, status: "done" | "skipped" | "open") {
  return run(async () => {
    // "done" without a channel closes the move and logs nothing: you did it some other way
    if (status === "done") await completeMove(id, null);
    else await setMoveStatus(id, status);
  }, ALL);
}
export async function snoozeMoveAction(id: number, hours: number) {
  return run(() => snoozeMove(id, hours), ALL);
}
export async function sendMoveEmailAction(id: number, text: string, subject: string) {
  return run(() => sendMoveEmail(id, { text, subject }), ALL);
}
export async function saveDraftAction(id: number, text: string, subject?: string | null) {
  return run(async () => {
    await q("update sales_moves set draft = $2, draft_subject = coalesce($3, draft_subject) where id = $1", [id, text, subject ?? null]);
  }, []);
}
export async function addMoveAction(dealId: number | null, title: string, dueAt?: string | null) {
  return run(async () => {
    if (!title.trim()) throw new UserError("Write what needs doing.");
    await addCustomMove({ deal_id: dealId, title: title.trim(), due_at: dueAt || null });
  }, ALL);
}
export async function refreshMovesAction() {
  return run(async () => {
    await refreshMoves();
  }, ALL);
}

// ------------------------------------------------------------------ deals
export async function createDealAction(d: {
  title?: string; person_name?: string; company_name?: string; email?: string; phone?: string; linkedin?: string; source?: string;
  value_amount?: number | null; currency?: string; notes?: string; referrer_name?: string; stage_role?: string;
  city?: string; region?: string; industry?: string; deal_type?: string; expected_close?: string; services?: string;
  pipeline_id?: number | null;
}) {
  return run<{ id: number }>(async () => {
    const companyId = d.company_name?.trim() ? await ensureCompany(d.company_name.trim()) : null;
    const personId = d.person_name?.trim() || d.email || d.phone || d.linkedin
      ? await upsertPerson({ name: d.person_name, email: d.email, phone: d.phone, linkedin: d.linkedin, company_id: companyId, relationship: d.referrer_name ? "referral" : d.source === "network" ? "warm" : "cold" })
      : null;
    const referrer = d.referrer_name?.trim() ? await upsertPerson({ name: d.referrer_name.trim(), relationship: "referral" }) : null;
    if (!companyId && !personId && !d.title?.trim()) throw new UserError("Give at least a name, a company or a title.");
    const id = await createDeal({
      title: d.title, company_id: companyId, person_id: personId, source: d.source ?? (referrer ? "referral" : "outbound"),
      value_amount: d.value_amount ?? null, currency: d.currency, referrer_id: referrer, requirements: d.notes ?? null, stage_role: d.stage_role,
      pipeline_id: d.pipeline_id ?? null,
    });
    const more = Object.fromEntries((["city", "region", "industry", "deal_type", "expected_close", "services"] as const).filter((k) => d[k]?.trim()).map((k) => [k, d[k]!.trim()]));
    if (Object.keys(more).length) await updateDeal(id, more);
    if (companyId && (d.city?.trim() || d.region?.trim() || d.industry?.trim())) {
      await q("update sales_companies set city = coalesce(city, $2), region = coalesce(region, $3), industry = coalesce(industry, $4) where id = $1", [companyId, d.city?.trim() || null, d.region?.trim() || null, d.industry?.trim() || null]);
    }
    if (personId) await enqueue("enrich_person", { id: personId }, { dedupeKey: `enrich_person:${personId}` });
    if (companyId) await enqueue("enrich_company", { id: companyId }, { dedupeKey: `enrich_company:${companyId}` });
    await refreshMoves(id);
    return { id };
  }, ["/sales", "/sales/pipeline"]);
}
export async function updateDealAction(id: number, patch: Record<string, unknown>) {
  return run(async () => {
    await updateDeal(id, patch);
    await refreshMoves(id);
  }, ALL);
}
export async function deleteDealAction(id: number) {
  return run(() => deleteDeal(id), ["/sales", "/sales/pipeline"]);
}
export async function moveStageAction(id: number, toStage: number, o: { reason?: string; date?: string; note?: string; force?: boolean } = {}) {
  return run(async () => {
    await moveDeal(id, toStage, { cause: "manual", reason: o.reason || null, date: o.date || null, note: o.note || null, force: o.force });
    await refreshMoves(id);
  }, ALL);
}
/** A move by hand with what it needs: the Won checklist, a lost, disqualified, parked or reopen reason, or a note. */
export async function closeDealAction(id: number, toStage: number | null, p: ClosePayload, complete = false) {
  return run(async () => {
    await closeDeal(id, toStage, p, { complete });
    await refreshMoves(id);
  }, [...ALL, "/sales/insights"]);
}
/** Adds a note to (or corrects the note on) a line of the deal's history. */
export async function setEventNoteAction(eventId: number, note: string) {
  return run(async () => {
    const r = await one("update sales_deal_events set detail = $2, edited_at = now() where id = $1 returning id", [eventId, note.trim().slice(0, 2000) || null]);
    if (!r) throw new UserError("That history entry no longer exists.");
  }, ALL);
}
export async function logActivityAction(dealId: number, a: NewActivity) {
  return run<{ id: number }>(async () => {
    const id = await logActivity(dealId, a);
    await refreshMoves(dealId);
    return { id };
  }, ALL);
}
export async function editInteractionAction(id: number, patch: Parameters<typeof editInteraction>[1]) {
  return run(() => editInteraction(id, patch), ALL);
}
// ------------------------------------------------------------------ line items
export async function saveItemAction(dealId: number, item: Parameters<typeof saveItem>[1]) {
  return run<{ id: number }>(async () => ({ id: await saveItem(dealId, item) }), ALL);
}
export async function deleteItemAction(dealId: number, id: number) {
  return run(() => deleteItem(dealId, id), ALL);
}
export async function applyItemTotalsAction(dealId: number) {
  return run(async () => {
    await applyItemTotals(dealId);
    await refreshMoves(dealId);
  }, [...ALL, "/sales/insights"]);
}
export async function addPackageItemsAction(dealId: number, offerId: number, index: number) {
  return run<{ n: number }>(async () => {
    const { listOffers } = await import("@/lib/sales/offers");
    const pkg = (await listOffers()).find((o) => o.id === offerId)?.packages[index];
    if (!pkg) throw new UserError("That package no longer exists.");
    return { n: await addPackageItems(dealId, pkg, (await salesConfig()).default_tax_pct) };
  }, ALL);
}

// ------------------------------------------------------------------ stage playbooks
/** Ticks or unticks a checklist item for the deal's stage. */
export async function toggleChecklistAction(dealId: number, stageKey: string, item: string, on: boolean) {
  return run(async () => {
    const row = await one<{ checklist: Record<string, string[]> }>("select checklist from sales_deals where id = $1", [dealId]);
    if (!row) throw new UserError("That deal no longer exists.");
    const cur = new Set(row.checklist?.[stageKey] ?? []);
    if (on) cur.add(item.slice(0, 300));
    else cur.delete(item);
    await q("update sales_deals set checklist = jsonb_set(coalesce(checklist, '{}'::jsonb), $2::text[], $3::jsonb), updated_at = now() where id = $1", [dealId, [stageKey], JSON.stringify([...cur])]);
  }, ALL);
}

// ------------------------------------------------------------------ pipelines, team, bulk, import
export async function savePipelineAction(p: { id?: number; name: string; stage_ids?: number[]; active?: boolean }) {
  return run<{ id: number }>(async () => ({ id: await savePipeline(p) }), ["/sales/settings", "/sales/pipeline", ...ALL]);
}
export async function saveMemberAction(m: { id?: number; name: string; email?: string | null; phone?: string | null; role?: string | null; active?: boolean }) {
  return run<{ id: number }>(async () => ({ id: await saveMember(m) }), ["/sales/settings", "/sales/pipeline"]);
}
export async function bulkDealsAction(ids: number[], op: BulkOp) {
  return run<{ result: Awaited<ReturnType<typeof bulkDeals>> }>(async () => {
    const result = await bulkDeals(ids, op);
    if (!op.delete) for (const id of ids.slice(0, 200)) await refreshMoves(id).catch(() => {});
    return { result };
  }, ["/sales", "/sales/pipeline", "/sales/insights"]);
}
export async function importDealsAction(rows: Record<string, string>[], pipelineId?: number | null) {
  return run<{ result: Awaited<ReturnType<typeof importDeals>> }>(async () => {
    const result = await importDeals(rows, { pipeline_id: pipelineId ?? null });
    await refreshMoves();
    return { result };
  }, ["/sales", "/sales/pipeline"]);
}

export async function saveCustomFieldAction(f: { id?: number; scope?: Scope; label: string; type: CustomType; options?: string; help?: string; required_to_win?: boolean }) {
  return run<{ id: number }>(async () => ({ id: await saveCustomField(f) }), ["/sales/settings", ...ALL]);
}
export async function setCustomFieldActiveAction(id: number, active: boolean) {
  return run(() => setCustomFieldActive(id, active), ["/sales/settings", ...ALL]);
}
export async function setPersonAction(dealId: number, o: { name?: string; email?: string; phone?: string; linkedin?: string; title?: string; role?: string; as?: "primary" | "member" | "referrer" | "intermediary" }) {
  return run(async () => {
    const deal = await one<{ company_id: number | null }>("select company_id from sales_deals where id = $1", [dealId]);
    const pid = await upsertPerson({ name: o.name, email: o.email, phone: o.phone, linkedin: o.linkedin, title: o.title, company_id: o.as === "primary" || o.as === "member" ? deal?.company_id ?? null : null, relationship: o.as === "referrer" ? "referral" : o.as === "intermediary" ? "partner" : "cold" });
    if (o.as === "primary") await updateDeal(dealId, { person_id: pid });
    if (o.as === "referrer") await updateDeal(dealId, { referrer_id: pid });
    if (o.as === "intermediary") await updateDeal(dealId, { intermediary_id: pid, intermediary_type: o.role || "partner" });
    await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,$3) on conflict (deal_id, person_id) do update set role = excluded.role", [
      dealId, pid, o.as === "referrer" ? "referrer" : o.as === "intermediary" ? "intermediary" : o.role || "contact",
    ]);
    await enqueue("enrich_person", { id: pid }, { dedupeKey: `enrich_person:${pid}` });
  }, ALL);
}
export async function removeDealPersonAction(dealId: number, personId: number) {
  return run(async () => {
    await q("delete from sales_deal_people where deal_id = $1 and person_id = $2", [dealId, personId]);
  }, ALL);
}
export async function updatePersonAction(id: number, patch: Record<string, unknown>) {
  return run(() => updatePerson(id, patch), [...ALL, "/sales/accounts"]);
}
export async function mergePeopleAction(into: number, from: number) {
  return run(() => mergePeople(into, from), [...ALL, "/sales/accounts"]);
}
export async function updateCompanyAction(id: number, patch: Record<string, unknown>) {
  return run(() => updateCompany(id, patch), [...ALL, "/sales/accounts"]);
}

// ------------------------------------------------------------------ logging (paste anything)
export async function logToDealAction(dealId: number | null, text: string, o: { channel?: string; direction?: "in" | "out" | "both"; images?: string[] } = {}) {
  return run<{ result: CaptureResult }>(async () => {
    if (!text.trim() && !o.images?.length) throw new UserError("Paste a chat, an email or a note first.");
    const id = await capture({ source: "web", channel: o.channel ?? null, text, images: o.images ?? [], hints: { ...(dealId ? { deal_id: dealId } : {}), ...(o.direction ? { direction: o.direction } : {}) } }, { now: true });
    const result = await processCapture(id);
    return { result: { ...result, capture_id: id } as CaptureResult };
  }, ALL);
}
export async function undoCaptureAction(id: number) {
  return run(() => undoCapture(id), ALL);
}
export async function commitmentAction(id: number, status: "open" | "done" | "dropped") {
  return run(() => setCommitment(id, status), ALL);
}
export async function addCommitmentAction(dealId: number, owner: "me" | "them", text: string, due?: string | null) {
  return run(async () => {
    if (!text.trim()) throw new UserError("Write the promise.");
    await addCommitment({ deal_id: dealId, owner, text, due_at: due ? `${due}T12:30:00.000Z` : null });
    await refreshMoves(dealId);
  }, ALL);
}
export async function deleteInteractionAction(id: number) {
  return run(async () => {
    const row = await one<{ deal_id: number | null }>("delete from sales_interactions where id = $1 returning deal_id", [id]);
    if (row?.deal_id) await recomputeTouches(row.deal_id);
  }, ALL);
}

// ------------------------------------------------------------------ money
export async function addPaymentAction(dealId: number, label: string, amount: number, currency: string, dueOn?: string | null) {
  return run(async () => {
    if (!(amount > 0)) throw new UserError("Amount must be above zero.");
    await addPayment({ deal_id: dealId, label: label || "Payment", amount, currency, due_on: dueOn || null });
    await refreshMoves(dealId);
  }, ALL);
}
export async function markPaidAction(id: number, paidOn: string, status: "paid" | "written_off" | "due" = "paid") {
  return run(() => markPaid(id, paidOn, status), ALL);
}
export async function deletePaymentAction(id: number) {
  return run(() => deletePayment(id), ALL);
}

// ------------------------------------------------------------------ documents
export async function createQuoteAction(dealId: number, from?: { offerId: number; index: number }) {
  return run<{ id: number }>(async () => ({ id: await createQuote(dealId, undefined, from) }), ["/sales/docs", ...ALL]);
}
export async function saveRevisionAction(docId: number, r: Partial<RevisionRow>, title?: string) {
  return run(async () => {
    if (title?.trim()) await q("update sales_docs set title = $2 where id = $1", [docId, title.trim()]);
    await saveRevision(docId, r);
  }, ["/sales/docs", "/sales/docs/[id]"]);
}
export async function newRevisionAction(docId: number, note: string) {
  return run<{ rev: number }>(async () => ({ rev: await newRevision(docId, note) }), ["/sales/docs", "/sales/docs/[id]"]);
}
export async function markDocSentAction(docId: number) {
  return run(() => markDocSent(docId), ["/sales/docs", "/sales/docs/[id]", ...ALL]);
}
export async function createLinkAction(dealId: number | null, title: string, url: string) {
  return run<{ id: number }>(async () => ({ id: await createLinkDoc({ deal_id: dealId, title, url }) }), ["/sales/docs", ...ALL]);
}
export async function startFileAction(dealId: number | null, title: string, file: { name: string; mime: string; size: number }, o: { category?: string | null; internal?: boolean } = {}) {
  return run<{ id: number; uploadUrl: string }>(async () => {
    if (file.size > 45 * 1024 * 1024) throw new UserError("Keep files under 45 MB.");
    const path = newPath(new Date().toISOString().slice(0, 10), `sales-${file.name}`);
    const { url } = await fileStore().signUpload(path);
    const id = await createLinkDoc({ deal_id: dealId, title: title || file.name, kind: "file", file_path: path, file_name: file.name, category: o.category ?? null, internal: !!o.internal });
    return { id, uploadUrl: url };
  }, ["/sales/docs", ...ALL]);
}
export async function briefFromAuditAction(companyId: number, dealId: number | null) {
  return run<{ id: number }>(async () => {
    let c = await one<{ name: string; audit: { brief_md?: string } | null }>("select name, audit from sales_companies where id = $1", [companyId]);
    if (!c?.audit?.brief_md) {
      await auditCompany(companyId);
      c = await one("select name, audit from sales_companies where id = $1", [companyId]);
    }
    if (!c?.audit?.brief_md) throw new UserError("Could not write the brief. Try again in a minute.");
    return { id: await createLinkDoc({ deal_id: dealId, company_id: companyId, title: `Opportunities for ${c.name}`, kind: "brief", body: c.audit.brief_md }) };
  }, ["/sales/docs", ...ALL]);
}
export async function saveBriefAction(docId: number, title: string, body: string) {
  return run(async () => {
    await q("update sales_docs set title = $2, body = $3, updated_at = now() where id = $1", [docId, title, body]);
  }, ["/sales/docs", "/sales/docs/[id]"]);
}
export async function deleteDocAction(id: number) {
  return run(() => deleteDoc(id), ["/sales/docs", ...ALL]);
}

// ------------------------------------------------------------------ enrichment
export async function enrichAction(kind: "company" | "person" | "audit", id: number, now = false) {
  return run(async () => {
    // company and person research is the deep, staged kind: it starts now and reports progress, it does not block
    if (kind === "company") await startResearch({ subject: "company", id, trigger: "manual" });
    else if (kind === "person") await startResearch({ subject: "person", id, trigger: "manual" });
    else if (now) await auditCompany(id);
    else await enqueue("audit_website", { id }, { dedupeKey: `audit:${id}:${Date.now()}` });
  }, [...ALL, "/sales/accounts"]);
}

/** Research the company (and contact) behind a radar lead. Pass a name or website when the lead does not say. */
export async function researchLeadAction(itemId: number, override?: { company?: string; website?: string }) {
  return run<{ runId: number }>(async () => ({ runId: await researchRadarItem(itemId, override ?? {}, "manual") }), ["/sales/radar"]);
}
/** Everything known about a lead's company and people, plus the live progress of any research. Safe to poll. */
export async function researchViewAction(a: { radarItemId?: number; companyId?: number }): Promise<{ ok: true; view: ResearchView } | { ok: false; error: string }> {
  try {
    return { ok: true, view: await researchView(a) }; // a plain read: no undo entry, so polling it leaves no trace
  } catch (e) {
    return { ok: false, error: e instanceof UserError ? e.message : "Could not load the research." };
  }
}

// ------------------------------------------------------------------ radar
export async function radarToDealAction(id: number) {
  return run<{ id: number }>(async () => ({ id: await radarToDeal(id) }), ["/sales/radar", "/sales", "/sales/pipeline"]);
}
/** A radar lead made into a deal by mistake goes back to the radar. dryRun only says what it would remove. */
export async function sendBackToRadarAction(dealId: number, dryRun = false) {
  return run<{ result: SendBack }>(async () => {
    const result = await sendBackToRadar(dealId, { dryRun });
    if (!dryRun && result.ok) await refreshMoves();
    return { result };
  }, dryRun ? [] : ["/sales/radar", "/sales", "/sales/pipeline", "/sales/insights"]);
}
export async function radarStatusAction(id: number, status: "skipped" | "rejected" | "new") {
  return run(() => setRadarStatus(id, status), ["/sales/radar", "/sales"]);
}
export async function radarHideAction(ids: number[], hidden: boolean) {
  return run<{ changed: number }>(async () => ({ changed: await setRadarHidden(ids.filter(Number.isInteger), hidden) }), ["/sales/radar"]);
}
export async function runRadarAction() {
  return run<{ added: number; scored: number }>(async () => {
    const r = await runRadar(25_000, { force: false });
    const scored = await qualifyPending(25_000);
    return { added: r.added, scored };
  }, ["/sales/radar", "/sales"]);
}
export async function digestNowAction() {
  return run<{ result: string }>(async () => ({ result: await dailyDigest(50_000) }), ["/sales/radar"]);
}
// ------------------------------------------------------------------ hunts (scheduled AI lead hunting)
const HUNT_PATHS = ["/sales/radar"];
export async function saveHuntAction(input: HuntInput, id?: number) {
  return run<{ id: number }>(async () => ({ id: await saveHunt(input, id) }), HUNT_PATHS);
}
export async function toggleHuntAction(id: number, enabled: boolean) {
  return run(() => setHuntEnabled(id, enabled), HUNT_PATHS);
}
export async function deleteHuntAction(id: number) {
  return run(() => deleteHunt(id), HUNT_PATHS);
}
export async function runHuntAction(id: number) {
  return run(() => runHuntNow(id), HUNT_PATHS);
}
export async function huntRunsAction(id: number) {
  return run<{ runs: HuntRun[] }>(async () => ({ runs: await recentRuns(id) }), []);
}

export async function toggleSourceAction(id: number, enabled: boolean) {
  return run(async () => {
    await q("update sales_radar_sources set enabled = $2 where id = $1", [id, enabled]);
  }, ["/sales/radar", "/sales/settings"]);
}
export async function addSourceAction(s: { name: string; kind: "rss" | "search" | "reddit" | "gnews"; value: string; category: string }) {
  return run(async () => {
    if (!s.name.trim() || !s.value.trim()) throw new UserError("Give the source a name and a feed URL / query.");
    const config = s.kind === "rss" ? { url: s.value } : s.kind === "reddit" ? { sub: s.value.replace(/^r\//, "") } : { q: s.value };
    await q(
      "insert into sales_radar_sources (key, name, kind, category, config, interval_hours, managed) values ($1,$2,$3,$4,$5,12,false)",
      [`custom_${Date.now().toString(36)}`, s.name.trim(), s.kind, s.category, JSON.stringify(config)],
    );
  }, ["/sales/radar"]);
}
export async function addRadarItemAction(title: string, body: string, url?: string) {
  return run(async () => {
    const { storeItems } = await import("@/lib/sales/radar");
    await storeItems(null, [{ title, body, url: url || null }]);
    await qualifyPending(30_000);
  }, ["/sales/radar"]);
}

// ------------------------------------------------------------------ settings and the state machine
export async function saveConfigAction(patch: Partial<SalesConfig>) {
  return run(async () => {
    await updateSalesConfig(patch);
  }, ["/sales/settings", "/sales"]);
}
export async function saveStageAction(s: { id?: number; name: string; category: Category; probability?: number; sla_days?: number | null; sort?: number; color?: string; description?: string | null; active?: boolean }) {
  return run<{ id: number }>(async () => ({ id: await saveStage(s) }), ["/sales/settings", "/sales/pipeline"]);
}
export async function deleteStageAction(id: number) {
  return run(() => deleteStage(id), ["/sales/settings", "/sales/pipeline"]);
}
export async function setTransitionAction(from: number, to: number, requires: Requirement | null) {
  return run(() => setTransition(from, to, requires), ["/sales/settings"]);
}
export async function setAppsScriptUrlAction(url: string) {
  return run(async () => {
    const u = url.trim();
    if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(u)) throw new UserError("Paste the web app URL that ends in /exec.");
    await q("update sales_settings set apps_script_url = $1 where id = 1", [u || null]);
  }, ["/sales/settings"]);
}
export async function rotateTokenAction(which: "capture" | "google") {
  return run(async () => {
    await q(`update sales_settings set ${which === "capture" ? "capture_token" : "google_secret"} = md5(random()::text || clock_timestamp()::text) where id = 1`);
  }, ["/sales/settings"]);
}
export async function importContactsAction(ids: number[]) {
  return run<{ n: number }>(async () => {
    let n = 0;
    for (const id of ids) {
      const c = await one<{ name: string; companies: string[]; emails: string[]; phones: string[]; linkedin: string | null; cities: string[]; roles: string[] }>("select * from contacts where id = $1", [id]);
      if (!c) continue;
      const companyId = c.companies?.[0] ? await ensureCompany(c.companies[0]) : null;
      const pid = await upsertPerson({ name: c.name, email: c.emails?.[0], phone: c.phones?.[0], linkedin: c.linkedin, company_id: companyId, title: c.roles?.[0], city: c.cities?.[0], relationship: "warm" });
      await q("update sales_people set contact_id = $2 where id = $1 and contact_id is null", [pid, id]);
      n += 1;
    }
    return { n };
  }, ["/sales/accounts"]);
}
export async function configSnapshot() {
  return salesConfig();
}

export async function radarDraftAction(itemId: number) {
  return run<{ move: MoveRow | null }>(async () => {
    let mv = await one<{ id: number }>("select id from sales_moves where dedupe_key = $1", [`radar:${itemId}`]);
    if (!mv) {
      mv = await one<{ id: number }>(
        `insert into sales_moves (radar_item_id, kind, title, why, created_by, dedupe_key) select id, 'radar', left(title, 280), 'Radar lead', 'auto', $2
         from sales_radar_items where id = $1 on conflict (dedupe_key) do update set status = 'open' returning id`,
        [itemId, `radar:${itemId}`],
      );
    }
    if (!mv) throw new UserError("Lead not found.");
    return { move: await draftForMove(mv.id) };
  }, []);
}

/** The bookmarklet opens /sales/clip with the page text; this files it. */
export async function clipAction(text: string, url: string, title: string) {
  return run<{ result: CaptureResult }>(async () => {
    if (!text.trim()) throw new UserError("Nothing selected on that page.");
    const channel = /linkedin\.com/.test(url) ? "linkedin" : /instagram\.com/.test(url) ? "instagram" : /x\.com|twitter\.com/.test(url) ? "twitter" : null;
    const id = await capture({ source: "bookmarklet", channel, text: text.slice(0, 20_000), hints: { url: url.slice(0, 500), page_title: title.slice(0, 300) } }, { now: true });
    const result = await processCapture(id);
    return { result: { ...result, capture_id: id } as CaptureResult };
  }, ALL);
}

// ------------------------------------------------------------------ do not contact
export async function addBlockAction(kind: BlockKind, value: string, reason?: string | null) {
  return run<{ id: number }>(async () => ({ id: await addBlock(kind, value, reason) }), ["/sales", "/sales/radar", "/sales/playbook", "/sales/deal/[id]"]);
}
export async function removeBlockAction(id: number) {
  return run(() => removeBlock(id), ["/sales/playbook", "/sales/radar"]);
}

// ------------------------------------------------------------------ offers
export async function saveOfferAction(o: Parameters<typeof saveOffer>[0]) {
  return run<{ id: number }>(async () => ({ id: await saveOffer(o) }), ["/sales/playbook"]);
}
export async function deleteOfferAction(id: number) {
  return run(() => deleteOffer(id), ["/sales/playbook"]);
}

// ------------------------------------------------------------------ objections
export async function syncObjectionsAction() {
  return run<{ n: number }>(async () => ({ n: await syncObjections() }), ["/sales/playbook"]);
}
export async function saveObjectionAnswerAction(id: number, answer: string) {
  return run(() => saveAnswer(id, answer), ["/sales/playbook"]);
}
export async function renameObjectionAction(id: number, label: string) {
  return run(() => renameObjection(id, label), ["/sales/playbook"]);
}
export async function suggestObjectionAnswerAction(id: number) {
  return run<{ answer: string }>(async () => ({ answer: await suggestAnswer(id) }), ["/sales/playbook"]);
}

// ------------------------------------------------------------------ proof library
export async function saveProofAction(p: Parameters<typeof saveProof>[0]) {
  return run<{ id: number }>(async () => ({ id: await saveProof(p) }), ["/sales/playbook"]);
}
export async function deleteProofAction(id: number) {
  return run(() => deleteProof(id), ["/sales/playbook"]);
}
/** Writes drafts now for delivered or paid deals that have none (up to five). */
export async function draftProofsAction() {
  return run<{ n: number }>(async () => {
    const ids = await q<{ id: number }>(
      `select d.id from sales_deals d join sales_stages s on s.id = d.stage_id
       where s.role in ('delivered','paid') and not exists (select 1 from sales_proofs p where p.deal_id = d.id) order by d.updated_at desc limit 5`,
    );
    for (const r of ids) await draftProof(r.id);
    return { n: ids.length };
  }, ["/sales/playbook"]);
}
