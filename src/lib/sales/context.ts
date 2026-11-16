/** Plain-text context about a deal, for drafts, briefs and summaries. */
import { one, q } from "../db";
import { getDeal } from "./deals";
import { dealEngagement, dealKnowledge, dealReach, engagementLine, reachLines } from "./reach";

export const iso = (x: unknown): string => (x ? new Date(x as string).toISOString() : "");

/** What a message at each stage has to achieve, so a draft moves the deal one step and no further. */
export const STAGE_GOAL: Record<string, string> = {
  new: "First contact: earn a reply. Show you understood their situation; ask one easy question.",
  contacted: "They have not replied yet: add something new and useful, make replying effortless.",
  engaged: "They are talking: understand the need properly and get them to a short call or demo.",
  discovery: "Discovery: pin down scope, timeline, budget and who decides; propose the next concrete step (demo, proposal).",
  proposal: "Proposal is with them: answer questions, remove doubts, ask for the decision or what is missing.",
  negotiation: "Negotiation: resolve the specific objection with substance, protect the value, agree terms and the start date.",
  won: "Won: confirm what happens next (advance payment, kickoff date, what you need from them).",
  active: "Project live: keep them updated, ask for what you need, no selling.",
  delivered: "Delivered: confirm it works for them and collect the balance politely.",
  paid: "Paid: thank them, check results, ask for a referral or testimonial when it fits.",
  nurture: "Not now: stay useful with something relevant to them, no pressure, keep the door open.",
  ghosted: "No reply for a while: a short, honest message with one new reason to answer.",
  hold: "On hold: check if the blocker is gone, offer a smaller first step.",
  lost: "Lost: only reach out with something genuinely new; respect their decision.",
};

