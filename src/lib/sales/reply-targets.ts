/**
 * Which buttons a move gets, and what each one honestly does. Pure and dependency-free: the web app and the Telegram
 * bot both use it, so a button can never say one thing in one place and do another elsewhere.
 *
 * Rules:
 *   1. A button only exists when it can do what its label says (no "LinkedIn" without a LinkedIn profile).
 *   2. The label names the destination; the hint says exactly what will happen.
 *   3. Opening an app or a page never counts as sending. The user confirms "Sent it", then it is logged.
 *   4. A radar lead is answered where it was posted (Reddit, HN, Upwork, the LinkedIn post...).
 */

export type TargetKind = "send" | "open" | "copy_open" | "call" | "find";

export interface Target {
  id: string;
  label: string;
  /** one plain sentence: what happens when you tap */
  hint: string;
  url: string | null;
  kind: TargetKind;
  /** interaction channel logged when you confirm; null = nothing to log (research links) */
  log: string | null;
  /** the platform name used in "Did you send it on …?" */
  where: string;
}

export interface TargetInput {
  phones?: string[] | null;
  emails?: string[] | null;
  linkedin?: string | null;
  person_name?: string | null;
  company_name?: string | null;
  /** the post or page the lead came from (radar item URL, or a deal's source link) */
  source_url?: string | null;
  /** radar category: requirement, hiring, funding, review, tender, launch */
  radar_category?: string | null;
  /** a radar lead with no deal yet */
  radar_only?: boolean;
  website?: string | null;
  google_ready?: boolean;
  draft?: string | null;
  subject?: string | null;
}

export interface Platform {
  key: string;
  name: string;
  /** can you answer the lead right there? */
  replyable: boolean;
  label: string;
  hint: string;
  log: string;
}

const enc = encodeURIComponent;

export function platformOf(url: string | null | undefined): Platform | null {
  if (!url) return null;
  if (url.startsWith("mail:")) {
    return { key: "email_alert", name: "Gmail", replyable: false, label: "Open the alert in Gmail", hint: "Opens the original alert email; the real listing link is inside it.", log: "other" };
  }
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  const p = (key: string, name: string, replyable: boolean, label: string, hint: string, log = "other"): Platform => ({ key, name, replyable, label, hint, log });
  if (host.endsWith("reddit.com")) return p("reddit", "Reddit", true, "Reply on Reddit", "Copies your reply and opens the post. Paste it as a comment, or tap the author's name and Start chat.");
  if (host === "news.ycombinator.com") return p("hn", "Hacker News", true, "Reply on Hacker News", "Copies your reply and opens the comment. Reply in the thread; HN has no DMs, so look for an email in their profile.");
  if (host.endsWith("upwork.com")) return p("upwork", "Upwork", true, "Open the job on Upwork", "Copies your proposal and opens the job. Paste it as the cover letter (this uses Connects).");
  if (host.endsWith("freelancer.com")) return p("freelancer", "Freelancer.com", true, "Open the project on Freelancer", "Copies your proposal and opens the project. Paste it in your bid.");
  if (host.endsWith("peopleperhour.com")) return p("pph", "PeoplePerHour", true, "Open on PeoplePerHour", "Copies your proposal and opens the job. Paste it in your proposal.");
  if (host.endsWith("guru.com")) return p("guru", "Guru", true, "Open on Guru", "Copies your proposal and opens the job. Paste it in your quote.");
  if (host.endsWith("contra.com")) return p("contra", "Contra", true, "Open on Contra", "Copies your message and opens the opportunity.");
  if (host.endsWith("linkedin.com") && /^\/(posts|feed)\//.test(path)) {
    return p("linkedin_post", "LinkedIn", true, "Open the LinkedIn post", "Copies your text and opens the post. Comment on it, or tap the author and press Message, then paste.", "linkedin");
  }
  if (host.endsWith("linkedin.com") && path.startsWith("/jobs")) return p("job", "LinkedIn Jobs", false, "Open the job listing", "Opens the listing. It is a hiring signal: find who runs that team and reach them directly.");
  if (host === "x.com" || host.endsWith("twitter.com")) return p("x", "X", true, "Reply on X", "Copies your reply and opens the post. Reply, or send a DM if their DMs are open.", "twitter");
  if (/(remoteok|remotive|weworkremotely|jobicy|himalayas|arbeitnow|indeed|adzuna|wellfound|glassdoor)\./.test(host)) {
    return p("job", "the job board", false, "Open the job listing", "Opens the listing. Use the contact or apply link there, or find the hiring manager.");
  }
  if (/(sam\.gov|contractsfinder|find-tender|tenders\.gov\.au|canadabuys|gem\.gov\.in|etimad)/.test(host)) {
    return p("tender", "the tender portal", false, "Open the tender", "Opens the tender notice. Bids go through the portal's own submission process.");
  }
  return p("page", host || "the page", false, "Open the source", "Opens where this lead was found.");
}

/** Reddit "u/name" or a lower-case single word is a username, not a name you can search LinkedIn for. */
export function isHandle(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return !n || /^u\//i.test(n) || /^@/.test(n) || (!/\s/.test(n) && n === n.toLowerCase());
}

