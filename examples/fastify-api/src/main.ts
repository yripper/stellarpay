import { readEnv } from "./env.js";
import { buildApp } from "./server.js";

const env = readEnv();
const app = await buildApp(env);
await app.listen({ port: env.port, host: "0.0.0.0" }); // 0.0.0.0: Railway routes to the container IP
console.log(`stellarpay fastify-api (Stellar Intel) listening on :${env.port}`);