export async function dealContext(dealId: number, opts: { interactions?: number } = {}): Promise<string> {
  const d = await getDeal(dealId);
  if (!d) return "";
  const person = d.person_id
    ? await one<{ full_name: string; title: string | null; country: string | null; city: string | null; relationship: string; enrichment: Record<string, { v?: unknown }> }>(
        "select full_name, title, country, city, relationship, enrichment from sales_people where id = $1",
        [d.person_id],
      )
    : null;
  const company = d.company_id
    ? await one<{ name: string; industry: string | null; country: string | null; website: string | null; employees: number | null; revenue_usd: number | null; description: string | null; audit: { summary?: string } | null }>(
        "select name, industry, country, website, employees, revenue_usd, description, audit from sales_companies where id = $1",
        [d.company_id],
      )
    : null;
  const commits = await q<{ owner: string; text: string; due_at: string | null }>(
    "select owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 10",
    [dealId],
  );
  const recent = await q<{ channel: string; direction: string; occurred_at: string; summary: string | null; body: string | null; subject: string | null }>(
    "select channel, direction, occurred_at, summary, body, subject from sales_interactions where deal_id = $1 order by occurred_at desc limit $2",
    [dealId, opts.interactions ?? 16],
  );
  const docs = await q<{ title: string; kind: string; status: string; view_count: number; last_viewed_at: string | null; current_rev: number }>(
    "select title, kind, status, view_count, last_viewed_at, current_rev from sales_docs where deal_id = $1 order by updated_at desc limit 5",
    [dealId],
  );
  const lines: string[] = [];
  lines.push(`DEAL: ${d.title} | stage: ${d.stage_name} | source: ${d.source}${d.source_detail ? ` (${d.source_detail})` : ""}`);
  if (d.stage_role && STAGE_GOAL[d.stage_role]) lines.push(`STAGE GOAL: ${STAGE_GOAL[d.stage_role]}`);
  lines.push(reachLines(await dealReach(dealId)));
  lines.push(await dealKnowledge(dealId));
  lines.push(engagementLine(await dealEngagement(dealId)));
  if (d.next_action) lines.push(`CURRENT NEXT STEP: ${d.next_action}${d.next_action_at ? ` (due ${iso(d.next_action_at).slice(0, 10)})` : ""}`);
  if (d.value_amount) lines.push(`VALUE: ${d.currency} ${d.value_amount}`);
  if (person) {
    const e = person.enrichment ?? {};
    const pick = (k: string) => (e[k]?.v ? String(e[k].v) : null);
    lines.push(`CONTACT: ${person.full_name}${person.title ? `, ${person.title}` : ""}${person.city || person.country ? ` (${[person.city, person.country].filter(Boolean).join(", ")})` : ""}, relationship: ${person.relationship}`);
    const extra = [pick("career_summary"), pick("talking_points"), pick("communication_style")].filter(Boolean);
    if (extra.length) lines.push(`ABOUT THEM: ${extra.join(" | ").slice(0, 600)}`);
  }
  if (company) {
    lines.push(`COMPANY: ${company.name}${company.industry ? `, ${company.industry}` : ""}${company.country ? `, ${company.country}` : ""}${company.employees ? `, ~${company.employees} people` : ""}${company.website ? `, ${company.website}` : ""}`);
    if (company.description) lines.push(`WHAT THEY DO: ${company.description.slice(0, 400)}`);
    if (company.audit?.summary) lines.push(`WEBSITE AUDIT: ${company.audit.summary.slice(0, 500)}`);
  }
  if (d.referrer_name) lines.push(`REFERRED BY: ${d.referrer_name}`);
  if (d.intermediary_name) lines.push(`INTERMEDIARY: ${d.intermediary_name} (${d.intermediary_type ?? "partner"})${d.talk_via_intermediary ? ", talk to the client through them" : ""}`);
  if (d.summary) lines.push(`WHERE WE ARE: ${d.summary}`);
  if (d.requirements) lines.push(`REQUIREMENTS: ${d.requirements}`);
  if (d.budget) lines.push(`BUDGET: ${d.budget}`);
  if (d.timeline) lines.push(`TIMELINE: ${d.timeline}`);
  if (d.objections?.length) lines.push(`OBJECTIONS: ${d.objections.join("; ")}`);
  const dd = d as unknown as Record<string, unknown>;
  for (const [k, label] of [["pain", "THEIR PAIN"], ["desired_outcome", "WHAT THEY WANT"], ["impact", "WHAT IT COSTS THEM"], ["current_solution", "WHAT THEY DO TODAY"], ["compelling_event", "WHY NOW"], ["scope", "SCOPE"], ["decision_process", "WHO DECIDES"], ["risks", "RISKS"]] as const) {
    if (dd[k]) lines.push(`${label}: ${String(dd[k]).slice(0, 500)}`);
  }
  // your tested answers from the objection library (Sales > Playbook)
  const answers = await q<{ label: string; answer: string }>(
    `select distinct o.label, o.answer from sales_deal_objections x join sales_objections o on o.id = x.objection_id
     where x.deal_id = $1 and o.answer is not null order by o.label`,
    [dealId],
  ).catch(() => []);
  if (answers.length) lines.push(`YOUR BEST ANSWERS TO THEIR OBJECTIONS (use the substance, in your own words):\n${answers.map((a) => `- ${a.label}: ${a.answer}`).join("\n")}`);
  if (commits.length) lines.push(`OPEN PROMISES:\n${commits.map((c) => `- ${c.owner === "me" ? "I promised" : "They promised"}: ${c.text}${c.due_at ? ` (by ${iso(c.due_at).slice(0, 10)})` : ""}`).join("\n")}`);
  if (docs.length) lines.push(`DOCUMENTS: ${docs.map((x) => `${x.title} v${x.current_rev} ${x.status}, opened ${x.view_count}x`).join("; ")}`);
  if (recent.length) {
    // their latest words matter most: the newest message from them, word for word
    const lastIn = recent.find((r) => r.direction === "in" && (r.body || r.summary));
    if (lastIn) lines.push(`THEIR LATEST MESSAGE (${iso(lastIn.occurred_at).slice(0, 16).replace("T", " ")}, ${lastIn.channel}):\n${(lastIn.body || lastIn.summary || "").slice(0, 1500)}`);
    const lastOut = recent.find((r) => r.direction === "out");
    if (lastOut && lastIn) lines.push(new Date(lastOut.occurred_at) > new Date(lastIn.occurred_at) ? "WHO IS WAITING: they are (you wrote last)." : "WHO IS WAITING: you are (they wrote last): answer them.");
    lines.push("CONVERSATION (newest first; the newest ones word for word):");
    recent.forEach((r, i) => {
      const text = (i < 6 ? r.body || r.summary || r.subject || "" : r.summary || r.subject || r.body || "").replace(/\s+/g, " ").slice(0, i < 6 ? 1200 : 300);
      lines.push(`- ${iso(r.occurred_at).slice(0, 16).replace("T", " ")} ${r.channel} ${r.direction === "in" ? "FROM THEM" : r.direction === "out" ? "FROM ME" : r.direction}: ${text}`);
    });
  } else {
    lines.push("CONVERSATION: nothing logged yet (this is a first contact).");
  }
  return lines.join("\n");
}

