import express, { type NextFunction, type Request, type Response } from "express";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { buildMcp } from "./mcp.js";
import { oauthMiddleware } from "./oauth.js";

const config = loadConfig();

if (config.MCP_TRANSPORT === "stdio") {
  await serveStdio(() => buildMcp(config));
} else {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", authMode: config.MCP_AUTH_MODE });
  });

  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    if (config.MCP_AUTH_MODE !== "oauth") {
      res.status(404).json({ error: "oauth_not_enabled" });
      return;
    }

    res.status(200).json({
      resource: config.MCP_PUBLIC_BASE_URL,
      authorization_servers: [config.OAUTH_ISSUER],
      scopes_supported: [
        "fund.read",
        "transaction.write",
        "reconciliation.write"
      ],
      resource_documentation: "https://github.com/devsecopslonghn/fund-management-mcp"
    });
  });

  const staticAuthorize = (req: Request, res: Response, next: NextFunction) => {
    const expected = `Bearer ${config.MCP_BEARER_TOKEN}`;
    if (req.header("authorization") !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  const authorize = config.MCP_AUTH_MODE === "oauth"
    ? oauthMiddleware(config)
    : staticAuthorize;

  const handler = toNodeHandler(
    createMcpHandler(() => buildMcp(config), { legacy: "stateless" }),
  );

  app.post("/mcp", authorize, (req, res) => {
    void handler(req, res, req.body);
  });

  app.listen(config.MCP_PORT, config.MCP_HOST, () => {
    console.error(
      `fund-management-mcp listening on http://${config.MCP_HOST}:${config.MCP_PORT}/mcp auth=${config.MCP_AUTH_MODE}`,
    );
  });
}
