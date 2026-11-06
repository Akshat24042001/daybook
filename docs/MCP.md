# Daybook as an MCP server

Lets Claude read your day and your sales pipeline, add tasks, tick tasks off and log your numbers.

## Turn it on

1. Make a long random token: `openssl rand -hex 32`
2. Set it as `MCP_TOKEN` where the app runs (Vercel → Project → Settings → Environment Variables), then redeploy.
   Until it is set (16+ characters) the endpoint answers 503 and does nothing.
3. In Claude: **Settings → Connectors → Add custom connector**
   - URL: `https://<your-app>/api/mcp`
   - Authentication: a header `Authorization: Bearer <your token>`

   For Claude Code: `claude mcp add --transport http daybook https://<your-app>/api/mcp --header "Authorization: Bearer <your token>"`

## What it can do

| Tool | Kind | What it does |
| --- | --- | --- |
| `daybook_today` | read | The day's tasks (status, must-do, project, estimate) and its score, steps, sleep, Instagram minutes |
| `daybook_recent_days` | read | Score, steps, sleep and Instagram minutes for the last N days |
| `daybook_add_task` | write | Add a task with quick-add syntax (`Call bank tomorrow at 11am ~15m #admin`) |
| `daybook_set_task_status` | write | Done, progressed, attempted, skipped, dropped, or back to open |
| `daybook_log_day` | write | Steps, sleep hours, Instagram minutes, day score |
| `sales_pipeline` | read | Every deal with stage, value, heat and open moves |
| `sales_deal` | read | One deal: promises on both sides and the latest interactions |
| `sales_next_moves` | read | Sales actions due in the next 48 hours |

Deliberately **not** included: sending messages to clients, moving or closing deals, deleting anything. Those stay
with you, in the app or in Telegram.

## Safety

- One bearer token, compared in constant time. Anyone with it can use the tools above, so treat it like a password.
  To rotate it, change `MCP_TOKEN` and redeploy; the old token stops working immediately.
- The endpoint is stateless and JSON-only (no sessions, no streaming). It lives at `src/app/api/mcp/route.ts`; the tools
  are in `src/lib/mcp/tools.ts`.
- Test it by hand:
  `curl -s -X POST https://<your-app>/api/mcp -H "authorization: Bearer $MCP_TOKEN" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
