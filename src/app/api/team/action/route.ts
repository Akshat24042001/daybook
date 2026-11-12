import { teamRoute } from "@/lib/team/api";
import {
  prefillFromCapture, repAddPromise, repCapture, repCreateLead, repDeleteActivity, repLogActivity, repMoveStage, repSetPromise, repUpdateContact, repUpdateLead,
} from "@/lib/team/leads";
import { UserError } from "@/lib/db";
import { enqueue } from "@/lib/sales/jobs";
import type { NewLeadInput } from "@/lib/team/new-lead";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (v: unknown) => Number(v);

/**
 * Every change a salesperson can make, one endpoint. Each op checks access to the lead inside the team library;
 * anything not listed here does not exist for them.
 */
export const POST = teamRoute(async (rep, b) => {
  const deal = num(b.deal_id);
  const refresh = async () => {
    if (Number.isInteger(deal) && deal > 0) await enqueue("refresh_moves", { deal_id: deal }, { dedupeKey: `refresh_moves:${deal}` }).catch(() => {});
  };
  switch (b.op) {
    case "update_lead":
      await repUpdateLead(rep, deal, (b.patch ?? {}) as Record<string, unknown>);
      await refresh();
      return {};
    case "update_contact":
      await repUpdateContact(rep, deal, (b.patch ?? {}) as Record<string, unknown>);
      return {};
    case "move_stage":
      await repMoveStage(rep, deal, num(b.stage_id), { reason: (b.reason as string) ?? null, date: (b.date as string) ?? null, note: (b.note as string) ?? null });
      await refresh();
      return {};
    case "log":
      await repLogActivity(rep, deal, b as never);
      await refresh();
      return {};
    case "delete_log":
      await repDeleteActivity(rep, num(b.id));
      return {};
    case "add_promise":
      await repAddPromise(rep, deal, { owner: String(b.owner ?? "me"), text: String(b.text ?? ""), due: (b.due as string) ?? null });
      await refresh();
      return {};
    case "set_promise":
      await repSetPromise(rep, num(b.id), String(b.status ?? ""));
      return {};
    case "capture":
      return { result: await repCapture(rep, deal, { text: b.text as string, images: b.images as string[] }) };
    case "prefill":
      return { fields: await prefillFromCapture({ text: b.text as string, images: b.images as string[] }) };
    case "create_lead":
      return { id: await repCreateLead(rep, (b.lead ?? {}) as NewLeadInput) };
    default:
      throw new UserError("Unknown action.");
  }
});
