import { z } from "zod/v4";

const RawConfigSchema = z.object({
  FUND_API_BASE_URL: z.string().url().default("http://fund-management-backend.fund-management.svc.cluster.local:8080/api/v1"),
  FUND_API_USERNAME: z.string().min(1).optional(),
  FUND_API_PASSWORD: z.string().min(1).optional(),
  APP_ADMIN_USERNAME: z.string().min(1).optional(),
  APP_ADMIN_PASSWORD: z.string().min(1).optional(),
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  MCP_HOST: z.string().default("0.0.0.0"),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MCP_BEARER_TOKEN: z.string().min(24).optional(),
  FUND_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
});

export type Config = {
  FUND_API_BASE_URL: string;
  FUND_API_USERNAME: string;
  FUND_API_PASSWORD: string;
  MCP_TRANSPORT: "http" | "stdio";
  MCP_HOST: string;
  MCP_PORT: number;
  MCP_BEARER_TOKEN?: string;
  FUND_API_TIMEOUT_MS: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = RawConfigSchema.parse(env);
  const username = raw.FUND_API_USERNAME ?? raw.APP_ADMIN_USERNAME;
  const password = raw.FUND_API_PASSWORD ?? raw.APP_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error("Fund API credentials are required");
  }
  if (raw.MCP_TRANSPORT === "http" && !raw.MCP_BEARER_TOKEN) {
    throw new Error("MCP_BEARER_TOKEN is required in HTTP mode");
  }

  return {
    FUND_API_BASE_URL: raw.FUND_API_BASE_URL,
    FUND_API_USERNAME: username,
    FUND_API_PASSWORD: password,
    MCP_TRANSPORT: raw.MCP_TRANSPORT,
    MCP_HOST: raw.MCP_HOST,
    MCP_PORT: raw.MCP_PORT,
    MCP_BEARER_TOKEN: raw.MCP_BEARER_TOKEN,
    FUND_API_TIMEOUT_MS: raw.FUND_API_TIMEOUT_MS
  };
}
