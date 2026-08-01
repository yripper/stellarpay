# stellarpay SDK Implementation Plan (Plan A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test the publishable `@stellarpay/*` package family: a unified x402 + MPP paywall core, Express/Hono/Fastify adapters, an auto-paying agent client, and a paid-MCP-tools package.

**Architecture:** A framework-agnostic core (`stellarpay(config).handle(Request) → Response | undefined`) routes each configured route to a scheme module. Scheme modules delegate protocol mechanics to verified upstream SDKs: x402 → `@x402/core` + `@x402/stellar`; MPP → `mppx` + `@stellar/mpp`. The client probes a 402, detects the protocol from the response, enforces spend limits, then delegates payment to the matching upstream client. MCP payments are in-protocol via `mppx`'s MCP transport (challenges as `McpError -32042`).

**Tech Stack:** TypeScript 5.9 (strict, ESM, NodeNext), pnpm workspaces, vitest, zod v4. Upstream: `@x402/core` / `@x402/express` / `@x402/fetch` / `@x402/stellar` @ 2.20.0, `mppx` @ 0.8.15, `@stellar/mpp` @ 0.7.1, `@stellar/stellar-sdk` @ 15.1.0, `@openzeppelin/relayer-plugin-channels` (latest), `@modelcontextprotocol/sdk` (latest).

## Global Constraints

- Node `>=22`, pnpm `>=10`, `"type": "module"` everywhere; TS `strict: true`, `module: "NodeNext"`.
- `@stellar/stellar-sdk` pinned `15.1.0` via pnpm override (peer of `@stellar/mpp@0.7.1`; do NOT use 16.x here).
- All publishable packages: version `0.1.0`, `"publishConfig": { "access": "public" }`, scope `@stellarpay`. `packages/shared` is `"private": true` (name `@stellarpay/shared`, bundled by consumers via workspace, never published — publishable packages must NOT import it in public type signatures).
- Conventional commits (`feat:`, `test:`, `docs:`, `chore:`). **Never** add Claude attribution to commits.
- Never log or serialize secret keys (`S...` seeds, hex seeds, API keys). Zod schemas for all public config. No `any` — use `unknown` and narrow. Doc comments on all public functions.
- Testnet constants (verified against Stellar docs / installed packages): facilitator `https://channels.openzeppelin.com/x402/testnet` (mainnet: `https://channels.openzeppelin.com/x402`), RPC `https://soroban-testnet.stellar.org` (mainnet `https://soroban-rpc.mainnet.stellar.gateway.fm`), Channels API `https://channels.openzeppelin.com/testnet` (mainnet drops `/testnet`).
- Verified upstream APIs this plan relies on (do not "correct" these names): `@x402/express` → `paymentMiddlewareFromConfig`; `@x402/core/server` → `x402ResourceServer`, `x402HTTPResourceServer` (`processHTTPRequest`, `processSettlement`, `requiresPayment`, `initialize`), `HTTPFacilitatorClient`, types `HTTPAdapter`, `HTTPRequestContext { adapter, path, method, paymentHeader?, routePattern? }`, `HTTPResponseInstructions { status, headers, body?, isHtml? }`, `HTTPProcessResult` (`"no-payment-required" | "payment-verified" | "payment-error"`); `@x402/fetch` → `wrapFetchWithPayment`, `x402Client`, `x402HTTPClient`; `@x402/stellar` → `ExactStellarScheme` (separate classes from `/exact/server` and `/exact/client`), `createEd25519Signer`, `getNetworkPassphrase`, `getUsdcAddress`; `mppx/server` → `Mppx.create({ secretKey, methods })`, intents return `{ status: 402, challenge } | { status: 200, withReceipt }`, `Store.memory()`, `mppx.challenge.*` generators; `mppx/client` → `Mppx.create({ methods, polyfill, fetch, onChallenge })` returning `{ fetch, rawFetch, createCredential, onChallengeReceived, onCredentialCreated, onPaymentFailed, onPaymentResponse }`; `mppx/mcp-sdk/client` → `McpClient.wrap(client, { methods })`; `mppx/server` MCP transport via `Transport.mcpSdk()`; `@stellar/mpp` → `USDC_SAC_TESTNET`, subpaths `charge/server|client`, `channel/server|client` (`stellar`, `close`, `getChannelState`, `watchChannel`); server charge params `{ recipient, currency, decimals?, network?, rpcUrl?, feePayer?: { envelopeSigner, feeBumpSigner? }, store }`; client charge params `{ secretKey? | keypair?, mode?: 'push'|'pull', onProgress?, rpcUrl? }`; `@openzeppelin/relayer-plugin-channels` → `ChannelsClient` (`submitTransaction({ xdr })`, `submitSorobanTransaction({ func, auth })`), `PluginExecutionError` with `errorDetails?.code` (`FEE_LIMIT_EXCEEDED`, `POOL_CAPACITY`); `@modelcontextprotocol/sdk` client `StreamableHTTPClientTransport` option `fetch?: FetchLike`.
- Two field shapes are intentionally treated as opaque until the testnet smoke run confirms them: the x402 `SettleResponse`'s settled-transaction fields, and mppx's `Payment-Receipt` header payload. `Receipt.txHash`/`Receipt.payer` are optional for exactly this reason — populate defensively, never invent fields.

---

### Task 1: Monorepo scaffold + module-docs convention

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, `.npmrc`, `CLAUDE.md`, `docs/modules/README.md`, `README.md` (stub)

**Interfaces:**
- Produces: workspace layout `packages/{shared,core,express,hono,fastify,client,mcp}`; `tsconfig.base.json` all later tasks extend; root scripts `pnpm test`, `pnpm build`, `pnpm typecheck`.

- [ ] **Step 1: Write root config files**

`package.json`:
```json
{
  "name": "stellarpay-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r typecheck",
    "smoke": "tsx scripts/smoke.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.9.2",
    "vitest": "^3.0.0"
  },
  "pnpm": { "overrides": { "@stellar/stellar-sdk": "15.1.0" } }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "examples/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ["packages/*"];
```

`.gitignore`: `node_modules/`, `dist/`, `.env`, `*.log`. `.npmrc`: `access=public`.

- [ ] **Step 2: Write `CLAUDE.md` with the module-docs convention**

Copy the convention verbatim from `/Users/coderipper/Dev/grantfox/openzeppelin/CLAUDE.md` (the sibling repo — same team convention: living doc per module at `docs/modules/<module>.md`, read before modifying, update after modifying, claims cite `file:line`). Create `docs/modules/README.md` with an empty index table (`| Source path | Doc |`).

- [ ] **Step 3: Verify install and empty test run**

Run: `pnpm install && pnpm test`
Expected: install succeeds; vitest reports "No test files found" exit 0 (pass `--passWithNoTests` in root script if needed — add it to the `test` script).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo with module-docs convention"
```

---

### Task 2: `@stellarpay/shared` — network presets + price helpers

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/networks.ts`, `packages/shared/src/price.ts`
- Test: `packages/shared/test/price.test.ts`, `packages/shared/test/networks.test.ts`

**Interfaces:**
- Produces:
  - `type NetworkId = "stellar:testnet" | "stellar:pubnet"`
  - `NETWORKS: Record<NetworkId, NetworkPreset>` with `NetworkPreset = { networkId: NetworkId; facilitatorUrl: string; rpcUrl: string; horizonUrl: string; networkPassphrase: string; channelsUrl: string }`
  - `dollarToDecimal(price: string): string` — `"$0.01"` → `"0.01"`; throws `InvalidPriceError` on malformed input
  - `decimalToBaseUnits(decimal: string, decimals?: number): bigint` — `"0.01"`, 7 → `100000n`
  - `class InvalidPriceError extends Error`

- [ ] **Step 1: Package manifest**

`packages/shared/package.json`:
```json
{
  "name": "@stellarpay/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" }
}
```
`tsconfig.json` extends `../../tsconfig.base.json` with `"outDir": "dist", "rootDir": "src", "include": ["src"]`.

- [ ] **Step 2: Write failing tests**

```ts
// packages/shared/test/price.test.ts
import { describe, it, expect } from "vitest";
import { dollarToDecimal, decimalToBaseUnits, InvalidPriceError } from "../src/index.js";

describe("dollarToDecimal", () => {
  it("parses dollar strings", () => expect(dollarToDecimal("$0.01")).toBe("0.01"));
  it("parses whole dollars", () => expect(dollarToDecimal("$2")).toBe("2"));
  it("rejects missing $", () => expect(() => dollarToDecimal("0.01")).toThrow(InvalidPriceError));
  it("rejects negatives", () => expect(() => dollarToDecimal("$-1")).toThrow(InvalidPriceError));
  it("rejects zero", () => expect(() => dollarToDecimal("$0")).toThrow(InvalidPriceError));
  it("rejects garbage", () => expect(() => dollarToDecimal("$abc")).toThrow(InvalidPriceError));
});

describe("decimalToBaseUnits", () => {
  it("converts with default 7 decimals", () => expect(decimalToBaseUnits("0.01")).toBe(100_000n));
  it("converts whole numbers", () => expect(decimalToBaseUnits("1")).toBe(10_000_000n));
  it("respects custom decimals", () => expect(decimalToBaseUnits("1.5", 2)).toBe(150n));
  it("rejects excess precision", () => expect(() => decimalToBaseUnits("0.00000001", 7)).toThrow(InvalidPriceError));
});
```

