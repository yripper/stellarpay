# Demo video — shot list (~3 minutes)

Target: hackathon judges, "Agentic Payments (x402/MPP)" lane. One take per shot is fine;
record against the **live Railway deployment** (never localhost), early enough to re-shoot.
Suggested tool: QuickTime/OBS screen capture at 1080p; narrate over each shot. Total runtime
target: 3:00 (shot timings below sum to exactly that).

**Live URL placeholders.** This doc doesn't know the Railway domains yet (they're created in
a later task). Every URL below uses a token in the form `<service-domain>` —
`<dashboard-domain>`, `<express-domain>`, `<hono-domain>`, `<fastify-domain>`,
`<mcp-domain>`, `<agent-domain>` — matching the six services in the table below. **To fill
them in: grep this file for `-domain>` and replace each token with its real Railway URL**
(same placeholder style already used for `README.md:244-249`'s `<!-- filled by Plan B -->`
list and for the `<hono-domain>`/`<dashboard-domain>` tokens in the Task 14 plan text).

| service | port (local) | sells |
|---|---|---|
| dashboard | 4600 | mission-control UI: live SSE receipt feed + UNLEASH button |
| express-api | 4601 | `GET /report/:code/:issuer` $0.02 (x402); `GET /deep-dive/:account` $0.02 (mpp-charge) |
| hono-api | 4602 | `GET /alerts/whales` $0.01 (x402) |
| fastify-api | 4603 | `GET /stats/fees` $0.005 (mpp-charge) |
| mcp-server | 4604 | MCP tools: `network_status` free, `account_summary` $0.01, `asset_stats` $0.01, `whale_watch` $0.02 |
| agent | 4605 | buys across all of the above, Claude-driven with a scripted fallback |

## Shot 1 — The pitch (0:00–0:20)

Screen: repo root `README.md`, the **"Hero: three routes, three protocols, one config"**
section (`README.md:12-37`).

Say: "stellarpay is one config object that turns any Express, Hono, or Fastify route — or
any MCP tool — into a paid endpoint on Stellar. Two protocols, x402 and MPP, one SDK.
Everything you're about to see is live on testnet."

## Shot 2 — The six-line diff (0:20–0:45)

Screen: `examples/hono-api/README.md`, the fenced diff block under "The entire difference
between this API being open and being paid" (`examples/hono-api/README.md:5-17`).

Say: "This is the entire integration: six lines. No user accounts, no API keys, no billing
system — agents pay per request and settlement lands on-chain."

*Note for the operator:* the file counts a 6-line diff in its own title; the diff block
itself has 7 `+` lines (the `import` line plus 6 lines of `app.use(...)`). This is a
pre-existing off-by-one in that README (not introduced by this doc) — say "six lines" as
written since that's what's on screen, but if a judge counts along and calls it out, "close
enough — six lines of config, one import" is an honest fallback line.

## Shot 3 — A raw 402 challenge (0:45–1:10)

Screen: terminal. Run:

```bash
curl -i https://<hono-domain>/alerts/whales | head -20
```

Say: "Unpaid requests get a standard 402 with a machine-readable challenge — that's the x402
protocol. Any paying client can settle it; ours does it in one line."

**Verified locally** (`examples/hono-api`, `pnpm start` on port 4602, unpaid `GET
/alerts/whales`): a real 402 comes back with a `PAYMENT-REQUIRED` header carrying a
base64-encoded JSON challenge (`x402Version`, `resource`, `accepts: [{ scheme: "exact",
network: "stellar:testnet", amount, asset, payTo, maxTimeoutSeconds, extra }]`) — exactly
the "machine-readable challenge" the narration promises. `head -20` is enough to show the
status line and the `PAYMENT-REQUIRED` header without the terminal filling up.

## Shot 4 — Mission control + UNLEASH (1:10–2:15) — the centerpiece

Screen: the live dashboard at `https://<dashboard-domain>`. Press **▶ UNLEASH THE AGENT**.
Let narration + receipts stream in.

Say: "This button hands a funded wallet to a Claude-driven agent with a hard spend limit on
every paid HTTP call — five cents a call, twenty-five cents a run, the agent says so itself
in the first line of its narration. It's deciding what intel to buy right now: four
services, two payment protocols, including paid MCP tools bought outside that HTTP budget.
Every row is a real settlement."

Point out, as they stream in on the feed:
- The very first agent-log line of the run: **"Budget this run: $0.05 per paid HTTP call,
  $0.25 total (testnet USDC)."** (`examples/agent/src/main.ts:84`) — this is the concrete,
  on-screen backing for the "spend limit" claim above.
- A **"Settled on-chain via x402: …"** or **"Settled on-chain via mpp: …"** agent-log line
  (`examples/agent/src/main.ts:68`) as a purchase lands.

