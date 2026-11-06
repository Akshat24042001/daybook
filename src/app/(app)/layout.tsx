import { AppShell } from "@/components/app-shell";
import { voiceConfigured } from "@/lib/deepgram";
import { aiConfigured } from "@/lib/ai";
import { makeCtx } from "@/lib/settings";
import { recentAction } from "@/lib/undo";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await makeCtx();
  // the newest change from the last minute and a half, so it can be undone from any screen
  const undo = await recentAction().catch(() => null);
  return (
    <AppShell
      tz={ctx.tz}
      boundaryMin={ctx.boundaryMin}
      voiceEnabled={voiceConfigured()}
      aiEnabled={aiConfigured()}
      undo={undo}
    >
      {children}
    </AppShell>
  );
}
