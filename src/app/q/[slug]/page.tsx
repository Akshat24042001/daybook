import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { one } from "@/lib/db";
import { salesConfig } from "@/lib/sales/config";
import { docBySlug, recordView, type RevisionRow } from "@/lib/sales/docs";
import { sign } from "@/lib/sales/links";
import { mdToHtml } from "@/lib/sales/md";
import { isOwnerRequest, visitorId } from "@/lib/sales/visitor";
import { ViewBeacon } from "./beacon";
import { PdfView } from "./pdf-view";
import { currencySymbol } from "@/components/sales/format";

const display = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--q-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--q-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--q-mono" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Aivaura" }, robots: { index: false, follow: false } };

// ₹1,50,000 for rupees; a code with a space where there is no common symbol (AED 5,000)
const money = (n: number, c: string) => {
  const sym = currencySymbol(c);
  return `${sym}${sym.length === 3 && /^[A-Z]+$/.test(sym) ? " " : ""}${Number(n).toLocaleString(c === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 })}`;
};

export default async function PublicDoc({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const doc = await docBySlug(slug);
  if (!doc) notFound();
  if (doc.kind === "link") redirect(`/l/${slug}`);
  const cfg = await salesConfig();
  const wantRev = sp.rev ? Number(sp.rev) : null;
  const owner = await isOwnerRequest();
  // Clients only ever see revisions that were sent. You (signed in) can also preview the draft.
  const sentOnly = owner ? "" : "and sent_at is not null";
  const latestSent = doc.kind === "quote"
    ? await one<RevisionRow>(owner
      ? "select * from sales_quote_revisions where doc_id = $1 and (sent_at is not null or rev = $2) order by (sent_at is not null) desc, rev desc limit 1"
      : "select * from sales_quote_revisions where doc_id = $1 and sent_at is not null order by rev desc limit 1",
      owner ? [doc.id, doc.current_rev] : [doc.id])
    : null;
  const rev = doc.kind === "quote"
    ? (wantRev ? await one<RevisionRow>(`select * from sales_quote_revisions where doc_id = $1 and rev = $2 ${sentOnly}`, [doc.id, wantRev]) : latestSent)
    : null;
  if (doc.kind === "quote" && !rev) notFound();
  const h = await headers();
  let viewId: number | null = null;
  if (!owner) {
    viewId = await recordView(doc, {
      ua: h.get("user-agent") ?? "", visitor: visitorId(h), country: h.get("x-vercel-ip-country"),
      city: decodeURIComponent(h.get("x-vercel-ip-city") ?? "") || null, rev: rev?.rev ?? null,
    }).catch(() => null);
  }
  const superseded = rev && latestSent && rev.rev < latestSent.rev;
  const validUntil = rev?.sent_at ? new Date(new Date(rev.sent_at).getTime() + rev.validity_days * 86_400_000) : null;
  const expired = !!validUntil && validUntil.getTime() < Date.now();
  const sub = rev ? rev.items.reduce((s, i) => s + Number(i.qty) * Number(i.unit_price), 0) : 0;

  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable} qdoc`}>
      <style>{CSS}</style>
      {viewId ? <ViewBeacon v={viewId} k={sign(`view.${viewId}`)} /> : null}
      <header className="qh">
        <span className="qbrand">{cfg.owner.company.toUpperCase()}</span>
        {rev ? <span className="qmeta">Version {rev.rev}</span> : null}
      </header>
      <main className="qmain">
        {owner ? <p className="qnote" title="You are signed in to Daybook, so opening this page is not counted as a client view.">Your preview · not counted as a view</p> : null}
        {sp.done === "accept" ? <div className="qcallout">Thank you. Your acceptance is recorded and {cfg.owner.name.split(" ")[0]} has been notified.</div> : null}
        {sp.done === "changes" ? <div className="qcallout">Thanks, your note has been sent. You will hear back shortly.</div> : null}
        {sp.e === "stale" ? <div className="qcallout bad">This proposal changed or expired. Reload the page to see the latest version.</div> : sp.e ? <div className="qcallout bad">Please add your name and try again.</div> : null}
        {superseded ? <div className="qcallout warm">This is an older version. <a href={`/q/${slug}`}>See the latest (v{latestSent!.rev})</a>.</div> : null}

        <p className="qlabel">{doc.kind === "quote" ? "Proposal" : doc.kind === "brief" ? "Opportunity brief" : "Document"}</p>
        <h1>{doc.kind === "file" ? readable(doc.title) : doc.title}</h1>

        {doc.kind === "quote" && rev ? (
          <>
            {rev.change_note && rev.rev > 1 ? <p className="qsub">What changed in v{rev.rev}: {rev.change_note}</p> : null}
            {rev.intro ? <div className="qprose" dangerouslySetInnerHTML={{ __html: mdToHtml(rev.intro) }} /> : null}
            {rev.scope ? (<><h2>Scope</h2><div className="qprose" dangerouslySetInnerHTML={{ __html: mdToHtml(rev.scope) }} /></>) : null}
            <h2>Investment</h2>
            <div className="qtablewrap">
              <table>
                <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {rev.items.map((it, i) => (
                    <tr key={i}>
                      <td><strong>{it.name}</strong>{it.description ? <div className="qdesc">{it.description}</div> : null}</td>
                      <td className="r">{it.qty}</td>
                      <td className="r">{money(it.unit_price, rev.currency)}</td>
                      <td className="r">{money(Number(it.qty) * Number(it.unit_price), rev.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="qtotals">
              {Number(rev.discount) || Number(rev.tax_pct) ? <div><span>Subtotal</span><span>{money(sub, rev.currency)}</span></div> : null}
              {Number(rev.discount) ? <div><span>Discount</span><span>− {money(rev.discount, rev.currency)}</span></div> : null}
              {Number(rev.tax_pct) ? <div><span>Tax ({rev.tax_pct}%)</span><span>{money((sub - Number(rev.discount)) * Number(rev.tax_pct) / 100, rev.currency)}</span></div> : null}
              <div className="qgrand"><span>Total</span><span>{money(rev.total, rev.currency)}</span></div>
            </div>
            {rev.timeline ? (<><h2>Timeline</h2><div className="qprose" dangerouslySetInnerHTML={{ __html: mdToHtml(rev.timeline) }} /></>) : null}
            {rev.payment_plan?.length ? (
              <>
                <h2>Payment plan</h2>
                <ul className="qplan">
                  {rev.payment_plan.map((p, i) => (
                    <li key={i}><span>{p.label} ({p.percent}%), {p.when}</span><span>{money(Math.round(rev.total * p.percent) / 100, rev.currency)}</span></li>
                  ))}
                </ul>
              </>
            ) : null}
            {rev.terms ? (<><h2>Terms</h2><div className="qprose small" dangerouslySetInnerHTML={{ __html: mdToHtml(rev.terms) }} /></>) : null}
            {validUntil ? <div className="qcallout warm">{expired ? "This proposal expired on" : "Valid until"} {validUntil.toISOString().slice(0, 10)}.{expired ? " Ask for an updated one." : ""}</div> : null}

            {!superseded && (rev.sent_at || owner) && !expired ? (
              doc.accepted_at ? (
                <div className="qcallout">Accepted by {doc.accepted_by} on {new Date(doc.accepted_at).toISOString().slice(0, 10)}.</div>
              ) : (
                <section className="qactions">
                  <form action="/api/sales/respond" method="post" className="qform">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="rev" value={rev.rev} />
                    <input type="hidden" name="action" value="accept" />
                    <label className="qlabel" htmlFor="qa-name">Your name</label>
                    <input id="qa-name" name="name" required placeholder="Full name" autoComplete="name" />
                    <button type="submit" className="qbtn">Accept this proposal →</button>
                  </form>
                  <details className="qchanges">
                    <summary>Need changes?</summary>
                    <form action="/api/sales/respond" method="post" className="qform">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="action" value="changes" />
                      <label className="qlabel" htmlFor="qc-name">Your name</label>
                      <input id="qc-name" name="name" required placeholder="Full name" />
                      <label className="qlabel" htmlFor="qc-note">What should change?</label>
                      <textarea id="qc-note" name="note" required rows={4} placeholder="Scope, timeline, price, anything" />
                      <button type="submit" className="qbtn outline">Send note</button>
                    </form>
                  </details>
                </section>
              )
            ) : null}
          </>
        ) : null}

        {doc.kind === "brief" && doc.body ? <div className="qprose" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.body) }} /> : null}

        {doc.kind === "file" ? (
          <section className="qfile">
            {doc.body ? <div className="qprose" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.body) }} /> : null}
            {/* the document itself, right on the page; the buttons are for saving it or opening it full screen */}
            {fileKind(doc.file_name) === "pdf" ? (
              <PdfView src={`/api/sales/file/${slug}`} title={readable(doc.title)} />
            ) : fileKind(doc.file_name) === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="qimg" src={`/api/sales/file/${slug}`} alt={readable(doc.title)} />
            ) : null}
            <div className="qrow">
              <a className="qbtn" href={`/api/sales/file/${slug}?dl=1`}>Download{fileKind(doc.file_name) === "pdf" ? " PDF" : ""}</a>
              {fileKind(doc.file_name) ? <a className="qbtn outline" href={`/api/sales/file/${slug}`} target="_blank" rel="noreferrer">Open full screen</a> : null}
            </div>
          </section>
        ) : null}

        <p className="qcontact">Questions? Reply on WhatsApp or <a href={`mailto:${cfg.owner.emails[0]}`}>email {cfg.owner.emails[0]}</a>.</p>
      </main>
      <footer className="qf"><span>{cfg.owner.website}</span><span>© {cfg.owner.company}</span></footer>
    </div>
  );
}

/** "Aivaura-Glowyug-WhatsApp-AI-Agent-Scope.pdf" reads as "Aivaura Glowyug WhatsApp AI Agent Scope". */
function readable(t: string): string {
  const s = t.replace(/\.(pdf|png|jpe?g|webp|docx?|pptx?|xlsx?)$/i, "");
  return /\s/.test(s) ? s : s.replace(/[-_]+/g, " ").trim();
}

function fileKind(name: string | null | undefined): "pdf" | "image" | null {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf" ? "pdf" : ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? "image" : null;
}

const CSS = `
.qdoc{--bg:#F6F7F9;--raised:#FFFFFF;--raised2:#F6F7F9;--fg:#2E3440;--muted:#667085;--navy:#2E3440;--accent:#33507F;--soft:#E4ECFA;--soft-line:#AFC6F0;--butter:#FBF1D3;--mustard:#F1D78E;--line:#E1E5EB;--th:#EFF1F5;--th-fg:#2E3440;--gfill:#A7D8BC;--gink:#265A3F;
  min-height:100dvh;background:var(--bg);color:var(--fg);font-family:var(--q-body),Arial,sans-serif;font-size:16px;line-height:1.6;color-scheme:light}
@media (prefers-color-scheme: dark){.qdoc{--bg:#16181D;--raised:#1E2128;--raised2:#262A33;--fg:#E6E8EC;--muted:#9AA1AD;--navy:#E6E8EC;--accent:#BFD2F5;--soft:#232D40;--soft-line:#9DB8E8;--butter:#362F1D;--mustard:#E9CD7E;--line:#323743;--th:#262A33;--th-fg:#E6E8EC;--gfill:#8FCFAB;--gink:#16181D;color-scheme:dark}}
.qdoc a{color:var(--accent)}
.qh,.qf{max-width:900px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 24px}
.qh{border-bottom:1px solid var(--line)}
.qf{border-top:1px solid var(--line);font-family:var(--q-mono),monospace;font-size:12px;color:var(--muted);margin-top:48px}
.qbrand{font-family:var(--q-display),sans-serif;font-weight:800;letter-spacing:.04em;font-size:16px;color:var(--navy)}
.qmeta{font-size:13px;color:var(--muted);text-align:right}
.qmain{max-width:900px;margin:0 auto;padding:32px 24px}
.qmain h1{color:var(--navy);font-family:var(--q-display),sans-serif;font-weight:800;font-size:clamp(30px,6vw,50px);line-height:1.05;margin:4px 0 20px;text-wrap:balance}
.qmain h2{color:var(--navy);font-family:var(--q-display),sans-serif;font-weight:700;font-size:22px;margin:36px 0 12px;padding-top:24px;border-top:1px solid var(--line)}
.qmain h3,.qmain h4{font-family:var(--q-display),sans-serif;font-weight:700;margin:20px 0 8px}
.qlabel{font-family:var(--q-mono),monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 6px;display:block}
.qsub,.qnote{color:var(--muted);font-size:14px}
.qprose p{margin:0 0 12px;max-width:64ch}.qprose ul,.qprose ol{margin:0 0 12px 20px}.qprose li{margin:4px 0}.qprose.small{font-size:14px;color:var(--muted)}
.qtablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--raised)}
table{width:100%;border-collapse:collapse;min-width:520px}th{background:var(--th);color:var(--th-fg);text-align:left;font-weight:600;padding:12px 14px;font-size:14px}
td{padding:12px 14px;border-top:1px solid var(--line);vertical-align:top}tr:nth-child(even) td{background:var(--raised2)}.r{text-align:right;white-space:nowrap}
.qdesc{color:var(--muted);font-size:14px;margin-top:2px}
.qtotals{margin:12px 0 0 auto;max-width:360px}.qtotals div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)}
.qgrand{font-family:var(--q-display),sans-serif;font-weight:800;font-size:20px;border-bottom:0!important;color:var(--navy)}
.qplan{list-style:none;padding:0;margin:0}.qplan li{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line)}
.qcallout{background:var(--soft);border-left:3px solid var(--soft-line);padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0}
.qcallout.warm{background:var(--butter);border-left-color:var(--mustard)}
.qcallout.bad{border-left-color:#C0392B}
.qactions{margin-top:36px;padding-top:24px;border-top:1px solid var(--line);display:grid;gap:20px}
.qform{display:grid;gap:8px;max-width:440px}
.qform input,.qform textarea{background:transparent;border:0;border-bottom:1px solid var(--line);color:var(--fg);font:inherit;padding:8px 0;outline:none}
.qform input:focus,.qform textarea:focus{border-bottom-color:var(--soft-line)}
.qbtn{display:inline-flex;justify-content:center;align-items:center;background:var(--gfill);color:var(--gink)!important;border:0;border-radius:8px;padding:12px 20px;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;margin-top:8px}
.qbtn:hover{filter:brightness(.97)}.qbtn.outline{background:transparent;border:1px solid var(--line);color:var(--fg)!important}.qbtn.outline:hover{border-color:var(--soft-line)}
.qchanges summary{cursor:pointer;color:var(--muted);font-size:14px}.qchanges .qform{margin-top:12px}
.qcontact{margin-top:32px;color:var(--muted);font-size:14px}
.qfile{margin-top:8px;display:grid;gap:16px}
.qview{width:100%;height:min(80vh,1100px);border:1px solid var(--line);border-radius:8px;background:#fff}
.qimg{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px}
.qrow{display:flex;flex-wrap:wrap;gap:10px}.qrow .qbtn{margin-top:0}
.qnote{margin:0 0 16px}
.qpages{display:grid;gap:12px}.qpages canvas{display:block;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)}
@media (max-width:600px){.qh,.qf,.qmain{padding-left:16px;padding-right:16px}table{min-width:0}th:nth-child(2),th:nth-child(3),td:nth-child(2),td:nth-child(3){display:none}}
`;
