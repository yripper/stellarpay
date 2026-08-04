import { serve } from "@hono/node-server";
import { readEnv } from "./env.js";
import { buildApp } from "./server.js";

const env = readEnv();
const app = buildApp(env);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`stellarpay hono-api (Stellar Intel) listening on :${info.port}`);
});
