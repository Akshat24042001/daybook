/**
 * Sales inside the Daybook Telegram bot.
 *   - Forward any message, send a screenshot, share a WhatsApp chat export (.txt or .zip), or start a text with "lead":
 *     it is logged to the right person and deal, with a card to confirm, fix or undo.
 *   - Voice notes about a client ("met Priya, she wants...") are recognised and logged the same way.
 *   - Moves, radar leads and pipeline are one tap away from the 💼 Sales key.
 */
import { unzipSync, strFromU8 } from "fflate";
import { one, q, UserError } from "../db";
import type { Ctx } from "../settings";
import { downloadFile, editMessage, esc, sendMessage, type Button, type InlineMarkup } from "../telegram/api";
import { completeMove, confirmSent, sendMoveEmail, targetsFor } from "./act";
import { money } from "@/components/sales/format";
import { reportMoney, salesConfig } from "./config";
import { currentFocus } from "./focus";
import { iso } from "./context";
import { deleteDeal } from "./deals";
import { googleConfigured } from "./google";
import { capture, processCapture, undoCapture, type CaptureResult } from "./ingest";
import { baseUrl, goLink } from "./links";
import { draftForMove, getMove, KIND_LABEL, listMoves, setMoveStatus, snoozeMove, type MoveRow } from "./moves";
import { radarToDeal, setRadarStatus } from "./radar";
import { moveDeal, stageByRole } from "./stages";

export interface TgSalesMessage {
  message_id: number;
  text?: string;
  caption?: string;
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  forward_origin?: { type: string; sender_user?: { first_name?: string; last_name?: string }; sender_user_name?: string; chat?: { title?: string } };
  forward_from?: { first_name?: string; last_name?: string };
  forward_sender_name?: string;
  forward_date?: number;
  media_group_id?: string;
  reply_to_message?: { message_id: number };
}

const PREFIX = /^\/?(lead|sales|client|prospect|deal|log)\b[:\s-]*/i;

/** True when a free-text message is meant for Sales ("lead: ...", "sales ..."). */
export function isSalesText(text: string): boolean {
  return PREFIX.test(text.trim());
}

export function salesKeyboardRow(): { text: string } {
  return { text: "💼 Sales" };
}

const url = (path: string) => `${baseUrl()}${path}`;
const httpsOnly = (u: string | null) => (u && u.startsWith("https://") ? u : null);

async function dataUrl(fileId: string, fallbackMime: string): Promise<{ url: string; bytes: Uint8Array; mime: string }> {
  const f = await downloadFile(fileId);
  const mime = f.contentType.startsWith("audio/") ? fallbackMime : f.contentType || fallbackMime;
  return { url: `data:${mime};base64,${Buffer.from(f.data).toString("base64")}`, bytes: f.data, mime };
}

