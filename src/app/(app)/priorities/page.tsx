import type { Metadata } from "next";
import { MatrixView } from "@/components/priorities/matrix-view";
import { llmConfigured } from "@/lib/sales/llm";
import { makeCtx } from "@/lib/settings";
import { matrixTasks } from "@/lib/services/matrix";

export const metadata: Metadata = { title: "Priorities" };
export const dynamic = "force-dynamic";

export default async function PrioritiesPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const ctx = await makeCtx();
  const board = (await searchParams).board === "eisen" ? "eisen" : "value";
  const tasks = await matrixTasks(ctx);
  return <MatrixView tasks={tasks} today={ctx.today} initialMode={board} aiReady={llmConfigured()} />;
}
