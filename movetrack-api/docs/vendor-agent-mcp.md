# The per-vendor MCP agent server (`/api/agent/:companyToken/mcp`)

**W1a, issue #111.** Every moving company on Nexus has its own MCP server — a
real Model Context Protocol endpoint any AI client can talk to. The website
chat widget (issue #112) is **client #1** and this document is its contract;
Claude Desktop, ChatGPT connectors, or anything else that speaks MCP
streamable-HTTP gets the same four tools with zero extra server work.

- **Endpoint:** `POST https://{API_BASE}/api/agent/{companyToken}/mcp`
- **Protocol:** MCP streamable-HTTP, JSON-RPC 2.0, official
  `@modelcontextprotocol/sdk` server.
- **Mode:** **stateless + JSON responses.** No `Mcp-Session-Id` is ever
  issued or required, responses are plain `application/json` (never SSE),
  and `GET`/`DELETE` return 405. Every POST is self-contained.
- **Auth:** none — the company token in the path scopes everything. Being
  quotable by any AI client is the point. Unknown/inactive tokens get a
  JSON-RPC error (HTTP 404, code `-32001`) that reveals nothing.
- **CORS:** permissive (`Access-Control-Allow-Origin: *`) on this endpoint
  only — the widget runs on movers' own websites.
- **Rate limit:** 300 requests / 15 min per (companyToken, IP). A 429 comes
  back JSON-RPC-shaped: `{"jsonrpc":"2.0","error":{"code":-32000,…},"id":null}`.
- **Demo vendor:** token `demo` (`scripts/seed-demo-vendor.js`), so the
  local endpoint is `POST /api/agent/demo/mcp`.

## The browser fetch contract (for the widget, #112)

No SDK required. The widget drives the whole flow with plain `fetch`. Because
the server is stateless, `initialize` is **optional** — a bare `tools/call`
works — but spec-compliant clients (and the MCP SDK client) send it first, and
it costs one round trip, so the sequence below shows it.

Every request is the same shape:

```js
async function mcp(method, params, id = 1) {
  const res = await fetch(`${API_BASE}/api/agent/${token}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The transport negotiates content type — send BOTH accepts.
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json(); // JSON mode: always a single JSON-RPC response object
}
```

Tool results put their payload in `result.content[0].text` as a JSON string;
tool **failures** set `result.isError: true` with the honest, user-showable
message in the same place:

```js
function toolResult(rpc) {
  if (rpc.error) throw new Error(rpc.error.message);       // protocol-level
  const payload = JSON.parse(rpc.result.content[0].text);
  if (rpc.result.isError) throw Object.assign(new Error(payload.error), payload);
  return payload;
}
```

### The full conversation, as curl

`1` — *(optional)* initialize:

```bash
curl -s $BASE/api/agent/demo/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"nexus-widget","version":"1.0.0"}}}'
```

`2` — *(optional)* list the tools:

```bash
curl -s $BASE/api/agent/demo/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

`3` — who am I talking to (name + trust block + paymentsMode — render the
licensing facts with any price):

```bash
curl -s $BASE/api/agent/demo/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_company_info","arguments":{}}}'
```

`4` — the questions still worth asking (pass what the chat already knows):

```bash
curl -s $BASE/api/agent/demo/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_intake_questions","arguments":{"knownAnswers":{"bedrooms":"2"}}}}'
```

`5` — price it (this is the email gate: `customerEmail` is required):

```bash
curl -s $BASE/api/agent/demo/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"price_quote","arguments":{
        "customerEmail":"customer@example.com",
        "answers":{"bedrooms":"2","originAddress":"Oakland, CA","destinationAddress":"San Jose, CA",
                   "stairsOrigin":"1","stairsDestination":"none","parking":"right_outside",
                   "packing":"no","specialItems":"none","moveDate":"2026-10-15"}}}}'
```

`6` — reserve the date with the returned `quoteId` (simulated deposit;
vendor has 24h to confirm):

```bash
curl -s $BASE/api/agent/demo/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"reserve_booking","arguments":{
        "quoteId":"<from step 5>","requestedDate":"2026-10-15","customerEmail":"customer@example.com"}}}'
```