```ts
// packages/shared/test/networks.test.ts
import { describe, it, expect } from "vitest";
import { NETWORKS } from "../src/index.js";

describe("NETWORKS", () => {
  it("testnet preset", () => {
    const t = NETWORKS["stellar:testnet"];
    expect(t.facilitatorUrl).toBe("https://channels.openzeppelin.com/x402/testnet");
    expect(t.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(t.channelsUrl).toBe("https://channels.openzeppelin.com/testnet");
    expect(t.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });
  it("pubnet preset", () => {
    const p = NETWORKS["stellar:pubnet"];
    expect(p.facilitatorUrl).toBe("https://channels.openzeppelin.com/x402");
    expect(p.channelsUrl).toBe("https://channels.openzeppelin.com");
    expect(p.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
  });
});
```

- [ ] **Step 3: Run tests, verify failure** — `pnpm --filter @stellarpay/shared test` → FAIL (module not found).

- [ ] **Step 4: Implement**

`src/networks.ts`: the `NetworkPreset` type and `NETWORKS` constant exactly as tested (horizon URLs: `https://horizon-testnet.stellar.org` / `https://horizon.stellar.org`; pubnet RPC `https://soroban-rpc.mainnet.stellar.gateway.fm`).

`src/price.ts`:
```ts
export class InvalidPriceError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidPriceError"; }
}

/** Parse a "$1.23" dollar string into its positive decimal part ("1.23"). */
export function dollarToDecimal(price: string): string {
  const match = /^\$(\d+(?:\.\d+)?)$/.exec(price);
  if (!match) throw new InvalidPriceError(`Invalid dollar price: ${price}`);
  const decimal = match[1]!;
  if (Number(decimal) <= 0) throw new InvalidPriceError(`Price must be positive: ${price}`);
  return decimal;
}

/** Convert a decimal amount string into token base units for the given decimals. */
export function decimalToBaseUnits(decimal: string, decimals = 7): bigint {
  const [whole = "0", frac = ""] = decimal.split(".");
  if (frac.length > decimals) throw new InvalidPriceError(`Too many decimal places for ${decimals}-decimal asset: ${decimal}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
```
`src/index.ts` re-exports both modules.

- [ ] **Step 5: Run tests, verify pass** — `pnpm --filter @stellarpay/shared test` → all PASS.

- [ ] **Step 6: Write module doc + commit**

Create `docs/modules/shared.md` (Purpose / Structure / Public surface / Gotchas: bigint math no floats; presets verified against Stellar docs 2026-07-31) and add the row to `docs/modules/README.md`.
```bash
git add -A && git commit -m "feat(shared): network presets and price helpers"
```

---

### Task 3: `@stellarpay/shared` — `submitViaChannels` (OZ Channels with fallback)

**Files:**
- Create: `packages/shared/src/channels.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/channels.test.ts`

**Interfaces:**
- Consumes: `NETWORKS` (Task 2).
- Produces: `submitViaChannels(opts: { channelsUrl: string; apiKey: string; signedXdr: string; rpcUrl: string; maxPoolRetries?: number }): Promise<string>` — returns tx hash. Internal seams for tests: `opts._client?: { submitTransaction(a: { xdr: string }): Promise<{ hash: string }> }`, `opts._directSubmit?: (xdr: string, rpcUrl: string) => Promise<string>`.

- [ ] **Step 1: Add dependency** — `pnpm --filter @stellarpay/shared add @openzeppelin/relayer-plugin-channels @stellar/stellar-sdk@15.1.0`

- [ ] **Step 2: Write failing tests**

```ts
// packages/shared/test/channels.test.ts
import { describe, it, expect, vi } from "vitest";
import { PluginExecutionError } from "@openzeppelin/relayer-plugin-channels";
import { submitViaChannels } from "../src/index.js";

const base = { channelsUrl: "https://channels.openzeppelin.com/testnet", apiKey: "k", signedXdr: "AAAA", rpcUrl: "http://rpc" };
const execError = (code: string) => Object.assign(Object.create(PluginExecutionError.prototype), { errorDetails: { code } });

