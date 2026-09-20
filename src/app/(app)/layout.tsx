import { AppShell } from "@/components/app-shell";
import { voiceConfigured } from "@/lib/deepgram";
import { makeCtx } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await makeCtx();
  const last = ctx.s.last_tick_at;
  const ageSec = last ? Math.round((Date.now() - last.getTime()) / 1000) : null;
  return (
    <AppShell
      tz={ctx.tz}
      boundaryMin={ctx.boundaryMin}
      voiceEnabled={voiceConfigured()}
      health={{ stale: ageSec === null || ageSec > 600, ageSec, lastTickAt: last?.toISOString() ?? null }}
    >
      {children}
    </AppShell>
  );
}