/**
 * The deal as it stands, for filing a new log: stage, the current next step and its date, open promises with their ids
 * (so a log that fulfils one can close it), and the recent conversation word for word (so a screenshot that repeats an
 * old message is recognised, and who wrote it is known).
 */
export async function dealStateForFiling(dealId: number): Promise<string | null> {
  const d = await getDeal(dealId);
  if (!d) return null;
  const company = d.company_id ? await one<{ name: string; website: string | null }>("select name, website from sales_companies where id = $1", [d.company_id]) : null;
  const person = d.person_id ? await one<{ full_name: string; title: string | null }>("select full_name, title from sales_people where id = $1", [d.person_id]) : null;
  const promises = await q<{ id: number; owner: string; text: string; due_at: string | null }>(
    "select id, owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 12", [dealId]);
  const talks = await q<{ occurred_at: string; channel: string; direction: string; summary: string | null; body: string | null }>(
    "select occurred_at, channel, direction, summary, body from sales_interactions where deal_id = $1 order by occurred_at desc limit 14", [dealId]);
  const lines = [
    `DEAL: ${d.title} | stage: ${d.stage_name}`,
    reachLines(await dealReach(dealId)),
    await dealKnowledge(dealId),
    engagementLine(await dealEngagement(dealId)),
    person ? `CONTACT: ${person.full_name}${person.title ? `, ${person.title}` : ""}` : "CONTACT: unknown",
    `COMPANY ON FILE: ${company ? `${company.name}${company.website ? ` (${company.website})` : " (no website yet)"}` : "none yet"}`,
    `CURRENT NEXT STEP: ${d.next_action ? `${d.next_action}${d.next_action_at ? ` (due ${iso(d.next_action_at).slice(0, 16).replace("T", " ")} UTC)` : ""}` : "none"}`,
    d.summary ? `WHERE WE ARE: ${d.summary}` : "",
    promises.length ? `OPEN PROMISES (id: who, what):\n${promises.map((p) => `- id ${p.id}: ${p.owner === "me" ? "owner promised" : "they promised"} ${p.text}${p.due_at ? ` (due ${iso(p.due_at).slice(0, 10)})` : ""}`).join("\n")}` : "OPEN PROMISES: none",
    talks.length ? `CONVERSATION SO FAR (newest first):\n${talks.map((t) => `- ${iso(t.occurred_at).slice(0, 16).replace("T", " ")} ${t.channel} ${t.direction === "in" ? "FROM THEM" : t.direction === "out" ? "FROM ME" : t.direction.toUpperCase()}: ${(t.body || t.summary || "").replace(/\s+/g, " ").slice(0, 600)}`).join("\n")}` : "CONVERSATION SO FAR: nothing logged",
  ];
  return lines.filter(Boolean).join("\n");
}
