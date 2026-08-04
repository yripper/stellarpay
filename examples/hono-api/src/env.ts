// Node 22 built-in .env loader — same ENOENT-guarded pattern as scripts/smoke.ts:39-44.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

export type Env = {
  payTo: string;
  facilitatorKey: string | undefined;
  dashboardUrl: string | undefined;
  ingestSecret: string | undefined;
  port: number;
};

/** Reads env; on missing required vars prints their NAMES only (never values) and exits. */
export function readEnv(): Env {
  const required = ["DEMO_PAYTO"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(", ")} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return {
    payTo: process.env["DEMO_PAYTO"] as string,
    facilitatorKey: process.env["DEMO_FACILITATOR_KEY"] || undefined,
    dashboardUrl: process.env["DASHBOARD_URL"] || undefined,
    ingestSecret: process.env["INGEST_SECRET"] || undefined,
    port: Number(process.env["PORT"] ?? 4602),
  };
}
