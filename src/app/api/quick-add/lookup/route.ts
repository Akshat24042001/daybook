import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Names for quick-add autocomplete: active projects and people. Behind the login like every /api route. */
export async function GET() {
  try {
    const [projects, people] = await Promise.all([
      q<{ name: string }>("select name from projects where not archived order by lower(name)"),
      q<{ name: string }>("select name from people order by lower(name)"),
    ]);
    return NextResponse.json({ projects: projects.map((p) => p.name), people: people.map((p) => p.name) });
  } catch (e) {
    console.error("[lookup] failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ projects: [], people: [] }, { status: 500 });
  }
}
