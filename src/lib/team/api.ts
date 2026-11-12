/**
 * Every /api/team endpoint goes through teamRoute: the salesperson is checked against the database (signed in,
 * active, same session), writes must be JSON from this site (no cross-site form posts), and the work runs as them,
 * so everything they write is stamped as theirs. Anything a salesperson may not see answers "not found".
 */
import { NextResponse } from "next/server";
import { repStore, UserError } from "../db";
import { currentRep, NotSignedIn, type Rep } from "./users";

export class NotFound extends Error {}

export function teamRoute<T>(fn: (rep: Rep, body: Record<string, unknown>, req: Request) => Promise<T>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== "GET") {
        // a cross-site form cannot send JSON, and a browser on another site cannot read our answer
        if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== new URL(req.url).host) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 403 });
      }
      const rep = await currentRep();
      const body = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
      const out = await repStore.run({ userId: rep.id }, () => fn(rep, body ?? {}, req));
      return NextResponse.json({ ok: true, ...(out as object) }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof NotSignedIn) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
      if (e instanceof NotFound) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
      if (e instanceof UserError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      console.error("[team] failed:", (e as Error).name, (e as Error).message);
      return NextResponse.json({ ok: false, error: "Something went wrong. Try again." }, { status: 500 });
    }
  };
}
