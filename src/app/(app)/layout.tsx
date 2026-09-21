import { AppShell } from "@/components/app-shell";
import { voiceConfigured } from "@/lib/deepgram";
import { aiConfigured } from "@/lib/ai";
import { makeCtx } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await makeCtx();
  return (
    <AppShell
      tz={ctx.tz}
      boundaryMin={ctx.boundaryMin}
      voiceEnabled={voiceConfigured()}
      aiEnabled={aiConfigured()}
    >
      {children}
    </AppShell>
  );
}
