import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { buildApp } from "./server.js";

// Node 22 built-in .env loader — same ENOENT-guarded pattern as scripts/smoke.ts:39-44.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

const ingestSecret = process.env["INGEST_SECRET"];
if (!ingestSecret) {
  console.error("Missing required env var: INGEST_SECRET (see .env.example)");
  process.exit(1);
}

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const port = Number(process.env["PORT"] ?? 4600);
const app = buildApp({ ingestSecret, agentUrl: process.env["AGENT_URL"] || undefined, html });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`stellarpay dashboard listening on :${info.port}`);
});
