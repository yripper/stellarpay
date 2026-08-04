# private-api — getting paid without learning who paid you

Every other example in this repo settles **publicly**: the seller sees the buyer's `G…` address
on every receipt, and so does anyone reading the ledger. For an agent that buys market intel,
that means its research strategy is permanently on-chain.

This example fixes that. It sells the same kind of live Stellar data, but payment arrives from a
**shielded pool** — the seller can prove it was paid and still has no idea who its customer is.

```
POST /line/open   ->  "pay exactly 1.0906898 XLM to <note key>"
   (buyer pays privately, once — 14.6s including ZK proving)
GET  /line/:id    ->  { token }        seller saw the amount land in its OWN balance
GET  /intel       ->  data, 0.4s       spends one credit, nothing touches the chain
POST /line/:id/close -> refund 0.65 XLM, sent privately
```

## Why a credit line and not a payment per request

A shielded transfer costs ~15 seconds of Groth16 proving plus a Soroban fee. Paying that per
request to buy $0.01 of data is absurd. So one shielded payment opens a **line** worth N
requests; the requests themselves are answered instantly against an HMAC session token. The
expensive privacy is paid once per session and amortized.

That is the same shape as `mpp-channel` in the SDK — an on-chain event opens a session, and the
session is then spent off-chain.

## How the seller verifies a payment it cannot trace

This is the whole trick, and it is worth being precise about.

A shielded note carries **no sender**. The seller cannot ask "did buyer X pay me?" — there is no
X. So it asks a different question: **"did exactly this many stroops arrive?"**

`POST /line/open` quotes an amount with a random tag in the sub-microXLM digits —
`1.0906898`, not `1`. The tag costs the buyer at most 0.1 XLM (nothing) but makes the amount
unique among all lines currently awaiting payment. The seller then polls its **own** shielded
balance (`spp overview --json`) and credits the line whose exact amount appears.

The buyer sends the seller nothing but a line id. No proof, no signature, no address.

**Verified live on Stellar testnet:**

| Step | Time |
|---|---|
| Buyer pays `1.0906898 XLM` privately | 14.6s |
| Seller notices it in its own balance | 9.0s |
| First paid request | 2.3s |
| Second paid request | **0.4s** |
| Close + private refund of `0.6544137 XLM` | — |

Seller balance went `1.0000173 → 1.4362934`; buyer's went `3.9999827 → 3.5637066`. The seller
kept exactly the 2 credits' worth that were spent.

On Horizon, the payment transaction has **zero payment records** — just an
`invoke_host_function` with opaque XDR. No payer, no payee, no amount.

## Running it

Requires the [Stellar Private Payments](https://github.com/NethermindEth/stellar-private-payments)
`spp` CLI, built natively, plus two onboarded identities. **This example runs locally, not on
Railway** — the prover's circuit artifacts are ~43MB and the CLI is a Rust binary, which is a lot
to ship into a demo container.

```sh
cp .env.example .env      # fill in the paths to spp, the deployment file, and the circuits
pnpm start                # terminal 1: the seller
pnpm buy                  # terminal 2: the buying agent, full lifecycle
```

### The deployment file is load-bearing

Point `SPP_DEPLOYMENT` at a `deployments.json` listing **only pools whose history is still inside
the Soroban RPC's event-retention window**. The CLI syncs every enabled pool as one set, so one
pool deployed outside that window fails the whole sync with
`RPC sync gap: main RPC lacks history` — including pools that would otherwise sync perfectly.

The stock testnet deployment has this problem: two of its three pools were deployed ~11 days
before the yield pool. Trimming it to the one live pool is the difference between "nothing
works" and "syncs in 6 seconds", and it removes the need for a bootnode entirely.

## Honest limitations

- **The fee payer is still public.** The buyer's `G…` address submitted the transaction, so the
  ledger shows *that account did something with the pool* — just not with whom, or for how much.
  Routing submission through a relayer would close this.
- **The anonymity set is what makes this private**, and on testnet it is tiny. The mechanism is
  sound; the privacy is a function of how many people share the pool.
- **Balance-delta matching is a heuristic**, not a proof. It is right because amounts are unique
  per open line, but a production seller should verify the note itself rather than a delta.
- **Single process.** Lines live in memory and die with the seller, and the `spp` CLI keeps one
  SQLite wallet file, so calls are serialized. Same caveat as the SDK's in-memory replay store.
- **XLM, not USDC** — the pool's asset.
- The refund destination is supplied by the buyer at close time, since the seller cannot derive
  it. A buyer that wants to stay unlinkable should hand over a note key that is **not** the one
  registered against its public account.

## Files

| File | Purpose |
|---|---|
| `src/line.ts` | Credit lines, tagged amount quoting, HMAC tokens, pro-rata refunds. Pure. |
| `src/watcher.ts` | Polls the seller's own balance and funds lines whose amount arrived. `matchDeposits` is pure. |
| `src/spp.ts` | Typed wrapper over the `spp` CLI. Serializes calls — one wallet DB. |
| `src/server.ts` | The seller: `/line/open`, `/line/:id`, `/intel`, `/line/:id/close`. |
| `src/buyer.ts` | The buying agent — the full lifecycle, narrated. |

[Back to root README](../../README.md)
