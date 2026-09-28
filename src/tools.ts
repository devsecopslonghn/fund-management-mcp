import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { FundApiClient } from "./fund-api.js";

const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
});

export function registerTools(server: McpServer, api: FundApiClient): void {
  server.registerTool("get_fund_summary", {
    title: "Get fund summary",
    description: "Read the current fund dashboard summary.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => text(await api.statistics()));

  server.registerTool("get_ingestion_health", {
    title: "Get ingestion health",
    description: "Read redacted ingestion and Gmail integration health.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => text({
    ingestion: await api.ingestionStatus(),
    gmail: await api.gmailStatus(),
    health: await api.gmailHealth()
  }));
}
