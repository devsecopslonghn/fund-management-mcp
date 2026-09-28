import { McpServer } from "@modelcontextprotocol/server";
import type { Config } from "./config.js";
import { FundApiClient } from "./fund-api.js";
import { registerTools } from "./tools.js";

export function buildMcp(config: Config) {
  const mcp = new McpServer({ name: "fund-management-mcp", version: "0.1.0" });
  registerTools(mcp, new FundApiClient(config));
  return mcp;
}
