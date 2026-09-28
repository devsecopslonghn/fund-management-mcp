import express, { type NextFunction, type Request, type Response } from "express";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { buildMcp } from "./mcp.js";

const config = loadConfig();

if (config.MCP_TRANSPORT === "stdio") {
  await serveStdio(() => buildMcp(config));
} else {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const authorize = (req: Request, res: Response, next: NextFunction) => {
    const expected = `Bearer ${config.MCP_BEARER_TOKEN}`;
    if (req.header("authorization") !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  const handler = toNodeHandler(
    createMcpHandler(() => buildMcp(config), { legacy: "stateless" }),
  );

  app.post("/mcp", authorize, (req, res) => {
    void handler(req, res, req.body);
  });

  app.listen(config.MCP_PORT, config.MCP_HOST, () => {
    console.error(
      `fund-management-mcp listening on http://${config.MCP_HOST}:${config.MCP_PORT}/mcp`,
    );
  });
}
