import type { Metadata } from "next";
import { UnfinishedClient } from "@/components/unfinished/unfinished-client";
import { makeCtx } from "@/lib/settings";
import { unfinishedTasks } from "@/lib/services/unfinished";
import { toUnfinishedRow } from "@/lib/view-types";

export const metadata: Metadata = { title: "Unfinished" };
export const dynamic = "force-dynamic";

export default async function UnfinishedPage() {
  const ctx = await makeCtx();
  const rows = (await unfinishedTasks(ctx.today)).map((t) => toUnfinishedRow(ctx.today, t));
  return (
    <div className="mx-auto max-w-4xl">
      <UnfinishedClient rows={rows} />
    </div>
  );
}
