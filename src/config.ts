import { z } from "zod/v4";

const ConfigSchema = z.object({
  FUND_API_BASE_URL: z.string().url().default("http://fund-management-backend.fund-management.svc.cluster.local:8080/api/v1"),
  FUND_API_USERNAME: z.string().min(1),
  FUND_API_PASSWORD: z.string().min(1),
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  MCP_HOST: z.string().default("0.0.0.0"),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MCP_BEARER_TOKEN: z.string().min(24).optional(),
  FUND_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = ConfigSchema.parse(env);
  if (config.MCP_TRANSPORT === "http" && !config.MCP_BEARER_TOKEN) {
    throw new Error("MCP_BEARER_TOKEN is required in HTTP mode");
  }
  return config;
}
