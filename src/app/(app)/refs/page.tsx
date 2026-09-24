import type { Metadata } from "next";
import { RefsClient } from "@/components/refs/refs-client";
import { listRefs, allTags } from "@/lib/services/refs";
import { deepgramReady } from "@/lib/voice-config";

export const metadata: Metadata = { title: "References" };
export const dynamic = "force-dynamic";

export default async function RefsPage() {
  const [refs, tags] = await Promise.all([listRefs(), allTags()]);
  return <RefsClient refs={refs} allTags={tags} voiceEnabled={deepgramReady()} />;
}
