// Node 22 built-in .env loader — same ENOENT-guarded pattern as the other examples.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

export type Env = {
  sppBin: string;
  sellerAccount: string;
  buyerAccount: string;
  deployment: string;
  circuitsDir: string;
  pool: string;
  tokenSecret: string;
  basePriceXlm: string;
  creditsPerLine: number;
  port: number;
  sellerUrl: string;
  dataDir: string | undefined;
  dashboardUrl: string | undefined;
  ingestSecret: string | undefined;
  sppTimeoutMs: number;
};

const REQUIRED = ["SPP_BIN", "SPP_SELLER_ACCOUNT", "SPP_DEPLOYMENT", "SPP_CIRCUITS_DIR", "SPP_POOL"] as const;

/** Reads env; on missing required vars prints their NAMES only (never values) and exits. */
export function readEnv(): Env {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(", ")} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  const port = Number(process.env["PORT"] ?? 4606);
  return {
    sppBin: process.env["SPP_BIN"] as string,
    sellerAccount: process.env["SPP_SELLER_ACCOUNT"] as string,
    buyerAccount: process.env["SPP_BUYER_ACCOUNT"] ?? "spp-buyer",
    deployment: process.env["SPP_DEPLOYMENT"] as string,
    circuitsDir: process.env["SPP_CIRCUITS_DIR"] as string,
    pool: process.env["SPP_POOL"] as string,
    // Not a secret in the demo sense — it only signs session tokens for this process's lines,
    // which die with the process anyway. Still read from env so it isn't hardcoded.
    tokenSecret: process.env["LINE_TOKEN_SECRET"] ?? "local-demo-token-secret",
    basePriceXlm: process.env["LINE_PRICE_XLM"] ?? "1",
    creditsPerLine: Number(process.env["LINE_CREDITS"] ?? 5),
    port,
    sellerUrl: process.env["SELLER_URL"] ?? `http://127.0.0.1:${port}`,
    dataDir: process.env["SPP_DATA_DIR"] || undefined,
    dashboardUrl: process.env["DASHBOARD_URL"] || undefined,
    ingestSecret: process.env["INGEST_SECRET"] || undefined,
    // Groth16 proving measured ~16s on Apple silicon but takes minutes on shared cloud vCPUs —
    // a timeout sized to local hardware silently kills the transfer mid-proof in production.
    sppTimeoutMs: Number(process.env["SPP_TIMEOUT_MS"] ?? 600_000),
  };
}