function forwardedFrom(m: TgSalesMessage): string | null {
  const o = m.forward_origin;
  if (o?.sender_user) return [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(" ") || null;
  if (o?.sender_user_name) return o.sender_user_name;
  if (o?.chat?.title) return o.chat.title;
  if (m.forward_from) return [m.forward_from.first_name, m.forward_from.last_name].filter(Boolean).join(" ") || null;
  return m.forward_sender_name ?? null;
}

/** Handles photos, documents, forwards and "lead:" texts. Returns false when the message is not for Sales. */
export async function handleSalesMessage(chat: number, m: TgSalesMessage, later: (fn: () => Promise<void>) => void): Promise<boolean> {
  const isForward = !!(m.forward_origin || m.forward_date);
  const text = (m.text ?? m.caption ?? "").trim();
  if (!m.photo && !m.document && !isForward && !isSalesText(text)) return false;

  // a reply to "who is this?" or a debrief prompt is handled by handleSalesReply
  let body = isSalesText(text) ? text.replace(PREFIX, "") : text;
  const images: string[] = [];
  let fileName: string | undefined;
  if (m.photo?.length) {
    const big = [...m.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    images.push((await dataUrl(big.file_id, "image/jpeg")).url);
  }
  if (m.document) {
    fileName = m.document.file_name ?? "file";
    const mime = m.document.mime_type ?? "";
    if ((m.document.file_size ?? 0) > 19 * 1024 * 1024) throw new UserError("That file is over Telegram's 20 MB bot limit. Export the chat without media.");
    const f = await dataUrl(m.document.file_id, mime || "application/octet-stream");
    if (/zip/i.test(mime) || /\.zip$/i.test(fileName)) {
      const files = unzipSync(f.bytes);
      const txt = Object.entries(files).find(([n]) => /\.txt$/i.test(n));
      if (!txt) throw new UserError("No chat text inside that zip. In WhatsApp use Export chat, Without media.");
      body = `${body}\n${strFromU8(txt[1])}`.trim();
    } else if (/^text\//i.test(mime) || /\.(txt|csv|md)$/i.test(fileName)) {
      body = `${body}\n${Buffer.from(f.bytes).toString("utf8")}`.trim();
    } else if (/^image\//i.test(mime)) {
      images.push(f.url);
    } else {
      throw new UserError("I can read chat exports (.txt / .zip), screenshots and text. For a PDF, paste the important part as text.");
    }
  }
  const from = forwardedFrom(m);
  if (isForward && from) body = `Forwarded message from ${from}:\n${body}`;

  // several screenshots sent together arrive one by one: fold them into the first capture
  if (m.media_group_id) {
    const sibling = await one<{ id: number }>(
      "select id from sales_captures where hints->>'media_group' = $1 and status = 'pending' and created_at > now() - interval '3 minutes' order by id limit 1",
      [m.media_group_id],
    );
    if (sibling) {
      await q("update sales_captures set images = images || $2::jsonb, text = concat_ws(E'\\n', text, $3::text) where id = $1", [sibling.id, JSON.stringify(images), body || null]);
      return true;
    }
  }
  const ack = await sendMessage(chat, images.length ? "⏳ Reading the screenshot…" : "⏳ Logging it…");
  const id = await capture(
    {
      source: "telegram", channel: m.document && /whatsapp/i.test(fileName ?? "") ? "whatsapp" : null, text: body, images,
      hints: { ...(fileName ? { file_name: fileName } : {}), ...(m.media_group_id ? { media_group: m.media_group_id } : {}) } as never,
      tg_chat: chat, tg_message_id: ack,
    },
    { now: true },
  );
  later(async () => {
    if (m.media_group_id) await new Promise((r) => setTimeout(r, 6_000)); // let the rest of the album arrive
    await processAndReport(id);
  });
  return true;
}

/** Text captured from a voice note or a "lead:" message. */
export async function captureText(chat: number, text: string, later: (fn: () => Promise<void>) => void, hints: Record<string, unknown> = {}): Promise<void> {
  const ack = await sendMessage(chat, "⏳ Logging it…");
  const id = await capture({ source: "telegram", text: text.replace(PREFIX, ""), hints: hints as never, tg_chat: chat, tg_message_id: ack }, { now: true });
  later(() => processAndReport(id));
}

export async function processAndReport(id: number, force: Parameters<typeof processCapture>[1] = {}): Promise<void> {
  const cap = await one<{ tg_chat: number | null; tg_message_id: number | null }>("select tg_chat, tg_message_id from sales_captures where id = $1", [id]);
  try {
    const r = await processCapture(id, force);
    await report(id, r, cap?.tg_chat ?? null, cap?.tg_message_id ?? null);
  } catch (e) {
    await q("update sales_captures set status = 'failed', error = $2 where id = $1", [id, (e as Error).message.slice(0, 500)]);
    if (cap?.tg_chat) {
      const msg = `⚠️ Could not log that: ${esc((e as Error).message.slice(0, 200))}\nIt is saved; I will retry in a few minutes.`;
      if (cap.tg_message_id) await editMessage(cap.tg_chat, cap.tg_message_id, msg).catch(() => sendMessage(cap.tg_chat!, msg));
      else await sendMessage(cap.tg_chat, msg).catch(() => {});
    }
    const { enqueue } = await import("./jobs");
    await enqueue("process_capture", { id, notify: true }, { runAfter: new Date(Date.now() + 5 * 60_000), dedupeKey: `capture:${id}` });
  }
}

/** The result card: where it went, what was understood, and buttons to fix it. */
export async function report(id: number, r: CaptureResult, chat: number | null, mid: number | null): Promise<void> {
  const target = chat ?? (await (await import("./notify")).ownerChat());
  if (!target) return;
  let text: string;
  const rows: Button[][] = [];
  if (r.skipped) {
    text = `ℹ️ ${esc(r.skipped)}`;
  } else if (r.candidates?.length) {
    text = `🤔 Who is this about?\n${esc(r.summary ?? "")}`;
    for (const c of r.candidates.slice(0, 4)) rows.push([{ text: `${c.full_name}${c.company_name ? ` · ${c.company_name}` : ""}`, callback_data: `zs:cp:${id}:${c.id}` }]);
    rows.push([{ text: "➕ Someone new", callback_data: `zs:cn:${id}` }, { text: "Ignore", callback_data: `zs:cu:${id}` }]);
  } else if (!r.deal_id) {
    text = `🤔 I could not tell who this is about.\n${esc(r.summary ?? "")}\nReply to this message with their name.`;
    rows.push([{ text: "Ignore", callback_data: `zs:cu:${id}` }]);
  } else {
    const d = await one<{ title: string; person_name: string | null; company_name: string | null; stage_name: string }>(
      `select d.title, p.full_name as person_name, c.name as company_name, s.name as stage_name from sales_deals d join sales_stages s on s.id = d.stage_id
       left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id where d.id = $1`,
      [r.deal_id],
    );
    const commits = r.commitments?.length
      ? await q<{ owner: string; text: string; due_at: string | null }>("select owner, text, due_at from sales_commitments where id = any($1)", [r.commitments])
      : [];
    const who = d ? `${d.person_name ?? d.title}${d.company_name && d.person_name ? ` · ${d.company_name}` : ""}` : "deal";
    const lines = [
      `${r.created_deal ? "🆕 New lead" : "✅ Logged"}: <b>${esc(who)}</b>`,
      `${channelEmoji(r.channel)} ${esc(r.channel ?? "note")}${r.message_count ? ` · ${r.message_count} messages` : ""} · stage <b>${esc(d?.stage_name ?? "?")}</b>${r.moved ? " (moved)" : ""}`,
      r.summary ? `📝 ${esc(r.summary.slice(0, 500))}` : "",
      ...commits.map((c) => `${c.owner === "me" ? "📌 You promised" : "🤝 They promised"}: ${esc(c.text)}${c.due_at ? ` (by ${iso(c.due_at).slice(0, 10)})` : ""}`),
      r.already ? `♻️ ${r.already} message${r.already > 1 ? "s were" : " was"} already logged, skipped` : "",
      r.meeting_at ? `📅 Meeting ${esc(new Date(r.meeting_at).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }))}` : "",
      r.shots ? `🖼 ${r.shots} screenshot${r.shots > 1 ? "s" : ""} saved on the deal` : "",
      r.filled?.length ? `🗂 Filled in: ${esc([...new Set(r.filled)].join(", ").slice(0, 400))}` : "",
      r.next_step ? `➡️ ${esc(r.next_step)}` : "",
    ].filter(Boolean);
    text = lines.join("\n");
    if (r.suggestion) {
      text += `\n\n💡 ${esc(r.suggestion.label)}`;
      rows.push([{ text: "Yes", callback_data: `zs:sg:${id}` }, { text: "No", callback_data: `zs:sx:${id}` }]);
    }
    const open = httpsOnly(url(`/sales/deal/${r.deal_id}`));
    rows.push([
      ...(open ? [{ text: "Open deal", url: open }] : []),
      { text: "Wrong person", callback_data: `zs:cw:${id}` },
      { text: "Undo", callback_data: `zs:cu:${id}` },
    ]);
  }
  const markup: InlineMarkup = { inline_keyboard: rows };
  let msgId = mid;
  if (mid) await editMessage(target, mid, text, markup).catch(async () => {
    msgId = await sendMessage(target, text, markup);
  });
  else msgId = await sendMessage(target, text, markup);
  if (msgId && (!r.deal_id || r.candidates?.length)) {
    await q("insert into sales_tg_prompts (message_id, kind, capture_id) values ($1,'who',$2) on conflict (message_id) do update set capture_id = excluded.capture_id", [msgId, id]);
  }
}

function channelEmoji(c: string | null | undefined): string {
  return ({ whatsapp: "🟢", email: "✉️", linkedin: "🔷", call: "📞", meeting: "📅", in_person: "🤝", instagram: "📸", document: "📄" } as Record<string, string>)[c ?? ""] ?? "💬";
}

/** A reply to one of our Sales prompts ("who is this?", "how did the call go?"). Returns false when it is not one. */
export async function handleSalesReply(chat: number, replyToId: number, text: string, later: (fn: () => Promise<void>) => void): Promise<boolean> {
  const p = await one<{ kind: string; deal_id: number | null; meeting_id: number | null; capture_id: number | null }>("select * from sales_tg_prompts where message_id = $1", [replyToId]);
  if (!p) return false;
  if (p.kind === "who" && p.capture_id) {
    const capId = p.capture_id;
    await undoCapture(capId).catch(() => {});
    await q("update sales_captures set status = 'pending' where id = $1", [capId]);
    const ack = await sendMessage(chat, `⏳ Logging it to ${esc(text.slice(0, 60))}…`);
    await q("update sales_captures set tg_message_id = $2 where id = $1", [capId, ack]);
    const { resolvePerson } = await import("./identity");
    const r = await resolvePerson({ name: text });
    later(() => processAndReport(capId, r.person ? { person_id: r.person.id } : { newPersonName: text.trim().slice(0, 80) }));
    return true;
  }
  if (p.kind === "debrief" || p.kind === "deal_note") {
    await captureText(chat, text, later, { ...(p.deal_id ? { deal_id: p.deal_id } : {}), ...(p.meeting_id ? { meeting_id: p.meeting_id } : {}), direction: "both" });
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ menus

export async function salesMenu(ctx: Ctx, chat: number): Promise<void> {
  const cfg = await salesConfig();
  const moves = await listMoves({ horizonHours: 0, limit: 500 });
  const radar = await one<{ n: number }>("select count(*)::int as n from sales_radar_items where status = 'qualified' and deal_id is null and found_at > now() - interval '3 days'");
  const focus = await currentFocus(cfg, ctx.now);
  await sendMessage(chat, `💼 <b>Sales</b>\n${moves.length} moves due now · ${radar?.n ?? 0} fresh radar leads\nThis week: ${esc(focus.country)} · today: ${esc(focus.industry)}\n\nSend me anything: a forwarded chat, a screenshot, a WhatsApp export, or a voice note after a meeting.`, {
    inline_keyboard: [
      [{ text: "⚡ Moves", callback_data: "zs:m" }, { text: "🎯 Radar", callback_data: "zs:rr" }],
      [{ text: "📊 Pipeline", callback_data: "zs:pl" }, ...(httpsOnly(url("/sales")) ? [{ text: "Open Sales", url: url("/sales") }] : [])],
    ],
  });
}

export async function movesMessage(limit = 8): Promise<{ text: string; markup: InlineMarkup }> {
  const moves = await listMoves({ horizonHours: 12, limit });
  if (!moves.length) return { text: "⚡ No moves due. Pipeline is clean, go find new conversations (🎯 Radar).", markup: { inline_keyboard: [[{ text: "🎯 Radar", callback_data: "zs:rr" }]] } };
  const lines = moves.map((m, i) => `${i + 1}. <b>${esc(KIND_LABEL[m.kind] ?? m.kind)}</b> · ${esc(m.title.slice(0, 110))}${m.why ? `\n   <i>${esc(m.why.slice(0, 140))}</i>` : ""}`);
  const rows: Button[][] = moves.map((m, i) => [
    { text: `${i + 1} ✍️ Draft`, callback_data: `zs:md:${m.id}` },
    { text: "Done", callback_data: `zs:mx:${m.id}` },
    { text: "⏰ +1d", callback_data: `zs:mz:${m.id}:24` },
    { text: "Skip", callback_data: `zs:mk:${m.id}` },
  ]);
  if (httpsOnly(url("/sales"))) rows.push([{ text: "Open all moves", url: url("/sales") }]);
  return { text: `⚡ <b>Moves</b>\n\n${lines.join("\n")}`, markup: { inline_keyboard: rows } };
}

const T_EMOJI: Record<string, string> = { whatsapp: "🟢", gmail: "✉️", mail: "✉️", linkedin: "🔷", find_linkedin: "🔎", find_dm: "🔎", website: "🌐", call: "📞", platform: "↗️" };

async function moveCard(m: MoveRow): Promise<{ text: string; markup: InlineMarkup }> {
  const google = await googleConfigured();
  const targets = targetsFor(m, google);
  const head = `<b>${esc(KIND_LABEL[m.kind] ?? m.kind)}</b> · ${esc(m.title)}${m.person_name ? `\n👤 ${esc(m.person_name)}${m.company_name ? ` · ${esc(m.company_name)}` : ""}` : ""}`;
  const draft = m.draft ? `\n\n${m.draft_subject ? `<b>Subject:</b> ${esc(m.draft_subject)}\n` : ""}<code>${esc(m.draft)}</code>` : "";
  // say exactly what each button does; Telegram cannot copy for you, so the copy step is spelled out
  const how = m.draft
    ? targets.filter((t) => t.kind !== "find").map((t) => `• <b>${esc(t.label)}</b>: ${esc(t.kind === "copy_open" ? `tap the text above to copy it first. ${t.hint.replace(/^Copies [^.]*\. /, "")}` : t.hint)}`).join("\n")
    : "";
  const rows: Button[][] = [];
  const buttons: Button[] = [];
  for (const t of targets) {
    if (!m.draft && t.kind !== "find") continue;
    const label = `${T_EMOJI[t.id] ?? "↗️"} ${t.label}`;
    if (t.kind === "send") buttons.push({ text: label, callback_data: `zs:me:${m.id}` });
    else if (t.kind === "find") {
      if (t.url?.startsWith("https://")) buttons.push({ text: label, url: t.url });
    } else {
      const link = httpsOnly(goLink(m.id, t.id));
      if (link) buttons.push({ text: label, url: link });
    }
  }
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([
    { text: m.draft ? "🔁 Redraft" : "✍️ Draft", callback_data: `zs:md:${m.id}` },
    ...(m.draft && targets.some((t) => t.log) ? [{ text: "✅ Sent it", callback_data: `zs:ms:${m.id}` }] : []),
  ]);
  rows.push([
    { text: "Done another way", callback_data: `zs:mx:${m.id}` },
    { text: "⏰ +1d", callback_data: `zs:mz:${m.id}:24` },
    { text: "Skip", callback_data: `zs:mk:${m.id}` },
  ]);
  const note = m.draft
    ? `\n\n${how}${how ? "\n" : ""}<i>Opening a link never counts as sent. Tap ✅ Sent it once it has gone, and it is logged.</i>`
    : targets.length ? "" : "\n\n<i>No phone, email or LinkedIn saved for them yet.</i>";
  return { text: `${head}${draft}${note}`, markup: { inline_keyboard: rows } };
}

async function pipelineMessage(): Promise<string> {
  const rows = await q<{ name: string; category: string; n: number; usd: number | null; weighted: number | null }>(
    `select s.name, s.category, count(d.id)::int as n, sum(d.value_usd) as usd, sum(d.value_usd * coalesce(d.probability, s.probability) / 100.0) as weighted
     from sales_stages s left join sales_deals d on d.stage_id = s.id where s.active group by s.id order by s.sort`,
  );
  const open = rows.filter((r) => r.category === "open");
  const R = reportMoney(await salesConfig());
  const fmt = (usd: number | null) => (usd ? money(Math.round(R.fromUsd(usd)), R.cur) : "");
  const zero = money(0, R.cur);
  const unpaid = await one<{ usd: number | null }>(
    `select sum(p.amount * coalesce((select (config->'fx'->>p.currency)::numeric from sales_settings), 1)) as usd from sales_payments p where p.status = 'due'`,
  );
  return `📊 <b>Pipeline</b>\n${open.map((r) => `${esc(r.name)}: <b>${r.n}</b> ${fmt(r.usd)}`).join("\n")}\n\nWeighted: <b>${fmt(open.reduce((s, r) => s + Number(r.weighted ?? 0), 0)) || zero}</b>\nWon, not yet paid: <b>${fmt(Number(unpaid?.usd ?? 0)) || zero}</b>`;
}

async function radarMessage(): Promise<{ text: string; markup: InlineMarkup }> {
  const items = await q<{ id: number; title: string; score: number; url: string | null; angle: string | null }>(
    "select id, title, score, url, angle from sales_radar_items where status = 'qualified' and deal_id is null and found_at > now() - interval '3 days' order by score desc limit 6",
  );
  if (!items.length) return { text: "🎯 No fresh qualified leads right now. The radar runs all day; the morning digest always brings at least one.", markup: { inline_keyboard: [] } };
  return {
    text: `🎯 <b>Radar</b>\n\n${items.map((t, i) => `${i + 1}. <b>${t.score}</b> ${esc(t.title.slice(0, 120))}${t.angle ? `\n   💡 ${esc(t.angle.slice(0, 140))}` : ""}`).join("\n")}`,
    markup: {
      inline_keyboard: items.map((t, i) => [
        { text: `${i + 1} ✍️ Draft`, callback_data: `zs:rd:${t.id}` },
        { text: "➕ Lead", callback_data: `zs:rl:${t.id}` },
        { text: "Skip", callback_data: `zs:rs:${t.id}` },
        ...(t.url?.startsWith("https://") ? [{ text: "Open post", url: t.url }] : []),
      ]),
    },
  };
}

// ------------------------------------------------------------------ buttons

export async function salesCallback(chat: number, mid: number | undefined, parts: string[], later: (fn: () => Promise<void>) => void): Promise<string | undefined> {
  const [, op, a, b] = parts;
  const id = Number(a);
  const edit = async (text: string, markup?: InlineMarkup) => {
    if (mid) await editMessage(chat, mid, text, markup);
    else await sendMessage(chat, text, markup);
  };
  switch (op) {
    case "m": {
      const m = await movesMessage();
      await sendMessage(chat, m.text, m.markup);
      return undefined;
    }
    case "pl":
      await sendMessage(chat, await pipelineMessage());
      return undefined;
    case "rr": {
      const r = await radarMessage();
      await sendMessage(chat, r.text, r.markup);
      return undefined;
    }
    case "md": {
      const wait = await sendMessage(chat, "✍️ Writing it in your voice…");
      later(async () => {
        try {
          const m = await draftForMove(id);
          if (!m) throw new UserError("That move is gone.");
          const card = await moveCard(m);
          await editMessage(chat, wait, card.text, card.markup);
        } catch (e) {
          await editMessage(chat, wait, `⚠️ ${esc((e as Error).message.slice(0, 200))}`).catch(() => {});
        }
      });
      return undefined;
    }
    case "mx":
      // done some other way: closes the move, logs no message
      await completeMove(id, null);
      return "Closed. Nothing logged.";
    case "ms": {
      const r = await confirmSent(id, await googleConfigured());
      if (mid) await edit(r.where ? `✅ Logged as sent on ${esc(r.where)}.` : "✅ Done. Open one of the buttons first next time, so I know where it went.");
      return r.where ? `Logged on ${r.where}` : "Done";
    }
    case "mk":
      await setMoveStatus(id, "skipped");
      return "Skipped";
    case "mz":
      await snoozeMove(id, Number(b) || 24);
      return "Snoozed";
    case "me": {
      await sendMoveEmail(id);
      const m = await getMove(id);
      if (mid && m) await edit(`✉️ Sent from your Gmail${m.person_name ? ` to ${esc(m.person_name)}` : ""}.\n<code>${esc((m.draft ?? "").slice(0, 600))}</code>`);
      return "Sent";
    }
    case "cu":
      await undoCapture(id);
      if (mid) await edit("↩️ Undone. Nothing from that message is in Sales now.");
      return "Undone";
    case "cw": {
      await undoCapture(id);
      await q("update sales_captures set status = 'needs_person' where id = $1", [id]);
      const msg = await sendMessage(chat, "Who is it about? Reply to this message with their name (or name and company).", { force_reply: true, input_field_placeholder: "Name, company" } as never);
      await q("insert into sales_tg_prompts (message_id, kind, capture_id) values ($1,'who',$2) on conflict (message_id) do nothing", [msg, id]);
      return undefined;
    }
    case "cp": {
      await q("update sales_captures set status = 'pending', tg_message_id = $2 where id = $1", [id, mid ?? null]);
      later(() => processAndReport(id, { person_id: Number(b) }));
      return "Logging…";
    }
    case "cn": {
      const msg = await sendMessage(chat, "Reply to this message with the new person's name (and company if you like).", { force_reply: true, input_field_placeholder: "Name, company" } as never);
      await q("insert into sales_tg_prompts (message_id, kind, capture_id) values ($1,'who',$2) on conflict (message_id) do nothing", [msg, id]);
      return undefined;
    }
    case "sg": {
      const cap = await one<{ result: CaptureResult | null }>("select result from sales_captures where id = $1", [id]);
      const s = cap?.result?.suggestion;
      if (!s || !cap?.result?.deal_id) return "Nothing to apply";
      const stage = await stageByRole(s.role);
      if (!stage) return "That stage is switched off";
      await moveDeal(cap.result.deal_id, stage.id, {
        cause: "telegram", reason: s.reason ?? (s.role === "lost" ? "they said no" : null),
        date: s.date ?? (s.role === "nurture" ? new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) : null), force: true, note: "confirmed in Telegram",
      });
      return `Moved to ${stage.name}`;
    }
    case "sx":
      return "OK, left as is";
    case "rd": {
      const wait = await sendMessage(chat, "✍️ Writing a reply in your voice…");
      later(async () => {
        try {
          let mv = await one<{ id: number }>("select id from sales_moves where dedupe_key = $1", [`radar:${id}`]);
          if (!mv) {
            mv = await one<{ id: number }>(
              `insert into sales_moves (radar_item_id, kind, title, why, created_by, dedupe_key) select id, 'radar', left(title, 280), 'Radar lead', 'auto', $2 from sales_radar_items where id = $1
               on conflict (dedupe_key) do update set status = 'open' returning id`,
              [id, `radar:${id}`],
            );
          }
          const m = await draftForMove(mv!.id);
          if (!m) throw new UserError("Lead not found.");
          const card = await moveCard(m);
          await editMessage(chat, wait, card.text, card.markup);
        } catch (e) {
          await editMessage(chat, wait, `⚠️ ${esc((e as Error).message.slice(0, 200))}`).catch(() => {});
        }
      });
      return undefined;
    }
    case "rl": {
      const dealId = await radarToDeal(id);
      const open = httpsOnly(url(`/sales/deal/${dealId}`));
      await sendMessage(chat, "➕ Added as a New lead. Enrichment and a website audit are running.", open ? { inline_keyboard: [[{ text: "Open deal", url: open }]] } : undefined);
      return "Lead created";
    }
    case "rs":
      await setRadarStatus(id, "skipped");
      return "Skipped";
    case "nl":
      await deleteDeal(id);
      await q("delete from sales_people p where not exists (select 1 from sales_deals d where d.person_id = p.id) and not exists (select 1 from sales_interactions i where i.person_id = p.id) and p.created_at > now() - interval '2 days'");
      if (mid) await edit("Removed. Not a lead.");
      return "Removed";
    default:
      return undefined;
  }
}