*Note for the operator:* under the demo's real default limits ($0.05/call, $0.25/run) a full
tour costs $0.085 total with a $0.02 per-item ceiling — well under both caps — so a live
**refusal** ("Spend limit refused a payment…", `main.ts:70`) will almost never actually fire
during a normal run. Don't promise a judge they'll see one; the "Budget this run: …" line is
the reliable, always-present proof that the guardrail exists and is being enforced.

## Shot 5 — On-chain proof (2:15–2:40)

Screen: click a **"settlement ↗"** link on one of the feed rows from Shot 4 → stellar.expert
transaction page.

Say: "Not a simulation — here's the transaction on Stellar testnet, fee-sponsored through
OpenZeppelin's facilitator."

*Note for the operator:* the "settlement ↗" link only renders on rows that carry a `txHash`
(`examples/dashboard/public/index.html:84-93`) — that's the **x402** legs only. On screen
those rows read `GET /report/*` (express-api) or `GET /alerts/whales` (hono-api), and show
the amber `x402` scheme badge. **mpp-charge** rows — `GET /deep-dive/*` (express-api), `GET
/stats/fees` (fastify-api), and the MCP tool names `account_summary` / `whale_watch`
(mcp-server, `examples/mcp-server/src/mcp.ts:33` maps the tool name straight into the row's
route field) — carry the cyan `mpp` badge and render `—` instead of a link; there's nothing
to click on those. Pick an amber `x402` row.

## Shot 6 — Close (2:40–3:00)

Screen: `README.md`'s **Packages** table (`README.md:111-123`) and **Links** section
(`README.md:242-249`).

Say: "Six packages, published on npm under @stellarpay: core, Express, Hono, Fastify, an
auto-paying client, and paid MCP tools — the missing monetization layer for the agent
economy, on Stellar."

*Note for the operator:* the repo ships **seven** packages total, but `@stellarpay/shared`
is deliberately private and never published (`README.md:215-221`, `PUBLISHING.md`) — only
`core`, `express`, `hono`, `fastify`, `client`, and `mcp` go to npm, so "six packages,
published" is the accurate count. **As of this doc being written, none of the six are on
npm yet** (`npm view @stellarpay/core` / `https://registry.npmjs.org/@stellarpay/core`
returns "Not found") — publishing is a manual step the repo owner runs personally per
`PUBLISHING.md`, not something any task automates. Before recording this shot, confirm the
packages are actually live (`npm view @stellarpay/core version`, or check
`https://www.npmjs.com/package/@stellarpay/core`). If they aren't published yet, swap the
line for: "Six packages, ready to publish under @stellarpay…" — don't say "published" until
it's true.

## Re-shoot checklist

- **Health-check every live service** right before recording — all six expose `/healthz`:
  ```bash
  curl -sw ' -> %{http_code}\n' -o /dev/null https://<dashboard-domain>/healthz
  curl -sw ' -> %{http_code}\n' -o /dev/null https://<express-domain>/healthz
  curl -sw ' -> %{http_code}\n' -o /dev/null https://<hono-domain>/healthz
  curl -sw ' -> %{http_code}\n' -o /dev/null https://<fastify-domain>/healthz
  curl -sw ' -> %{http_code}\n' -o /dev/null https://<mcp-domain>/healthz
  curl -sw ' -> %{http_code}\n' -o /dev/null https://<agent-domain>/healthz
  ```
  Every line should print ` -> 200`.
- Optional extra sanity check: `pnpm smoke` from the repo root (`scripts/smoke.ts`) drives one
  real x402 payment and one real mpp-charge payment against live testnet infrastructure —
  but it boots its **own** throwaway local server (port 4402 by default) to do it, so a green
  run proves the SDK's wire compatibility, not that the deployed demo services are up. Use
  the `/healthz` checks above for the actual deployment; use `pnpm smoke` only if you've
  changed SDK code since the last `pnpm test` run and want an extra live-wire check. This
  spends a small amount of real testnet USDC — don't run it more than once right before
  recording.
- Dashboard feed non-empty (the agent's boot run fires 5s after its own startup,
  `examples/agent/src/main.ts` — reflected in the agent's README "one run 5 seconds after
  boot") but not cluttered — redeploy the dashboard to clear the in-memory feed buffer if
  needed (`examples/dashboard/README.md`'s "In-memory history" section: a restart clears the
  feed and the unleash cooldown, there is no database).
- Unleash cooldown expired — the dashboard enforces a **120-second (2-minute)** cooldown
  after a press (`examples/dashboard/public/index.html:136`, `startCountdown(120)`).
- Browser zoom ~125%; hide bookmarks bar; dark OS theme (matches the dashboard's dark
  mission-control UI).
- Re-check the npm publish status for Shot 6 (see that shot's operator note above) — it can
  flip between a rehearsal and the real take.
