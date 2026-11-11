import type { Metadata } from "next";
import Link from "next/link";
import { listDocs } from "@/lib/sales/docs";
import { Chip } from "@/components/ui";
import { money } from "@/components/sales/format";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

export default async function DocsPage() {
  const docs = await listDocs();
  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl">Documents</h1>
        <p className="text-sm text-subtle">Quotes, briefs, files and links, all tracked.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted text-left text-xs text-subtle"><tr><th className="p-2">Document</th><th className="p-2">Deal</th><th className="p-2">Status</th><th className="p-2 text-right">Value</th><th className="p-2 text-right">Opens</th><th className="p-2">Last open</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="p-2"><Link href={`/sales/docs/${d.id}`} className="font-medium hover:text-accent">{d.title}</Link><p className="text-xs text-subtle">{d.kind}{d.kind === "quote" ? ` v${d.current_rev}` : ""}</p></td>
                <td className="p-2 text-xs">{d.deal_id ? <Link href={`/sales/deal/${d.deal_id}`} className="text-accent hover:underline">{d.deal_title}</Link> : ""}</td>
                <td className="p-2"><Chip>{d.status}</Chip></td>
                <td className="p-2 text-right text-xs tabular">{d.total ? money(Number(d.total), d.currency ?? "INR") : ""}</td>
                <td className="p-2 text-right text-xs tabular">{d.view_count}</td>
                <td className="p-2 text-xs text-subtle">{fmt(d.last_viewed_at)}</td>
              </tr>
            ))}
            {!docs.length ? <tr><td colSpan={6} className="p-6 text-center text-sm text-subtle">No documents yet. Open a deal and create a quote, link or brief.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
