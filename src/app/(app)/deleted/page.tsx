import type { Metadata } from "next";
import { DeletedView } from "@/components/history/deleted-view";
import { listDeleted } from "@/lib/bin";

export const metadata: Metadata = { title: "Deleted" };
export const dynamic = "force-dynamic";

export default async function DeletedPage({ searchParams }: { searchParams: Promise<{ auto?: string; q?: string }> }) {
  const sp = await searchParams;
  const auto = sp.auto === "1";
  const search = (sp.q ?? "").slice(0, 80);
  const groups = await listDeleted({ auto, search, limit: 200 }).catch(() => []);
  return <DeletedView groups={groups} auto={auto} search={search} />;
}