export function waDigitsPure(s: string | null | undefined): string | null {
  let d = (s ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d.length >= 8 ? d : null;
}

function linkedinUrl(v: string): string {
  return /^https?:/i.test(v) ? v : `https://www.linkedin.com/in/${v.replace(/^in\//, "")}`;
}

const SIGNALS = new Set(["hiring", "funding", "review", "launch"]);

/** The honest list of buttons for a move, best first. */
export function replyTargets(t: TargetInput): Target[] {
  const out: Target[] = [];
  const text = t.draft ?? "";
  const phone = t.phones?.find((x) => waDigitsPure(x));
  const email = t.emails?.[0];
  const platform = platformOf(t.source_url);
  const signal = !!t.radar_category && SIGNALS.has(t.radar_category);

  // a lead someone posted: answer it where they posted it
  if (platform && (t.radar_only || (!phone && !email && !t.linkedin))) {
    out.push({
      id: "platform", label: platform.label, hint: platform.hint, url: t.source_url!.startsWith("mail:") ? `https://mail.google.com/mail/u/0/#all/${t.source_url!.slice(5)}` : t.source_url!,
      kind: platform.replyable && text ? "copy_open" : "find", log: platform.replyable ? platform.log : null, where: platform.name,
    });
  }
  if (phone) {
    out.push({ id: "whatsapp", label: "WhatsApp", hint: "Opens your WhatsApp chat with them, message already typed. You press send.", url: `https://wa.me/${waDigitsPure(phone)}${text ? `?text=${enc(text)}` : ""}`, kind: "open", log: "whatsapp", where: "WhatsApp" });
  }
  if (email) {
    if (t.google_ready) {
      out.push({ id: "gmail", label: "Send from Gmail", hint: `Sends right now from your Gmail to ${email}. It is logged automatically.`, url: null, kind: "send", log: "email", where: "Gmail" });
    } else {
      out.push({ id: "mail", label: "Email", hint: `Opens your mail app to ${email} with the text filled in. You press send.`, url: `mailto:${enc(email)}?subject=${enc(t.subject ?? "")}&body=${enc(text)}`, kind: "open", log: "email", where: "email" });
    }
  }
  if (t.linkedin) {
    out.push({ id: "linkedin", label: "LinkedIn profile", hint: "Copies the text and opens their profile. LinkedIn cannot pre-fill messages: press Message and paste.", url: linkedinUrl(t.linkedin), kind: text ? "copy_open" : "find", log: text ? "linkedin" : null, where: "LinkedIn" });
  } else if (t.person_name && !isHandle(t.person_name)) {
    const q = [t.person_name, t.company_name].filter(Boolean).join(" ");
    out.push({ id: "find_linkedin", label: "Find on LinkedIn", hint: `No LinkedIn profile saved yet. Opens a LinkedIn search for "${q}"; save their profile on the person once you find it.`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(q)}`, kind: "find", log: null, where: "LinkedIn" });
  }
  // a signal (hiring, funding, bad reviews) has no person yet: find who to talk to
  if ((signal || (t.radar_only && !platform?.replyable)) && t.company_name) {
    out.push({
      id: "find_dm", label: `Find who decides at ${t.company_name}`,
      hint: "Nobody asked you directly: this is a signal. Opens a search for the founder or operations head on LinkedIn.",
      url: `https://www.google.com/search?q=${enc(`site:linkedin.com/in "${t.company_name}" (founder OR CEO OR owner OR "head of operations")`)}`, kind: "find", log: null, where: "LinkedIn",
    });
  }
  if (t.website && (t.radar_only || signal)) {
    out.push({ id: "website", label: "Their website", hint: "Opens their website, to find a contact page or an email.", url: /^https?:/i.test(t.website) ? t.website : `https://${t.website}`, kind: "find", log: null, where: "their website" });
  }
  if (phone) out.push({ id: "call", label: "Call", hint: "Starts a phone call. Afterwards, confirm you spoke so it is logged.", url: `tel:${phone.replace(/[^\d+]/g, "")}`, kind: "call", log: "call", where: "a call" });
  return out;
}

/** The channel a draft should be written for: the place it will actually be sent. */
export function draftChannel(t: TargetInput): string {
  const platform = platformOf(t.source_url);
  const direct = !!(t.phones?.length || t.emails?.length || t.linkedin);
  // a free place to reply (Reddit, HN, LinkedIn post): answer where they posted. A paid marketplace (bids, credits):
  // write to them directly once their contact is known, a first email before a WhatsApp to someone who does not know you
  const paid = !!platform && ["upwork", "freelancer", "pph", "guru"].includes(platform.key);
  if (platform?.replyable && (!direct || (t.radar_only && !paid))) return platform.key;
  if (t.radar_only && paid && t.emails?.length) return "email";
  if (t.phones?.some((x) => waDigitsPure(x))) return "whatsapp";
  if (t.emails?.length) return "email";
  if (t.linkedin) return "linkedin";
  return "email";
}

/** The fields of a move that decide its buttons (a MoveRow fits). */
export interface MoveLike {
  phones: string[] | null;
  emails: string[] | null;
  linkedin: string | null;
  person_name: string | null;
  company_name: string | null;
  radar_url: string | null;
  radar_fit: { company?: string | null; website?: string | null } | null;
  radar_category: string | null;
  radar_item_id: number | null;
  deal_id: number | null;
  deal_source_url: string | null;
  company_website: string | null;
  draft: string | null;
  draft_subject: string | null;
}

export function targetInput(m: MoveLike, googleReady: boolean): TargetInput {
  const src = m.radar_url ?? (m.deal_source_url && /^(https?:|mail:)/.test(m.deal_source_url) ? m.deal_source_url : null);
  return {
    phones: m.phones, emails: m.emails, linkedin: m.linkedin, person_name: m.person_name,
    company_name: m.company_name ?? m.radar_fit?.company ?? null, source_url: src, radar_category: m.radar_category,
    radar_only: !!m.radar_item_id && !m.deal_id, website: m.company_website ?? m.radar_fit?.website ?? null,
    google_ready: googleReady, draft: m.draft, subject: m.draft_subject,
  };
}
