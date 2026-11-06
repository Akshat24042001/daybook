import { beforeEach, describe, expect, it } from "vitest";
import { q } from "@/lib/db";
import { GET, POST } from "@/app/api/mcp/route";
import { resetDb } from "./helpers";

const TOKEN = "test-token-0123456789abcdef";
const call = (body: unknown, token: string | null = TOKEN) =>
  POST(new Request("http://x/api/mcp", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
const rpc = async (method: string, params?: object, id = 1) => (await call({ jsonrpc: "2.0", id, method, params })).json();
const tool = async (name: string, args: object = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return { isError: !!r.result.isError, text: r.result.content[0].text as string };
};

beforeEach(async () => {
  process.env.MCP_TOKEN = TOKEN;
  await resetDb();
});

describe("MCP server", () => {
  it("is off without a token, and refuses a wrong or missing one", async () => {
    process.env.MCP_TOKEN = "";
    expect((await call({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(503);
    process.env.MCP_TOKEN = TOKEN;
    expect((await call({ jsonrpc: "2.0", id: 1, method: "ping" }, "nope")).status).toBe(401);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "ping" }, null)).status).toBe(401);
    expect(GET().status).toBe(405);
  });

  it("handshakes, lists tools, and acknowledges notifications", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("daybook");
    const list = await rpc("tools/list");
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["daybook_today", "daybook_add_task", "sales_pipeline"]));
    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await rpc("nope")).error.code).toBe(-32601);
  });

  it("adds a task, shows it today, ticks it off, and logs the day", async () => {
    const added = await tool("daybook_add_task", { text: "Send invoice ~20m" });
    expect(added.isError).toBe(false);
    const { entry_id } = JSON.parse(added.text);
    const today = JSON.parse((await tool("daybook_today")).text);
    expect(today.tasks.map((t: { title: string }) => t.title)).toContain("Send invoice");
    expect((await tool("daybook_set_task_status", { entry_id, status: "done" })).isError).toBe(false);
    expect((await q<{ status: string }>("select status from day_entries where id = $1", [entry_id]))[0].status).toBe("done");

    expect((await tool("daybook_log_day", { instagram_minutes: 45, sleep_hours: 7.5, steps: 8000 })).isError).toBe(false);
    const d = JSON.parse((await tool("daybook_today")).text).day;
    expect(d).toMatchObject({ instagram_minutes: 45, sleep_minutes: 450, steps: 8000 });
  });

  it("reports bad input as a tool error the model can read", async () => {
    expect((await tool("daybook_log_day", { instagram_minutes: -3 })).isError).toBe(true);
    expect((await tool("daybook_log_day", {})).text).toMatch(/Nothing to log/);
    expect((await tool("daybook_set_task_status", { entry_id: 1, status: "exploded" })).isError).toBe(true);
    expect((await tool("daybook_today", { date: "yesterday" })).isError).toBe(true);
    expect((await rpc("tools/call", { name: "missing" })).error.code).toBe(-32602);
  });

  it("lists lead hunts and queues one to run", async () => {
    const { saveHunt } = await import("@/lib/sales/hunts");
    await q("truncate sales_hunts restart identity cascade");
    const id = await saveHunt({ name: "Via Claude", brief: "founders needing automation" });
    const list = JSON.parse((await tool("sales_hunts")).text);
    expect(list[0]).toMatchObject({ id, name: "Via Claude", schedule: "Daily at 09:00" });
    expect((await tool("sales_run_hunt", { id })).isError).toBe(false);
    expect((await tool("sales_run_hunt", { id: 99999 })).isError).toBe(true);
  });

  it("reads the sales pipeline", async () => {
    expect(Array.isArray(JSON.parse((await tool("sales_pipeline")).text))).toBe(true);
    expect((await tool("sales_deal", { id: 999 })).isError).toBe(true);
    expect(Array.isArray(JSON.parse((await tool("sales_next_moves")).text))).toBe(true);
  });
});