describe("submitViaChannels", () => {
  it("returns hash on success", async () => {
    const client = { submitTransaction: vi.fn().mockResolvedValue({ hash: "abc" }) };
    await expect(submitViaChannels({ ...base, _client: client })).resolves.toBe("abc");
  });
  it("retries POOL_CAPACITY then succeeds", async () => {
    const client = { submitTransaction: vi.fn().mockRejectedValueOnce(execError("POOL_CAPACITY")).mockResolvedValue({ hash: "ok" }) };
    await expect(submitViaChannels({ ...base, _client: client })).resolves.toBe("ok");
    expect(client.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it("falls back to direct submit ONLY on FEE_LIMIT_EXCEEDED", async () => {
    const client = { submitTransaction: vi.fn().mockRejectedValue(execError("FEE_LIMIT_EXCEEDED")) };
    const direct = vi.fn().mockResolvedValue("direct-hash");
    await expect(submitViaChannels({ ...base, _client: client, _directSubmit: direct })).resolves.toBe("direct-hash");
    expect(direct).toHaveBeenCalledWith("AAAA", "http://rpc");
  });
  it("surfaces other errors without falling back", async () => {
    const client = { submitTransaction: vi.fn().mockRejectedValue(execError("SIMULATION_FAILED")) };
    const direct = vi.fn();
    await expect(submitViaChannels({ ...base, _client: client, _directSubmit: direct })).rejects.toBeTruthy();
    expect(direct).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run, verify FAIL** — `pnpm --filter @stellarpay/shared test channels` → FAIL.

- [ ] **Step 4: Implement**

```ts
// packages/shared/src/channels.ts
import { ChannelsClient, PluginExecutionError } from "@openzeppelin/relayer-plugin-channels";
import { Transaction, rpc } from "@stellar/stellar-sdk";

type MinimalClient = { submitTransaction(args: { xdr: string }): Promise<{ hash: string }> };

function code(e: unknown): string | undefined {
  return e instanceof PluginExecutionError ? e.errorDetails?.code : undefined;
}

async function directSubmit(xdr: string, rpcUrl: string): Promise<string> {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  // Passphrase is embedded in the signed envelope; SDK requires one to parse.
  const sent = await server.sendTransaction(new Transaction(xdr, "Test SDF Network ; September 2015"));
  if (sent.status === "ERROR") throw new Error(`Direct submit failed: ${sent.errorResult?.toXDR("base64")}`);
  return sent.hash;
}

/** Submit a signed (non-fee-bump) envelope via OZ Channels; self-pay fallback only on quota exhaustion. */
export async function submitViaChannels(opts: {
  channelsUrl: string; apiKey: string; signedXdr: string; rpcUrl: string; maxPoolRetries?: number;
  _client?: MinimalClient; _directSubmit?: (xdr: string, rpcUrl: string) => Promise<string>;
}): Promise<string> {
  const client: MinimalClient = opts._client ?? new ChannelsClient({ baseUrl: opts.channelsUrl, apiKey: opts.apiKey });
  const retries = opts.maxPoolRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return (await client.submitTransaction({ xdr: opts.signedXdr })).hash;
    } catch (e) {
      if (code(e) === "POOL_CAPACITY" && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (code(e) === "FEE_LIMIT_EXCEEDED") return (opts._directSubmit ?? directSubmit)(opts.signedXdr, opts.rpcUrl);
      throw e;
    }
  }
}
```
Note for implementer: `directSubmit`'s hardcoded testnet passphrase is a known simplification — take the passphrase from a new optional `networkPassphrase` opt defaulting to testnet, and add a unit test for it. XDR submissions to Channels must be built with `.setTimeout(30)` (callers' responsibility — document in doc comment).

- [ ] **Step 5: Run, verify PASS.** In the POOL_CAPACITY test, stub the 2 s sleep with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(2000)` so the suite stays fast.

- [ ] **Step 6: Update `docs/modules/shared.md`, commit**

```bash
git add -A && git commit -m "feat(shared): gasless submission via OZ Channels with quota fallback"
```

---

### Task 4: `@stellarpay/core` — types + config validation

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/types.ts`, `packages/core/src/config.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Consumes: `NetworkId`, `NETWORKS`, `dollarToDecimal` (shared).
- Produces (used by every later task):
```ts
export type Scheme = "x402" | "mpp-charge" | "mpp-channel";
export type PriceInput = string | { asset: string; amount: string };  // "$0.01" | explicit base units
export type RouteRule = { price: PriceInput; scheme?: Scheme; sponsorGas?: boolean; description?: string };
export type Receipt = {
  scheme: Scheme; route: string; network: NetworkId;
  amount: string; asset: string;            // decimal amount + asset contract id (or "USDC" for dollar prices)
  payer?: string; txHash?: string; raw?: string;  // raw: upstream receipt/settlement payload, opaque
  timestamp: string;                        // ISO 8601
};
export type StellarpayConfig = {
  network: NetworkId; payTo: string;
  routes: Record<string, RouteRule>;
  facilitatorUrl?: string;
  mppSecretKey?: string;                    // HMAC secret for mppx credentials (required if any mpp-* route)
  sponsorSecret?: string;                   // S... key; required if any route sets sponsorGas
  channel?: { contract: string; commitmentPublicKey: string };  // required if any mpp-channel route
  rpcUrl?: string;
  onPayment?: (receipt: Receipt) => void;
};
export type SchemeOutcome =
  | { type: "pass"; receipt?: Receipt; headers?: Record<string, string> }
  | { type: "respond"; response: Response };
export type SchemeModule = {
  scheme: Scheme;
  init?(): Promise<void>;
  handle(req: Request, match: { pattern: string; rule: RouteRule }): Promise<SchemeOutcome>;
};
export class StellarpayConfigError extends Error {}
export function parseConfig(input: unknown): StellarpayConfig;  // zod-validated, throws StellarpayConfigError
```

- [ ] **Step 1: Manifest** — like Task 2's but name `@stellarpay/core`, not private, `"publishConfig": { "access": "public" }`, `"files": ["dist"]`. Deps: `pnpm --filter @stellarpay/core add zod @stellarpay/shared@workspace:*` (note: `zod@^4`).

- [ ] **Step 2: Write failing tests**

```ts
// packages/core/test/config.test.ts
import { describe, it, expect } from "vitest";
import { parseConfig, StellarpayConfigError } from "../src/index.js";

const valid = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  routes: { "GET /a": { price: "$0.01" } },
};

describe("parseConfig", () => {
  it("accepts minimal x402 config", () => {
    const c = parseConfig(valid);
    expect(c.routes["GET /a"]!.scheme ?? "x402").toBe("x402");
  });
  it("rejects bad payTo", () => expect(() => parseConfig({ ...valid, payTo: "not-a-key" })).toThrow(StellarpayConfigError));
  it("rejects bad route key format", () =>
    expect(() => parseConfig({ ...valid, routes: { "/no-method": { price: "$1" } } })).toThrow(StellarpayConfigError));
  it("rejects malformed dollar price", () =>
    expect(() => parseConfig({ ...valid, routes: { "GET /a": { price: "0.01" } } })).toThrow(StellarpayConfigError));
  it("accepts explicit asset price", () => {
    const c = parseConfig({ ...valid, routes: { "GET /a": { price: { asset: "C".padEnd(56, "A"), amount: "10000" } } } });
    expect(typeof c.routes["GET /a"]!.price).toBe("object");
  });
  it("requires mppSecretKey when an mpp route exists", () =>
    expect(() => parseConfig({ ...valid, routes: { "GET /a": { price: "$1", scheme: "mpp-charge" } } })).toThrow(StellarpayConfigError));
  it("requires sponsorSecret when sponsorGas set", () =>
    expect(() => parseConfig({ ...valid, mppSecretKey: "s", routes: { "GET /a": { price: "$1", scheme: "mpp-charge", sponsorGas: true } } })).toThrow(StellarpayConfigError));
  it("requires channel config for mpp-channel routes", () =>
    expect(() => parseConfig({ ...valid, mppSecretKey: "s", routes: { "GET /a": { price: "$1", scheme: "mpp-channel" } } })).toThrow(StellarpayConfigError));
  it("rejects unknown scheme", () =>
    expect(() => parseConfig({ ...valid, routes: { "GET /a": { price: "$1", scheme: "stripe" } } })).toThrow(StellarpayConfigError));
});
```

- [ ] **Step 3: Run, verify FAIL.**

- [ ] **Step 4: Implement**

`src/types.ts` exactly as the Produces block. `src/config.ts`: zod schema — route keys `/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/.*$/`; `payTo` `/^[GC][A-Z2-7]{55}$/`; dollar prices validated by calling `dollarToDecimal` inside `.refine`; asset addresses `/^C[A-Z2-7]{55}$/`; `superRefine` for the three cross-field rules (mpp needs `mppSecretKey`; `sponsorGas` needs `sponsorSecret`; `mpp-channel` needs `channel`). Wrap `ZodError` into `StellarpayConfigError` with a readable message (never echo secret values back — refer to fields by name only). `src/index.ts` re-exports types + `parseConfig`.

- [ ] **Step 5: Run, verify PASS. Commit** — `feat(core): config schema and public types`

---

### Task 5: `@stellarpay/core` — route compiler & matcher

**Files:**
- Create: `packages/core/src/router.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/router.test.ts`

**Interfaces:**
- Produces: `compileRoutes(routes: Record<string, RouteRule>): CompiledRoute[]`; `matchRoute(compiled: CompiledRoute[], method: string, pathname: string): { pattern: string; rule: RouteRule } | undefined`. `CompiledRoute = { pattern: string; method: string; exact?: string; prefix?: string; rule: RouteRule }`.

- [ ] **Step 1: Failing tests**

```ts
// packages/core/test/router.test.ts
import { describe, it, expect } from "vitest";
import { compileRoutes, matchRoute } from "../src/index.js";

const rule = { price: "$0.01" } as const;
const compiled = compileRoutes({ "GET /a": rule, "GET /api/*": rule, "POST /a": rule });

describe("matchRoute", () => {
  it("matches exact method+path", () => expect(matchRoute(compiled, "GET", "/a")?.pattern).toBe("GET /a"));
  it("is method-sensitive", () => expect(matchRoute(compiled, "DELETE", "/a")).toBeUndefined());
  it("distinguishes methods on same path", () => expect(matchRoute(compiled, "POST", "/a")?.pattern).toBe("POST /a"));
  it("matches trailing wildcard", () => expect(matchRoute(compiled, "GET", "/api/deep/thing")?.pattern).toBe("GET /api/*"));
  it("wildcard does not match bare prefix parent", () => expect(matchRoute(compiled, "GET", "/api")).toBeUndefined());
  it("prefers exact over wildcard", () => {
    const c = compileRoutes({ "GET /api/*": rule, "GET /api/special": { price: "$0.05" } });
    expect(matchRoute(c, "GET", "/api/special")?.rule.price).toBe("$0.05");
  });
  it("returns undefined for unlisted", () => expect(matchRoute(compiled, "GET", "/free")).toBeUndefined());
  it("ignores query strings (caller passes pathname)", () => expect(matchRoute(compiled, "GET", "/a")).toBeTruthy());
});
```

- [ ] **Step 2: Run FAIL. Step 3: Implement** — split pattern on first space; wildcard = pattern ending `/*` → prefix match on `prefix + "/"`; sort exact-first. **Step 4: Run PASS. Step 5: Commit** — `feat(core): route compiler and matcher`

---

### Task 6: `@stellarpay/core` — `mpp-charge` scheme module

**Files:**
- Create: `packages/core/src/schemes/mppCharge.ts`
- Test: `packages/core/test/mppCharge.test.ts`

**Interfaces:**
- Consumes: types (Task 4), `NETWORKS`, `dollarToDecimal` (shared).
- Produces: `createMppChargeModule(cfg: StellarpayConfig): SchemeModule` (scheme `"mpp-charge"`).

- [ ] **Step 1: Add deps** — `pnpm --filter @stellarpay/core add mppx @stellar/mpp @stellar/stellar-sdk@15.1.0`

- [ ] **Step 2: Failing tests** — these run against the REAL mppx server engine (no network is touched when issuing challenges):

```ts
// packages/core/test/mppCharge.test.ts
import { describe, it, expect } from "vitest";
import { createMppChargeModule } from "../src/schemes/mppCharge.js";

const cfg = {
  network: "stellar:testnet" as const, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret-please-rotate",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" as const } },
};

describe("mpp-charge module", () => {
  it("responds 402 with challenge headers for unpaid request", async () => {
    const mod = createMppChargeModule(cfg);
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: cfg.routes["GET /paid"]! });
    expect(out.type).toBe("respond");
    if (out.type === "respond") {
      expect(out.response.status).toBe(402);
      // mppx serializes the challenge into response headers; at least one header must be present
      expect([...out.response.headers.keys()].length).toBeGreaterThan(0);
    }
  });
  it("converts dollar price to decimal amount for mppx", async () => {
    // challenge generator must be driven with amount "0.01", not "$0.01" — asserted via generated challenge
    const mod = createMppChargeModule(cfg);
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: { price: "$0.01", scheme: "mpp-charge" } });
    expect(out.type).toBe("respond");
  });
});
```

- [ ] **Step 3: Run FAIL. Step 4: Implement**

```ts
// packages/core/src/schemes/mppCharge.ts
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { Keypair } from "@stellar/stellar-sdk";
import { dollarToDecimal, NETWORKS } from "@stellarpay/shared";
import type { Receipt, RouteRule, SchemeModule, SchemeOutcome, StellarpayConfig } from "../types.js";

function amountFor(rule: RouteRule): { amount: string; asset: string } {
  if (typeof rule.price === "string") return { amount: dollarToDecimal(rule.price), asset: "USDC" };
  return { amount: rule.price.amount, asset: rule.price.asset };
}

/** MPP charge scheme: per-request on-chain settlement via mppx + @stellar/mpp (pull mode). */
export function createMppChargeModule(cfg: StellarpayConfig): SchemeModule {
  const mppx = Mppx.create({
    secretKey: cfg.mppSecretKey!,
    methods: [
      stellar.charge({
        recipient: cfg.payTo,
        currency: USDC_SAC_TESTNET, // explicit-asset routes override per call via amountFor
        network: cfg.network,
        rpcUrl: cfg.rpcUrl ?? NETWORKS[cfg.network].rpcUrl,
        store: Store.memory(),
        ...(cfg.sponsorSecret ? { feePayer: { envelopeSigner: Keypair.fromSecret(cfg.sponsorSecret) } } : {}),
      }),
    ],
  });

  return {
    scheme: "mpp-charge",
    async handle(req, match): Promise<SchemeOutcome> {
      const { amount, asset } = amountFor(match.rule);
      const result = await mppx.charge({ amount, description: match.rule.description ?? match.pattern })(req);
      if (result.status === 402) return { type: "respond", response: result.challenge };
      // Capture the Payment-Receipt header without hijacking the route's own response:
      const probe = result.withReceipt(new Response(null));
      const headers = Object.fromEntries(probe.headers.entries());
      const receipt: Receipt = {
        scheme: "mpp-charge", route: match.pattern, network: cfg.network,
        amount, asset, raw: headers["payment-receipt"], timestamp: new Date().toISOString(),
      };
      return { type: "pass", receipt, headers };
    },
  };
}
```
Implementer notes: (1) if `result.challenge` is not a web `Response` (mppx HTTP transport types it as the transport's challenge output), convert: it exposes `status`/`headers` — build `new Response(null, { status: 402, headers })`. (2) If `withReceipt(new Response(null))` throws `MissingReceiptResponseError` semantics differ, use `isMissingReceiptResponseError` guard and fall back to `headers: {}`. Both cases are observable in the failing test.

- [ ] **Step 5: Run PASS. Step 6: Commit** — `feat(core): mpp-charge scheme module`

---

### Task 7: `@stellarpay/core` — `x402` scheme module

**Files:**
- Create: `packages/core/src/schemes/x402.ts`, `packages/core/src/schemes/webAdapter.ts`
- Test: `packages/core/test/x402.test.ts`

**Interfaces:**
- Consumes: types (Task 4), `NETWORKS` (shared).
- Produces: `createX402Module(cfg: StellarpayConfig): SchemeModule` (scheme `"x402"`); `webAdapter(req: Request): HTTPAdapter` (internal).

- [ ] **Step 1: Add deps** — `pnpm --filter @stellarpay/core add @x402/core @x402/stellar`

- [ ] **Step 2: Failing tests** — mock the facilitator at HTTP level using `@x402/core`'s own `HTTPFacilitatorClient` pointed at a local `Response` stub:

```ts
// packages/core/test/x402.test.ts
import { describe, it, expect } from "vitest";
import { createX402Module } from "../src/schemes/x402.js";

const cfg = {
  network: "stellar:testnet" as const, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  routes: { "GET /paid": { price: "$0.01" } },
};

describe("x402 module", () => {
  it("responds 402 with PAYMENT-REQUIRED header when unpaid", async () => {
    const mod = createX402Module(cfg);
    await mod.init?.();
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: cfg.routes["GET /paid"]! });
    expect(out.type).toBe("respond");
    if (out.type === "respond") {
      expect(out.response.status).toBe(402);
      expect(out.response.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    }
  });
  it("passes through non-configured paths as internal error (module only sees matched routes)", async () => {
    const mod = createX402Module(cfg);
    await mod.init?.();
    const out = await mod.handle(new Request("http://x/paid", { method: "GET" }), { pattern: "GET /paid", rule: cfg.routes["GET /paid"]! });
    expect(out.type).toBe("respond"); // still a 402 — no payment header supplied
  });
});
```
Note: `init()` calls the facilitator's `/supported` endpoint. In tests, stub global fetch for `https://channels.openzeppelin.com/x402/testnet/*` with `vi.stubGlobal("fetch", ...)` returning the shapes from `@x402/core/schemas` (import the zod schemas and build minimal valid `SupportedResponse` objects — do not hand-craft blind JSON). If `initialize()` turns out to be lazy/optional for challenge generation, drop the stub where unneeded.

- [ ] **Step 3: Run FAIL. Step 4: Implement**

```ts
// packages/core/src/schemes/webAdapter.ts
import type { HTTPAdapter } from "@x402/core/server";

/** Adapts a web-standard Request to x402's HTTPAdapter. */
export function webAdapter(req: Request): HTTPAdapter {
  const url = new URL(req.url);
  return {
    getHeader: (name) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => url.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "*/*",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
  };
}
```

```ts
// packages/core/src/schemes/x402.ts
import { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { NETWORKS } from "@stellarpay/shared";
import { webAdapter } from "./webAdapter.js";
import type { Receipt, SchemeModule, SchemeOutcome, StellarpayConfig } from "../types.js";

function toResponse(instr: { status: number; headers: Record<string, string>; body?: unknown; isHtml?: boolean }): Response {
  const body = instr.body === undefined ? null : instr.isHtml ? String(instr.body) : JSON.stringify(instr.body);
  return new Response(body, { status: instr.status, headers: instr.headers });
}

/** x402 scheme: verification + settlement through the configured facilitator. */
export function createX402Module(cfg: StellarpayConfig): SchemeModule {
  const facilitator = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl ?? NETWORKS[cfg.network].facilitatorUrl });
  const server = new x402ResourceServer(facilitator);
  server.register(cfg.network, new ExactStellarScheme());
  const x402Routes = Object.fromEntries(
    Object.entries(cfg.routes)
      .filter(([, r]) => (r.scheme ?? "x402") === "x402")
      .map(([pattern, r]) => [pattern, { accepts: { scheme: "exact", price: r.price, network: cfg.network, payTo: cfg.payTo } }]),
  );
  const httpServer = new x402HTTPResourceServer(server, x402Routes);
  let initialized: Promise<void> | undefined;

  return {
    scheme: "x402",
    init: () => (initialized ??= httpServer.initialize()),
    async handle(req, match): Promise<SchemeOutcome> {
      await (initialized ??= httpServer.initialize());
      const adapter = webAdapter(req);
      const context = { adapter, path: new URL(req.url).pathname, method: req.method,
        paymentHeader: req.headers.get("PAYMENT-SIGNATURE") ?? undefined, routePattern: match.pattern };
      const result = await httpServer.processHTTPRequest(context);
      if (result.type === "payment-error") return { type: "respond", response: toResponse(result.response) };
      if (result.type === "no-payment-required") return { type: "pass" };
      // payment-verified → settle immediately (settle-then-serve), then let the route run
      const settle = await httpServer.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: context });
      if (!settle.success) return { type: "respond", response: toResponse(settle.response) };
      const receipt: Receipt = {
        scheme: "x402", route: match.pattern, network: cfg.network,
        amount: typeof match.rule.price === "string" ? match.rule.price.replace("$", "") : match.rule.price.amount,
        asset: typeof match.rule.price === "string" ? "USDC" : match.rule.price.asset,
        raw: JSON.stringify(settle), timestamp: new Date().toISOString(),
      };
      // Settlement tx fields are treated as opaque until the smoke run confirms them (see Global Constraints):
      const s = settle as Record<string, unknown>;
      if (typeof s["transaction"] === "string") receipt.txHash = s["transaction"];
      if (typeof s["payer"] === "string") receipt.payer = s["payer"];
      return { type: "pass", receipt, headers: settle.headers };
    },
  };
}
```
Implementer notes: `x402ResourceServer`'s scheme-registration method name must be confirmed from `@x402/core/server` typings when the compile fails — the class exposes registration used by `@x402/express`'s `SchemeRegistration` (`[{ network, server: new ExactStellarScheme() }]` in the official quickstart). If registration happens via constructor/`paymentMiddlewareFromConfig`-style array instead of a `.register()` method, mirror that; the typecheck step is the guard.

- [ ] **Step 5: Run PASS. Step 6: Commit** — `feat(core): x402 scheme module with facilitator settlement`

---

### Task 8: `@stellarpay/core` — `mpp-channel` scheme module

**Files:**
- Create: `packages/core/src/schemes/mppChannel.ts`
- Test: `packages/core/test/mppChannel.test.ts`

**Interfaces:**
- Consumes: types (Task 4).
- Produces: `createMppChannelModule(cfg: StellarpayConfig): SchemeModule` (scheme `"mpp-channel"`). Also re-exports for ops tooling: `export { close, getChannelState, watchChannel } from "@stellar/mpp/channel/server"`.

- [ ] **Step 1: Failing test** — same pattern as Task 6: module issues a 402 challenge for an unpaid request using config `channel: { contract: "C"+"A".repeat(55), commitmentPublicKey: "ab".repeat(32) }`, `mppSecretKey` set; asserts `out.type === "respond"`, status 402, headers non-empty.

```ts
// packages/core/test/mppChannel.test.ts
import { describe, it, expect } from "vitest";
import { createMppChannelModule } from "../src/schemes/mppChannel.js";

const cfg = {
  network: "stellar:testnet" as const, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  channel: { contract: "C" + "A".repeat(55), commitmentPublicKey: "ab".repeat(32) },
  routes: { "GET /tick": { price: "$0.0001", scheme: "mpp-channel" as const } },
};

describe("mpp-channel module", () => {
  it("responds 402 with voucher challenge for unpaid request", async () => {
    const mod = createMppChannelModule(cfg);
    const out = await mod.handle(new Request("http://x/tick"), { pattern: "GET /tick", rule: cfg.routes["GET /tick"]! });
    expect(out.type).toBe("respond");
    if (out.type === "respond") expect(out.response.status).toBe(402);
  });
});
```

- [ ] **Step 2: Run FAIL. Step 3: Implement** — mirror Task 6's structure with `stellar.channel(...)` from `@stellar/mpp/channel/server`:

```ts
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/channel/server";
import { StrKey } from "@stellar/stellar-sdk";
// challenge issuing: mppx.channel({ amount, description })(req) — same 402/200 result contract as charge.
// commitmentKey: StrKey.encodeEd25519PublicKey(Buffer.from(cfg.channel.commitmentPublicKey, "hex"))
// pass outcome: receipt with voucherCount unavailable per-request → omit; raw from withReceipt probe as in Task 6.
```
Full implementation follows Task 6 line-for-line except: method factory is `stellar.channel({ channel: cfg.channel!.contract, commitmentKey, store: Store.memory() })`, intent call is `mppx.channel({ amount, description })(req)`, and the receipt's `scheme` is `"mpp-channel"`. Re-export `close`, `getChannelState`, `watchChannel` from the module for Plan B's settlement script.

- [ ] **Step 4: Run PASS. Step 5: Commit** — `feat(core): mpp-channel scheme module with voucher challenges`

---

### Task 9: `@stellarpay/core` — `stellarpay()` orchestrator

**Files:**
- Create: `packages/core/src/stellarpay.ts`
- Modify: `packages/core/src/index.ts` (public exports: `stellarpay`, all types, `parseConfig`, router fns)
- Test: `packages/core/test/stellarpay.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–8.
- Produces (the package's public API, used by all adapters and examples):
```ts
export type Stellarpay = {
  handle(req: Request): Promise<Response | undefined>;                      // documented public API
  handleWithMeta(req: Request): Promise<{ response?: Response; passHeaders?: Record<string, string> }>; // adapter API
  ready(): Promise<void>;
};
export function stellarpay(config: unknown): Stellarpay;  // validates via parseConfig
```

- [ ] **Step 1: Failing tests**

```ts
// packages/core/test/stellarpay.test.ts
import { describe, it, expect, vi } from "vitest";
import { stellarpay } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /free-ish": { price: "$0.01", scheme: "mpp-charge" }, "GET /x": { price: "$0.01" } },
};

describe("stellarpay()", () => {
  it("returns undefined for unlisted routes", async () => {
    const pay = stellarpay(cfg);
    expect(await pay.handle(new Request("http://x/not-listed"))).toBeUndefined();
  });
  it("dispatches mpp-charge routes to a 402", async () => {
    const pay = stellarpay(cfg);
    const res = await pay.handle(new Request("http://x/free-ish"));
    expect(res?.status).toBe(402);
  });
  it("maps unexpected scheme errors to paywall_internal 500 without leaking", async () => {
    const pay = stellarpay(cfg);
    // force an internal error by handing a request whose URL breaks parsing downstream
    const broken = { url: "http://x/free-ish", method: "GET", headers: new Headers() } as unknown as Request;
    const res = await pay.handle(broken);
    if (res && res.status !== 402) {
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "paywall_internal" });
    }
  });
  it("emits onPayment receipts from pass outcomes", async () => {
    const onPayment = vi.fn();
    // scheme stubbed at module boundary: verified via handleWithMeta contract test below instead of chain calls
    const pay = stellarpay({ ...cfg, onPayment });
    expect(pay.handleWithMeta).toBeTypeOf("function");
  });
  it("throws StellarpayConfigError synchronously on bad config", () => {
    expect(() => stellarpay({ nope: true })).toThrow();
  });
});
```

- [ ] **Step 2: Run FAIL. Step 3: Implement**

`stellarpay()`: `parseConfig` → instantiate only the scheme modules the routes actually need → `compileRoutes`. `handleWithMeta`: match → no match: `{}`; match → try scheme `handle()`; `pass` → invoke `cfg.onPayment?.(receipt)` inside try/catch (a throwing user hook must not break the request) and return `{ passHeaders: outcome.headers }`; `respond` → `{ response }`. Catch-all: network-ish errors (facilitator/RPC unreachable — detect via `TypeError` from fetch or error `cause.code === "ECONNREFUSED"`) → `503 { error: "settlement_unavailable", retryable: true }`; anything else → `500 { error: "paywall_internal" }` and `console.error` the real error server-side only. `handle()` = `handleWithMeta` discarding `passHeaders`. `ready()` = `Promise.all(modules.map(m => m.init?.()))`.

- [ ] **Step 4: Run PASS. Step 5: Update `docs/modules/core.md` (create), add index row, commit** — `feat(core): stellarpay orchestrator with error boundaries`

---

### Task 10: `@stellarpay/express` adapter

**Files:**
- Create: `packages/express/package.json`, `packages/express/tsconfig.json`, `packages/express/src/index.ts`
- Test: `packages/express/test/express.test.ts`

**Interfaces:**
- Consumes: `stellarpay`, `Stellarpay` (core).
- Produces: `stellarpayExpress(configOrInstance: unknown | Stellarpay): RequestHandler`.

- [ ] **Step 1: Manifest + deps** — publishable manifest as Task 4; `pnpm --filter @stellarpay/express add @stellarpay/core@workspace:* && pnpm --filter @stellarpay/express add -D express @types/express supertest @types/supertest`. `express` is a **peerDependency** (`>=4`), dev-installed for tests.

- [ ] **Step 2: Failing tests**

```ts
// packages/express/test/express.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { stellarpayExpress } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

function app() {
  const a = express();
  a.use(stellarpayExpress(cfg));
  a.get("/paid", (_req, res) => { res.json({ secret: 42 }); });
  a.get("/free", (_req, res) => { res.json({ ok: true }); });
  return a;
}

describe("stellarpayExpress", () => {
  it("lets free routes through", async () => {
    const res = await request(app()).get("/free");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it("gates paid routes with 402 + challenge headers", async () => {
    const res = await request(app()).get("/paid");
    expect(res.status).toBe(402);
  });
});
```

- [ ] **Step 3: Run FAIL. Step 4: Implement**

```ts
import type { NextFunction, Request as ExReq, RequestHandler, Response as ExRes } from "express";
import { stellarpay, type Stellarpay } from "@stellarpay/core";

function toWebRequest(req: ExReq): Request {
  const proto = req.protocol || "http";
  const host = req.get("host") ?? "localhost";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  // Payment verification is header-based in both protocols — bodies intentionally omitted.
  return new Request(`${proto}://${host}${req.originalUrl}`, { method: req.method, headers });
}

async function writeResponse(res: ExRes, web: Response): Promise<void> {
  web.headers.forEach((value, key) => res.setHeader(key, value));
  res.status(web.status).send(Buffer.from(await web.arrayBuffer()));
}

/** One-line Express paywall: app.use(stellarpayExpress(config)). */
export function stellarpayExpress(configOrInstance: unknown): RequestHandler {
  const pay: Stellarpay =
    typeof configOrInstance === "object" && configOrInstance !== null && "handleWithMeta" in configOrInstance
      ? (configOrInstance as Stellarpay) : stellarpay(configOrInstance);
  return (req: ExReq, res: ExRes, next: NextFunction) => {
    void pay.handleWithMeta(toWebRequest(req)).then(async (out) => {
      if (out.response) return writeResponse(res, out.response);
      if (out.passHeaders) for (const [k, v] of Object.entries(out.passHeaders)) res.setHeader(k, v);
      next();
    }).catch(next);
  };
}
```

- [ ] **Step 5: Run PASS. Step 6: `docs/modules/express.md` + index row + commit** — `feat(express): one-line adapter`

---

### Task 11: `@stellarpay/hono` adapter

**Files:**
- Create: `packages/hono/package.json`, `packages/hono/tsconfig.json`, `packages/hono/src/index.ts`
- Test: `packages/hono/test/hono.test.ts`

**Interfaces:**
- Produces: `stellarpayHono(configOrInstance: unknown | Stellarpay): MiddlewareHandler`.

- [ ] **Step 1: Manifest + deps** — `hono` as peerDependency (`>=4`), dev-installed. `@stellarpay/core@workspace:*` dep.

- [ ] **Step 2: Failing tests** — Hono apps are testable without a listener via `app.request()`:

```ts
// packages/hono/test/hono.test.ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { stellarpayHono } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

describe("stellarpayHono", () => {
  const app = new Hono();
  app.use("*", stellarpayHono(cfg));
  app.get("/paid", (c) => c.json({ secret: 42 }));
  app.get("/free", (c) => c.json({ ok: true }));

  it("free passes", async () => expect((await app.request("http://x/free")).status).toBe(200));
  it("paid gates 402", async () => expect((await app.request("http://x/paid")).status).toBe(402));
});
```

- [ ] **Step 3: Run FAIL. Step 4: Implement** — the near-passthrough that makes the demo diff tiny:

```ts
import type { MiddlewareHandler } from "hono";
import { stellarpay, type Stellarpay } from "@stellarpay/core";

/** One-line Hono paywall: app.use("*", stellarpayHono(config)). */
export function stellarpayHono(configOrInstance: unknown): MiddlewareHandler {
  const pay: Stellarpay =
    typeof configOrInstance === "object" && configOrInstance !== null && "handleWithMeta" in configOrInstance
      ? (configOrInstance as Stellarpay) : stellarpay(configOrInstance);
  return async (c, next) => {
    const out = await pay.handleWithMeta(c.req.raw);
    if (out.response) return out.response;
    await next();
    if (out.passHeaders) for (const [k, v] of Object.entries(out.passHeaders)) c.res.headers.set(k, v);
  };
}
```

- [ ] **Step 5: Run PASS. Step 6: `docs/modules/hono.md` + commit** — `feat(hono): one-line adapter`

---

### Task 12: `@stellarpay/fastify` adapter

**Files:**
- Create: `packages/fastify/package.json`, `packages/fastify/tsconfig.json`, `packages/fastify/src/index.ts`
- Test: `packages/fastify/test/fastify.test.ts`

**Interfaces:**
- Produces: `stellarpayFastify: (fastify: FastifyInstance, opts: { config: unknown | Stellarpay }) => Promise<void>` — registered via `fastify.register(stellarpayFastify, { config })`, gates via an `onRequest` hook.

- [ ] **Step 1: Manifest + deps** — `fastify` peerDependency (`>=4`), dev-installed; `@stellarpay/core@workspace:*`.

- [ ] **Step 2: Failing tests** — use `fastify.inject()`:

```ts
// packages/fastify/test/fastify.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { stellarpayFastify } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

describe("stellarpayFastify", () => {
  it("gates and passes appropriately", async () => {
    const app = Fastify();
    await app.register(stellarpayFastify, { config: cfg });
    app.get("/paid", async () => ({ secret: 42 }));
    app.get("/free", async () => ({ ok: true }));
    expect((await app.inject({ method: "GET", url: "/free" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/paid" })).statusCode).toBe(402);
  });
});
```

- [ ] **Step 3: Run FAIL. Step 4: Implement** — plain async plugin function (no `fastify-plugin` dep; document that registering at root applies it app-wide). `onRequest` hook: build web `Request` from `req.raw` (`method`, `req.headers`, `req.protocol + req.hostname + req.url`), call `handleWithMeta`; on `response` → `reply.code(...).headers(...).send(body)`; on pass headers → `reply.headers(out.passHeaders)`.

- [ ] **Step 5: Run PASS. Step 6: `docs/modules/fastify.md` + commit** — `feat(fastify): adapter plugin`

---

### Task 13: `@stellarpay/client` — probe, detection, limits, x402 leg

**Files:**
- Create: `packages/client/package.json`, `packages/client/tsconfig.json`, `packages/client/src/index.ts`, `packages/client/src/detect.ts`, `packages/client/src/limits.ts`, `packages/client/src/events.ts`, `packages/client/src/x402Leg.ts`
- Test: `packages/client/test/detect.test.ts`, `packages/client/test/limits.test.ts`

**Interfaces:**
- Consumes: `dollarToDecimal`, `decimalToBaseUnits` (shared).
- Produces:
```ts
export type PayEvent =
  | { type: "challenge"; protocol: "x402" | "mpp"; url: string }
  | { type: "paying"; protocol: "x402" | "mpp"; url: string }
  | { type: "paid"; protocol: "x402" | "mpp"; url: string }
  | { type: "blocked"; reason: "per-call-limit" | "total-limit" | "unparseable-amount"; url: string }
  | { type: "error"; message: string; url: string };
export class SpendLimitExceeded extends Error {}
export class UnsupportedChallenge extends Error {}
export type PayingFetchConfig = {
  secret?: string; keypair?: unknown;               // one required (Keypair narrowed internally)
  network: "stellar:testnet" | "stellar:pubnet";
  limits?: { maxPerCall?: string; maxTotal?: string; allowUnknownAmount?: boolean };  // "$0.05" strings
  onEvent?: (e: PayEvent) => void;
  rpcUrl?: string;
};
export function createPayingFetch(config: PayingFetchConfig): typeof fetch;
// internals for Task 14 to consume:
export function detectProtocol(res: Response): "x402" | "mpp" | undefined;  // (src/detect.ts)
export class SpendTracker { checkAndReserve(baseUnits: bigint | undefined, url: string): void }  // (src/limits.ts) throws SpendLimitExceeded / emits blocked
```

- [ ] **Step 1: Manifest + deps** — publishable; `pnpm --filter @stellarpay/client add @x402/fetch @x402/stellar @x402/core mppx @stellar/mpp @stellar/stellar-sdk@15.1.0 @stellarpay/shared@workspace:*` (shared stays out of public signatures).

- [ ] **Step 2: Failing tests**

```ts
// packages/client/test/detect.test.ts
import { describe, it, expect } from "vitest";
import { detectProtocol } from "../src/detect.js";

describe("detectProtocol", () => {
  it("x402 when PAYMENT-REQUIRED header present", () => {
    const res = new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": "eyJ4NDAyIjp7fX0=" } });
    expect(detectProtocol(res)).toBe("x402");
  });
  it("mpp for other 402s", () => {
    expect(detectProtocol(new Response(null, { status: 402, headers: { "accept-payment": "..." } }))).toBe("mpp");
  });
  it("undefined for non-402", () => {
    expect(detectProtocol(new Response(null, { status: 200 }))).toBeUndefined();
  });
});
```

```ts
// packages/client/test/limits.test.ts
import { describe, it, expect, vi } from "vitest";
import { SpendTracker } from "../src/limits.js";
import { SpendLimitExceeded } from "../src/index.js";

describe("SpendTracker", () => {
  it("allows under per-call limit", () => {
    const t = new SpendTracker({ maxPerCall: "$0.05" }, vi.fn());
    expect(() => t.checkAndReserve(100_000n, "http://x")).not.toThrow(); // $0.01
  });
  it("blocks over per-call limit", () => {
    const t = new SpendTracker({ maxPerCall: "$0.05" }, vi.fn());
    expect(() => t.checkAndReserve(1_000_000n, "http://x")).toThrow(SpendLimitExceeded); // $0.10
  });
  it("blocks when cumulative total exceeded", () => {
    const t = new SpendTracker({ maxTotal: "$0.02" }, vi.fn());
    t.checkAndReserve(100_000n, "http://x"); // $0.01 ok
    t.checkAndReserve(100_000n, "http://x"); // $0.02 ok (reaches cap exactly)
    expect(() => t.checkAndReserve(1n, "http://x")).toThrow(SpendLimitExceeded);
  });
  it("blocks unknown amounts by default, allows with allowUnknownAmount", () => {
    const events = vi.fn();
    const strict = new SpendTracker({ maxPerCall: "$1" }, events);
    expect(() => strict.checkAndReserve(undefined, "http://x")).toThrow(SpendLimitExceeded);
    const lax = new SpendTracker({ maxPerCall: "$1", allowUnknownAmount: true }, events);
    expect(() => lax.checkAndReserve(undefined, "http://x")).not.toThrow();
  });
  it("no limits configured → everything passes", () => {
    const t = new SpendTracker({}, vi.fn());
    expect(() => t.checkAndReserve(10n ** 12n, "http://x")).not.toThrow();
  });
});
```

- [ ] **Step 3: Run FAIL. Step 4: Implement**

`detect.ts`: status !== 402 → undefined; `PAYMENT-REQUIRED` header present → `"x402"`; else `"mpp"`. `limits.ts`: `SpendTracker` holds base-unit bigints derived via `dollarToDecimal`+`decimalToBaseUnits`; unknown amount → throw unless `allowUnknownAmount`, emitting `{ type: "blocked", reason: ... }` via the injected emitter before throwing. `events.ts`: tiny `Emitter` wrapping `onEvent` in try/catch. `x402Leg.ts`:

```ts
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

/** Builds the x402-paying fetch used after our outer probe confirms an x402 challenge. */
export function buildX402Fetch(raw: typeof fetch, opts: { secret: string; network: string; rpcUrl?: string }): typeof fetch {
  const signer = createEd25519Signer(opts.secret);
  const client = new x402Client();
  client.register(opts.network, new ExactStellarScheme(signer, opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : undefined));
  return wrapFetchWithPayment(raw, client);
}
```
Implementer note: `x402Client` registration method name — same guard as Task 7: if the API is constructor-config (`x402ClientConfig` with `SchemeRegistration[]`), adapt; typecheck catches it. The x402 amount for limit-checking is parsed in `index.ts` from the probe's `PAYMENT-REQUIRED` header: base64 → JSON → `accepts[0].amount` (+`asset`), guarded — unparseable → `SpendTracker` unknown-amount path. `createPayingFetch` in `index.ts` (partial in this task): probe with raw fetch → non-402 → return as-is; x402 → limit-check → replay the request via `buildX402Fetch` (accepted cost: the paying fetch re-probes, one extra request) → emit events. MPP branch throws `UnsupportedChallenge("mpp leg lands in Task 14")` for now.

- [ ] **Step 5: Run PASS. Step 6: Commit** — `feat(client): protocol detection, spend limits, x402 leg`

---

### Task 14: `@stellarpay/client` — MPP leg + unified `createPayingFetch`

**Files:**
- Create: `packages/client/src/mppLeg.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/test/payingFetch.test.ts`

**Interfaces:**
- Consumes: Task 13 internals; `mppx/client`, `@stellar/mpp/charge/client`, `@stellar/mpp/channel/client`.
- Produces: completed `createPayingFetch(config): typeof fetch` — full contract from Task 13's Produces block.

- [ ] **Step 1: Failing tests** — challenges generated by a REAL stellarpay server in-process (no fabricated shapes):

```ts
// packages/client/test/payingFetch.test.ts
import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { stellarpay } from "@stellarpay/core";
import { createPayingFetch, SpendLimitExceeded } from "../src/index.js";

const server = stellarpay({
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
});
// serve stellarpay core directly as a fetch endpoint — no HTTP listener needed
const serverFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  return (await server.handle(req)) ?? new Response(JSON.stringify({ secret: 42 }), { status: 200 });
};

describe("createPayingFetch (MPP leg)", () => {
  it("surfaces the 402 challenge to the MPP handler and emits events", async () => {
    const events: string[] = [];
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      onEvent: (e) => events.push(e.type),
      _baseFetch: serverFetch,   // test seam: injected transport
      _dryRun: true,             // stop before on-chain signing/broadcast; assert challenge handling only
    } as never);
    await payFetch("http://svc/paid").catch(() => undefined);
    expect(events).toContain("challenge");
  });
  it("enforces total limit before any signing", async () => {
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      limits: { maxTotal: "$0.001" },
      _baseFetch: serverFetch, _dryRun: true,
    } as never);
    await expect(payFetch("http://svc/paid")).rejects.toThrow(SpendLimitExceeded);
  });
  it("returns non-402 responses untouched", async () => {
    const payFetch = createPayingFetch({ keypair: Keypair.random(), network: "stellar:testnet", _baseFetch: serverFetch } as never);
    const res = await payFetch("http://svc/free");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run FAIL. Step 3: Implement**

`mppLeg.ts`: `Mppx.create({ polyfill: false, fetch: baseFetch, methods: [chargeClient.stellar({ keypair, mode: "pull", rpcUrl }), channelClient.stellar(...)? — channel client only when config provides a commitment secret; add optional `channelCommitmentSecret` to `PayingFetchConfig`], onChallenge })` where `onChallenge(challenge, helpers)` is the limits gate: extract the amount from the challenge object defensively (known candidates checked in order, else `undefined` → SpendTracker unknown-amount path), run `checkAndReserve`, emit `paying`, then `return helpers.createCredential()`; wire `onChallengeReceived` → emit `challenge`, `onCredentialCreated` → `paid`, `onPaymentFailed` → `error`. `_dryRun` (test seam, undocumented): `onChallenge` returns `undefined` after the limit gate instead of creating a credential — mppx then surfaces the 402; the thrown/402 result proves gating ran without touching RPC. Unified `index.ts`: probe via `_baseFetch ?? fetch`; 402 + x402 → Task 13 path; 402 + mpp → delegate the ORIGINAAL request through the mpp-leg `mppxClient.fetch` (it re-probes and pays); emit events throughout; never log `secret`.

- [ ] **Step 4: Run PASS. Step 5: `docs/modules/client.md` + commit** — `feat(client): unified auto-paying fetch for x402 and MPP`

---

### Task 15: `@stellarpay/mcp` — paid tools (server guard + paying client)

**Files:**
- Create: `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/src/index.ts`, `packages/mcp/src/server.ts`, `packages/mcp/src/client.ts`
- Test: `packages/mcp/test/mcp.test.ts`

**Interfaces:**
- Consumes: shared price helpers; `mppx/server` + `Transport.mcpSdk()`; `mppx/mcp-sdk/client` `McpClient.wrap`; `@stellar/mpp/charge/{server,client}`.
- Produces:
```ts
// server side
export function toolPayments(config: {
  recipient: string; network: "stellar:testnet" | "stellar:pubnet";
  mppSecretKey: string; sponsorSecret?: string; rpcUrl?: string;
  prices: Record<string, string>;                      // toolName → "$0.02"
  onPayment?: (receipt: { tool: string; amount: string; raw?: string; timestamp: string }) => void;
}): { guard<A, R>(toolName: string, handler: (args: A, extra: unknown) => Promise<R>): (args: A, extra: unknown) => Promise<R>;
      priceOf(toolName: string): string | undefined };
// client side
export function wrapPaidMcpClient<C extends { callTool: Function }>(client: C, opts: { secret: string; network: string; rpcUrl?: string }): C;
```

- [ ] **Step 1: Manifest + deps** — publishable; `pnpm --filter @stellarpay/mcp add mppx @stellar/mpp @stellar/stellar-sdk@15.1.0 @stellarpay/shared@workspace:* && pnpm --filter @stellarpay/mcp add -D @modelcontextprotocol/sdk` (`@modelcontextprotocol/sdk` is a peerDependency).

- [ ] **Step 2: Failing tests**

```ts
// packages/mcp/test/mcp.test.ts
import { describe, it, expect, vi } from "vitest";
import { toolPayments } from "../src/index.js";

const payments = toolPayments({
  recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  network: "stellar:testnet", mppSecretKey: "test-secret",
  prices: { deep_report: "$0.02" },
});

describe("toolPayments.guard", () => {
  it("throws an MCP payment-required error (-32042) for unpaid priced tool calls", async () => {
    const guarded = payments.guard("deep_report", async () => ({ content: [] }));
    await expect(guarded({}, { _meta: {} })).rejects.toMatchObject({ code: -32042 });
  });
  it("passes through tools without a configured price", async () => {
    const handler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "free" }] });
    const guarded = payments.guard("health_check", handler);
    await expect(guarded({}, { _meta: {} })).resolves.toBeTruthy();
    expect(handler).toHaveBeenCalled();
  });
  it("priceOf reports configured prices", () => {
    expect(payments.priceOf("deep_report")).toBe("$0.02");
    expect(payments.priceOf("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run FAIL. Step 4: Implement**

`server.ts` — follows the verified upstream pattern (mppx `Transport.mcpSdk()` doc example):
```ts
import { Mppx, Store, Transport } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { Keypair } from "@stellar/stellar-sdk";
import { dollarToDecimal } from "@stellarpay/shared";

export function toolPayments(config: ToolPaymentsConfig) {
  const payment = Mppx.create({
    secretKey: config.mppSecretKey,
    transport: Transport.mcpSdk(),
    methods: [stellar.charge({
      recipient: config.recipient, currency: USDC_SAC_TESTNET, network: config.network,
      rpcUrl: config.rpcUrl, store: Store.memory(),
      ...(config.sponsorSecret ? { feePayer: { envelopeSigner: Keypair.fromSecret(config.sponsorSecret) } } : {}),
    })],
  });
  return {
    priceOf: (tool: string) => config.prices[tool],
    guard(toolName, handler) {
      const price = config.prices[toolName];
      if (!price) return handler;                          // unpriced tools bypass entirely
      const amount = dollarToDecimal(price);
      return async (args, extra) => {
        const result = await payment.charge({ amount, description: `MCP tool: ${toolName}` })(extra);
        if (result.status === 402) throw result.challenge; // McpError code -32042, challenge in error.data
        config.onPayment?.({ tool: toolName, amount, timestamp: new Date().toISOString() });
        return result.withReceipt(await handler(args, extra));
      };
    },
  };
}
```
`client.ts`: `McpClient.wrap(client, { methods: [stellarChargeClient({ secretKey: opts.secret, mode: "pull", rpcUrl: opts.rpcUrl })] })` re-exported as `wrapPaidMcpClient`. Also export a convenience `payingHttpTransport(url: string, payFetch: typeof fetch)` returning `new StreamableHTTPClientTransport(new URL(url), { fetch: payFetch })` for HTTP-level (x402-gated) MCP servers — verified `fetch?: FetchLike` option.

- [ ] **Step 5: Run PASS. Step 6: `docs/modules/mcp.md` + commit** — `feat(mcp): per-tool payments guard and paying MCP client`

---

### Task 16: Cross-package integration test

**Files:**
- Create: `packages/core/test/integration.x402-loop.test.ts`

**Interfaces:** consumes everything; produces confidence.

- [ ] **Step 1: Write the test** — full x402 402→pay→retry loop with a mocked facilitator, real core + real client:

```ts
// packages/core/test/integration.x402-loop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stellarpay } from "../src/index.js";

// Facilitator mock: intercept global fetch calls targeting the facilitator URL only.
// Build /supported, /verify, /settle response bodies by importing the response zod
// schemas from @x402/core/schemas and constructing minimal objects that PARSE —
// never hand-craft blind JSON. /verify → valid; /settle → success with a fake hash.

describe("x402 end-to-end (mocked settlement)", () => {
  it("unpaid → 402 challenge; header-carrying retry → verified, settled, passed", async () => {
    const onPayment = vi.fn();
    const pay = stellarpay({
      network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      routes: { "GET /paid": { price: "$0.01" } }, onPayment,
    });
    const first = await pay.handle(new Request("http://svc/paid"));
    expect(first?.status).toBe(402);
    const header = first!.headers.get("PAYMENT-REQUIRED")!;
    expect(header).toBeTruthy();
    // Build a syntactically valid PAYMENT-SIGNATURE using @x402/stellar's client scheme
    // against the challenge (signer = random keypair; the mocked facilitator accepts it).
    // Assert: handle() returns undefined (pass) and onPayment fired with a Receipt
    // whose scheme === "x402" and route === "GET /paid".
  });
});
```
The comment blocks above are the actual work items of this task — implement them concretely; the schemas import makes the mock robust against upstream validation.

- [ ] **Step 2: Run, iterate until PASS.** This test is the checkpoint that catches any misread upstream API from Tasks 7/13 — budget real time for it.

- [ ] **Step 3: Commit** — `test(core): x402 end-to-end loop with mocked facilitator`

---

### Task 17: Testnet smoke script

**Files:**
- Create: `scripts/smoke.ts`, `.env.example`

**Interfaces:** consumes `stellarpay` (core), `createPayingFetch` (client).

- [ ] **Step 1: Write `.env.example`**

```
# Buyer identity — must hold testnet XLM (friendbot) and testnet USDC (trustline + faucet)
SMOKE_BUYER_SECRET=S...
# Seller/recipient public key
SMOKE_PAYTO=G...
# Server-side secrets
SMOKE_MPP_SECRET=change-me
# Optional: sponsor account secret for mpp sponsored-gas leg
SMOKE_SPONSOR_SECRET=
```

- [ ] **Step 2: Write `scripts/smoke.ts`** — boots a real `Hono` app with `stellarpayHono` on `localhost:4402` with two routes (`GET /x402` at `$0.001` x402; `GET /mpp` at `$0.001` mpp-charge, sponsored if `SMOKE_SPONSOR_SECRET` set), then runs `createPayingFetch` against both, printing each `PayEvent` and the final bodies + receipts (tx hashes when present). Exit non-zero if either leg fails. Refuses to run when env vars are missing, with instructions (friendbot URL, trustline how-to, USDC faucet note).

- [ ] **Step 3: Run against real testnet** — `pnpm smoke`. Expected: both legs print `challenge → paying → paid` and a 200 body. Record the confirmed shapes of the x402 `SettleResponse` fields and the mppx `Payment-Receipt` header; update the two defensive parsers (Task 6/7) and `docs/modules/core.md` with the confirmed shapes.

- [ ] **Step 4: Commit** — `feat: testnet smoke script for x402 and mpp legs`

---

### Task 18: READMEs, PUBLISHING.md, ROADMAP.md

**Files:**
- Create: `PUBLISHING.md`, `docs/ROADMAP.md`, `packages/*/README.md` (6 files), rewrite root `README.md`

- [ ] **Step 1: Root README** — hero snippet (Task 4's config example), the "what exists vs. ours" landscape table from the spec §1, mermaid architecture diagram (core + scheme modules + adapters + client + mcp), quickstart (install → config → adapter one-liner → `createPayingFetch` loop), links section left with placeholders ONLY for the Plan B demo URLs (marked `<!-- filled by Plan B -->`).

- [ ] **Step 2: Per-package READMEs** — each: one-paragraph purpose, install command, the minimal working snippet (taken from that package's tests — snippets must be copy-paste runnable), API table, link back to root.

- [ ] **Step 3: `PUBLISHING.md`** — exact user-run steps:
```
1. npm login
2. Create the org once: npm org (or https://www.npmjs.com/org/create) → name: stellarpay
3. pnpm build && pnpm test && pnpm smoke
4. pnpm -r publish --access public --dry-run   # review the file lists
5. pnpm -r publish --access public
```

- [ ] **Step 4: `docs/ROADMAP.md`** — the four §8 spec items verbatim: mpp-channel hosted feed demo (weekend attempt); **agent treasury with policy signers** (smart-account-kit; in-policy payment succeeds, out-of-policy refused on-chain) — attempt only if time before Wednesday 2026-08-05; Redis Store adapter; mainnet preset hardening.

- [ ] **Step 5: Verify all module docs exist** (`shared`, `core`, `express`, `hono`, `fastify`, `client`, `mcp` + index rows), run full suite: `pnpm typecheck && pnpm test`. Commit — `docs: package READMEs, publishing guide, roadmap`

---

## Self-Review (performed at authoring time)

- **Spec coverage:** §1–§6 → Tasks 1–15; §9 error handling → Tasks 3, 9, 13; §10 testing → per-task TDD + Tasks 16–17; §11 docs/publishing → Task 18 + per-task module docs; §8 roadmap → Task 18. §7 (demos/hosting) is deliberately Plan B. Spec deviations (approved separately): MCP payments are in-protocol MPP (mppx `mcpSdk` transport) rather than HTTP-level x402, and the paying MCP helper lives in `@stellarpay/mcp` rather than `@stellarpay/client`.
- **Placeholder scan:** the two "opaque until smoke" shapes (x402 settle fields, `Payment-Receipt` payload) are explicit risk-managed decisions with defensive code and a confirmation step in Task 17 — not TBDs. Task 16's comment blocks name their concrete work items.
- **Type consistency:** `handleWithMeta`/`passHeaders` (Tasks 9–12), `SchemeOutcome`/`Receipt` (Tasks 4, 6, 7, 8), `SpendTracker.checkAndReserve` (Tasks 13–14), `toolPayments().guard/priceOf` (Task 15) — names checked consistent across tasks.
