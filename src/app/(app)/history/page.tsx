import type { Metadata } from "next";
import { HistoryView } from "@/components/history/history-view";
import { listActions } from "@/lib/undo";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const actions = await listActions(150).catch(() => []);
  return <HistoryView actions={actions} />;
}