**No REST bridge was added**: the four fetches above *are* the widget
contract — one URL, one request shape, and the MCP transport turned out to
be plain-fetch-friendly in stateless JSON mode. If #112 finds real friction,
a thin `POST /api/agent/:companyToken/chat-step` can wrap the same service
layer later without touching this protocol.

## The tools

All logic lives in `services/quote/intakeAgentService.js`, shared verbatim
with the `/api/capture` REST routes — the MCP server and the capture link can
never disagree about a price.

### `get_company_info` — `{}`

Returns `{ name, trustBlock, paymentsMode }`. `trustBlock` is the public
consumer-protection block (legal name, CAL-T / US DOT, statutory liability +
worked example, deposit/refund rule, clock rules, regulator link).
`paymentsMode` is `'simulated'` (pretend deposits, demo) or `'none'` (no
deposit step). No contact emails, ids, or tokens — ever.

### `get_intake_questions` — `{ knownAnswers?: Record<string,string> }`

The estimator battery from `intakeQuoteEngine.buildQuestions`, minus every
question whose id appears in `knownAnswers` (string values only; junk keys
are ignored). Returns `{ questions, known }` where `known` echoes the
sanitized answers that were accepted.

### `price_quote` — `{ answers: Record<string,string>, customerEmail: string }`

Runs the deterministic engine against the vendor's newest **active** rate
card and returns the full quote payload: `quoteId`, `company.name`, crew /
hours / `lineItems` / `rangeLow` / `rangeHigh` / `nte` / `deposit` /
`status` (`quoted` | `review_required`) / `reviewReasons`, **and the
complete `trustBlock`**.

- **Trust-block invariant (identical to #108):** an incomplete block is a
  tool error (`code: "trust_block_incomplete"`) — this server never returns
  a bare price. Missing rate card ⇒ `code: "no_rate_card"`.
- **Deposit:** the engine honors `depositPct` (percent of `rangeLow`,
  rounded to whole dollars — wins when present) over flat `depositAmount`.
- **Session-less by design:** the quote persists with
  `capture_session_id = NULL` and the customer's email inside
  `inputs.customerEmail`. The guest-user pathway (users + locations +
  permissions rows) exists to receive scanned room videos, which an MCP
  conversation doesn't have, so it is deliberately **not** created here.
  The vendor still gets the "Priced lead: $X–$Y — {email}" notification.
- Raw rate cards are never exposed on any tool result — only computed quotes.

### `reserve_booking` — `{ quoteId, requestedDate: 'YYYY-MM-DD', customerEmail }`

Reserve-**pending-confirmation** against a quote from `price_quote`:

- creates a `booking_reservations` row: `status 'pending_confirmation'`,
  `expires_at = now + 24h`, `deposit_amount` = what the quote itself promised
  (`outputs.deposit.amount`, i.e. the pinned card's `depositPct`/flat value),
  `deposit_simulated = TRUE` — **no real charge exists anywhere in this
  build** and both emails say so plainly;
- emails the vendor ("Reservation to confirm: $low–$high, {date} — respond
  within 24 hours") and the customer ("Reserved pending confirmation —
  {Company} has 24 hours to confirm"); both best-effort — the row is the
  source of truth;
- a `quoteId` belonging to another company is indistinguishable from a
  missing one (`code: "quote_not_found"`).

Returns the reservation summary: `reservationId`, `status`, `requestedDate`,
`expiresAt`, `company.name`, `quote {id, rangeLow, rangeHigh, nte}`, and
`deposit {amount, simulated, note}` with the truth-in-copy note.

## The vendor's side (company portal, `authenticateCompany`)

- `GET /api/company/reservations` — pending first with `expiresInSeconds`
  countdowns, then settled history.
- `POST /api/company/reservations/:id/confirm` / `…/decline` — pending +
  unexpired only; the customer is emailed honestly either way (declines say
  "nothing was ever charged, so there is nothing to refund").

**Expiry is lazy — no cron.** Any reservation read (the list, or a
confirm/decline attempt on a stale row) flips past-due pending rows to
`'expired'` and emails each customer exactly once (the conditional
`UPDATE … WHERE status='pending_confirmation' AND expires_at <= NOW()` is
the atomic once-only latch). A vendor who never opens the dashboard delays
the flip but can never un-expire anything: confirm/decline SQL requires
`expires_at > NOW()`. When real rails land (W2), expiry is where the
automatic deposit refund hooks in.
