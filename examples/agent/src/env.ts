// Node 22 built-in .env loader — same ENOENT-guarded pattern as scripts/smoke.ts:39-44.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

export type Env = {
  buyerSecret: string;
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  expressApiUrl: string;
  honoApiUrl: string;
  fastifyApiUrl: string;
  mcpServerUrl: string;
  dashboardUrl: string | undefined;
  ingestSecret: string;
  port: number;
};

/** Reads env; on missing required vars prints their NAMES only (never values) and exits. */
export function readEnv(): Env {
  // INGEST_SECRET is required here (it is optional on the selling services): it is both the
  // narration credential and the bearer token guarding POST /run, which spends real money.
  const required = [
    "DEMO_BUYER_SECRET",
    "INGEST_SECRET",
    "EXPRESS_API_URL",
    "HONO_API_URL",
    "FASTIFY_API_URL",
    "MCP_SERVER_URL",
  ] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(", ")} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return {
    buyerSecret: process.env["DEMO_BUYER_SECRET"] as string,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"] || undefined,
    anthropicModel: process.env["ANTHROPIC_MODEL"] || "claude-sonnet-5",
    expressApiUrl: process.env["EXPRESS_API_URL"] as string,
    honoApiUrl: process.env["HONO_API_URL"] as string,
    fastifyApiUrl: process.env["FASTIFY_API_URL"] as string,
    mcpServerUrl: process.env["MCP_SERVER_URL"] as string,
    dashboardUrl: process.env["DASHBOARD_URL"] || undefined,
    ingestSecret: process.env["INGEST_SECRET"] as string,
    port: Number(process.env["PORT"] ?? 4605),
  };
}
