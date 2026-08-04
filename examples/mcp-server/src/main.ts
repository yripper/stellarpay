import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readEnv } from "./env.js";
import { createReceiptReporter } from "./reportReceipt.js";
import { buildMcpServer, buildPayments, PRICES } from "./mcp.js";

const env = readEnv();
const report = createReceiptReporter({ service: "mcp-server", dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });
const payments = buildPayments(env, report); // once per process — replay store must persist

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Stellar Intel MCP",
    endpoint: "POST /mcp (MCP streamable HTTP)",
    tools: { network_status: "free", ...PRICES },
    hint: "connect with any MCP client; pay tool charges with @stellarpay-sdk/client + @stellarpay-sdk/mcp.",
  });
});
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Stateless streamable HTTP: fresh server+transport per request, torn down on close —
 * the documented sessionless pattern (@modelcontextprotocol/sdk streamableHttp.d.ts:36-44).
 * `payments` is deliberately NOT rebuilt here (see `buildPayments`' doc comment).
 *
 * The handler is registered synchronously and does its own `try/catch`, never as a bare
 * `async` handler: Express 4 does not catch rejections from `async` handlers, so a transport
 * or Horizon failure would escape as an unhandled rejection and terminate the process under
 * Node 22's default `--unhandled-rejections=throw`. Same load-bearing adapter as
 * `examples/express-api/src/server.ts:51-64`.
 */
app.post("/mcp", (req, res) => {
  void (async () => {
    const server = buildMcpServer(payments);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      // `.catch` rather than a bare `void`: a rejected close() is itself an unhandled
      // rejection, and this fires outside the try/catch below.
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      // Logged server-side only; the body never echoes the upstream error.
      console.error("[mcp-server] /mcp request failed", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  })();
});

app.listen(env.port, () => {
  console.log(`stellarpay mcp-server (Stellar Intel MCP) listening on :${env.port}`);
});
