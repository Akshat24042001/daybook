import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { docUrl, getDoc, revisions } from "@/lib/sales/docs";
import { baseUrl } from "@/lib/sales/links";
import { DocEditor, type ViewRow } from "@/components/sales/doc-editor";

export const metadata: Metadata = { title: "Document" };
export const dynamic = "force-dynamic";

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const doc = Number.isFinite(id) ? await getDoc(id) : null;
  if (!doc) notFound();
  const [revs, views, deal] = await Promise.all([
    revisions(id),
    q<ViewRow>("select id, rev, viewed_at, country, city, device, seconds, visitor from sales_doc_views where doc_id = $1 order by viewed_at desc limit 100", [id]),
    doc.deal_id ? one<{ title: string }>("select title from sales_deals where id = $1", [doc.deal_id]) : null,
  ]);
  const url = doc.kind === "link" ? `${baseUrl()}/l/${doc.slug}` : docUrl(doc.slug);
  return <DocEditor doc={doc} revs={revs} views={views} url={url} dealTitle={deal?.title ?? null} />;
}
