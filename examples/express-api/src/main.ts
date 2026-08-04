import { readEnv } from "./env.js";
import { buildApp } from "./server.js";

const env = readEnv();
buildApp(env).listen(env.port, () => {
  console.log(`stellarpay express-api (Stellar Intel) listening on :${env.port}`);
});
