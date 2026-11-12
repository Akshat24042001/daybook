import type { Metadata } from "next";
import Link from "next/link";
import { TeamShell } from "@/components/team/kit";
import { fmtDay } from "@/lib/team/format";
import { myLeads, myMoves } from "@/lib/team/leads";
import { repOrLogin } from "@/lib/team/page-auth";

export const metadata: Metadata = { title: { absolute: "Aivaura Sales" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KIND_TONE: Record<string, string> = {
  reply: "bg-p-rose text-p-rose-fg", my_promise: "bg-p-butter text-p-butter-fg", next_step: "bg-p-sky text-p-sky-fg",
  their_promise: "bg-p-lilac text-p-lilac-fg", follow_up: "bg-p-mint text-p-mint-fg", no_next_step: "bg-muted text-subtle",
};
const KIND_LABEL: Record<string, string> = { reply: "Reply", my_promise: "Promise", next_step: "Next step", their_promise: "Chase", follow_up: "Follow up", no_next_step: "Plan" };

export default async function TeamHome() {
  const rep = await repOrLogin();
  const [leads, moves] = await Promise.all([myLeads(rep), myMoves(rep)]);
  const open = leads.filter((l) => l.stage_category === "open");
  const closed = leads.filter((l) => l.stage_category !== "open");
  return (
    <TeamShell name={rep.display_name}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Hi {rep.display_name.split(" ")[0]}</h1>
            <p className="text-sm text-subtle">{open.length} open lead{open.length === 1 ? "" : "s"} · {moves.length} thing{moves.length === 1 ? "" : "s"} to do</p>
          </div>
          <Link href="/team/new" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg">+ New lead</Link>
        </div>

        <section aria-label="To do">
          <h2 className="mb-2 text-[15px] font-semibold">To do</h2>
          {moves.length ? (
            <ul className="space-y-2">
              {moves.map((m, i) => (
                <li key={`${m.deal_id}-${m.kind}-${i}`}>
                  <Link href={`/team/lead/${m.deal_id}`} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent">
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${KIND_TONE[m.kind]}`}>{KIND_LABEL[m.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{m.title}</span>
                      <span className="block text-xs text-subtle">{m.lead}{m.due_at ? ` · ${fmtDay(m.due_at)}` : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-subtle">Nothing due. Good time to add a lead.</p>}
        </section>

        <section aria-label="My leads">
          <h2 className="mb-2 text-[15px] font-semibold">My leads</h2>
          {open.length || closed.length ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-subtle"><tr><th className="p-2.5">Lead</th><th className="p-2.5">Stage</th><th className="p-2.5">Next step</th><th className="p-2.5">Last touch</th></tr></thead>
                <tbody>
                  {[...open, ...closed].map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="p-2.5"><Link href={`/team/lead/${l.id}`} className="font-medium hover:text-accent">{l.title}</Link><span className="block text-xs text-subtle">{[l.person, l.mine ? "added by you" : null, l.value].filter(Boolean).join(" · ")}</span></td>
                      <td className="p-2.5">{l.stage}</td>
                      <td className="p-2.5">{l.next_action ?? <span className="text-warn">none</span>}{l.next_action_at ? <span className="block text-xs text-subtle">{fmtDay(l.next_action_at)}</span> : null}</td>
                      <td className="p-2.5 text-subtle">{l.last_touch ? fmtDay(l.last_touch) : "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-subtle">No leads yet. Add one, or ask for one to be shared with you.</p>}
        </section>
      </div>
    </TeamShell>
  );
}
