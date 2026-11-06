# Sales audit (November 2026)

Scope: every public entry point of Sales (the proposal page, accept/changes form, tracked links and files, one-tap
"go" links, the capture endpoint, the Google push), the state machine around quotes, and the AI-driven paths.
Method: read the code path by path, then wrote a failing test for each bug before fixing it (`tests/sales.test.ts`,
"quote acceptance guards").

## Fixed in this change

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | **High** | `/q/<slug>?rev=N` served **any** revision to anyone with the link, including drafts you had not sent (prices, scope, internal notes). The page also showed the current draft when nothing had been sent yet. | Clients only ever get revisions with `sent_at`. Unsent quotes 404 for them. You (signed in) can still preview drafts. |
| 2 | **High** | Accepting a quote always accepted `current_rev`, not the version on the client's screen. Client views v1 at 4,000, you edit v2 at 6,000, client clicks Accept: the deal is recorded Won at the number they never saw. Drafts and expired proposals could also be accepted. | The form carries the revision it showed. Accept uses the latest **sent** revision and refuses a stale page ("a newer version exists"), an unsent proposal, and an expired one. |
| 3 | **High** | `requestChanges` on an already **accepted** proposal flipped its status back to `changes`, hiding a signed deal. | Refused once accepted. |
| 4 | **Medium** | Accept was check-then-write: two clicks (or two tabs) both passed the `accepted_at` check and created the payment plan and the Telegram/phone alerts twice. | Atomic `update ... where accepted_at is null returning`. Only the winner proceeds. |
| 5 | **High** (if the env is incomplete) | Signed links (`go`, view beacons) fell back to a secret built from `ADMIN_PASSWORD` or the literal string `dev`, so anyone could forge them when `AUTH_SECRET` and `CRON_SECRET` were both missing. | In production it now refuses to sign without a real secret. The dev fallback remains for local work. |
| 6 | **Low** | The capture endpoint accepted unlimited image sizes. | Each image capped at about 4 MB, four per request. |

## Checked and fine

- **XSS**: briefs and quotes pass through `mdToHtml`, which escapes first and only re-adds links with `https?://`. No attribute injection path.
- **Secrets**: capture token and Google secret are compared in constant time and generated per database. Webhooks return 403, not data.
- **Client page**: your own visits (session cookie) and bots never count as client views; the beacon is signed per view.
- **Files**: tracked downloads redirect to a 10-minute signed URL; the file is never public.
- **Stage automation**: the AI proposes "Sounds like a yes. Mark as Won?" and waits; only the client's Accept and recorded payments move a deal to Won/Paid.
- **Test suite**: 336 tests pass against a real Postgres, including 8 new ones for the fixes above, drag-and-drop ordering, Instagram time and the MCP server.

## Open, not changed (your call)

1. **No rate limit on public endpoints** (`/q`, `/l`, `/api/sales/respond`). Someone with a link can spam yourself with Telegram pings. Cheapest fix: a per-slug cooldown on pings. Low risk, since slugs are unguessable.
2. **"Go" links never expire** and can be replayed to re-log a send. Idempotent per move, so the harm is limited to a stray "sent" entry. Could add an expiry to the signature.
3. **Preview detection is a user-agent guess.** iMessage, Signal and Discord previews are not all in the list, so a preview can count as a tap or an open. Move-level `external_id` stops double logging; the noise is cosmetic.
4. **The capture token can be sent in the URL query** (needed for the share-sheet shortcut). It then appears in server logs. Prefer the header or body form where the client allows it.
5. **`/api/sales/file/<slug>`** hands out the file for any document with an attachment, regardless of status. Fine today; worth gating on "sent" if you attach internal files later.
