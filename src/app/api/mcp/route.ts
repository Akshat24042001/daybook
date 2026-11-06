import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { UserError } from "@/lib/db";
import { TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Daybook as an MCP server (streamable HTTP, JSON responses, stateless). Add it to Claude as a custom connector with
 * the URL  https://<your-app>/api/mcp  and the header  Authorization: Bearer <MCP_TOKEN>.
 * It is off until MCP_TOKEN is set (16+ characters). See docs/MCP.md.
 */
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(m: Rpc): Promise<object | null> {
  const isNotification = m.id === undefined || m.id === null;
  switch (m.method) {
    case "initialize": {
      const want = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "daybook", version: "1.0.0" },
        instructions: "Daybook is the owner's personal planner and sales tracker. Read freely; writes are limited to adding tasks, ticking tasks off and logging the day's numbers.",
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, {
        tools: TOOLS.map((t) => ({
          name: t.name, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return err(m.id, -32602, `Unknown tool: ${String(m.params?.name)}`);
      const args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>;
      try {
        const out = await tool.run(args);
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // tool failures are results the model can read and react to, not protocol errors
        const msg = e instanceof UserError ? e.message : "That did not work.";
        if (!(e instanceof UserError)) console.error("[mcp] tool failed:", tool.name, (e as Error).message);
        return ok(m.id, { isError: true, content: [{ type: "text", text: msg }] });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, notifications/cancelled...
      return err(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function POST(req: Request) {
  const token = (process.env.MCP_TOKEN ?? "").trim();
  if (token.length < 16) return NextResponse.json({ error: "MCP is not enabled. Set MCP_TOKEN (16+ characters)." }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "www-authenticate": "Bearer" } });
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json(err(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return NextResponse.json(err(null, -32600, "Invalid batch"), { status: 400 });
    const out = (await Promise.all(body.map((b) => handle(b as Rpc)))).filter((x): x is object => !!x);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  if (!body || typeof body !== "object") return NextResponse.json(err(null, -32600, "Invalid request"), { status: 400 });
  const res = await handle(body as Rpc);
  return res ? NextResponse.json(res) : new NextResponse(null, { status: 202 });
}

// Streamable HTTP lets a server refuse the GET (server-to-client stream) with 405; we have nothing to push.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}
