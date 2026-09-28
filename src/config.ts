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
  MCP_AUTH_MODE: z.enum(["static", "oauth"]).default("static"),
  MCP_BEARER_TOKEN: z.string().min(24).optional(),
  MCP_PUBLIC_BASE_URL: z.string().url().optional(),
  OAUTH_ISSUER: z.string().url().optional(),
  OAUTH_AUDIENCE: z.string().min(1).optional(),
  OAUTH_METADATA_URL: z.string().url().optional(),
  OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  FUND_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
});

export type Config = {
  FUND_API_BASE_URL: string;
  FUND_API_USERNAME: string;
  FUND_API_PASSWORD: string;
  MCP_TRANSPORT: "http" | "stdio";
  MCP_HOST: string;
  MCP_PORT: number;
  MCP_AUTH_MODE: "static" | "oauth";
  MCP_BEARER_TOKEN?: string;
  MCP_PUBLIC_BASE_URL: string;
  OAUTH_ISSUER: string;
  OAUTH_AUDIENCE: string;
  OAUTH_METADATA_URL?: string;
  OAUTH_HTTP_TIMEOUT_MS: number;
  FUND_API_TIMEOUT_MS: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = RawConfigSchema.parse(env);
  const username = raw.FUND_API_USERNAME ?? raw.APP_ADMIN_USERNAME;
  const password = raw.FUND_API_PASSWORD ?? raw.APP_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error("Fund API credentials are required");
  }

  if (raw.MCP_TRANSPORT === "http" && raw.MCP_AUTH_MODE === "static" && !raw.MCP_BEARER_TOKEN) {
    throw new Error("MCP_BEARER_TOKEN is required when MCP_AUTH_MODE=static");
  }

  if (raw.MCP_TRANSPORT === "http" && raw.MCP_AUTH_MODE === "oauth") {
    if (!raw.MCP_PUBLIC_BASE_URL) throw new Error("MCP_PUBLIC_BASE_URL is required when MCP_AUTH_MODE=oauth");
    if (!raw.OAUTH_ISSUER) throw new Error("OAUTH_ISSUER is required when MCP_AUTH_MODE=oauth");
    if (!raw.OAUTH_AUDIENCE) throw new Error("OAUTH_AUDIENCE is required when MCP_AUTH_MODE=oauth");
  }

  return {
    FUND_API_BASE_URL: raw.FUND_API_BASE_URL,
    FUND_API_USERNAME: username,
    FUND_API_PASSWORD: password,
    MCP_TRANSPORT: raw.MCP_TRANSPORT,
    MCP_HOST: raw.MCP_HOST,
    MCP_PORT: raw.MCP_PORT,
    MCP_AUTH_MODE: raw.MCP_AUTH_MODE,
    MCP_BEARER_TOKEN: raw.MCP_BEARER_TOKEN,
    MCP_PUBLIC_BASE_URL: raw.MCP_PUBLIC_BASE_URL ?? "http://localhost:8080",
    OAUTH_ISSUER: raw.OAUTH_ISSUER ?? "http://localhost:8081",
    OAUTH_AUDIENCE: raw.OAUTH_AUDIENCE ?? "fund-management-mcp",
    OAUTH_METADATA_URL: raw.OAUTH_METADATA_URL,
    OAUTH_HTTP_TIMEOUT_MS: raw.OAUTH_HTTP_TIMEOUT_MS,
    FUND_API_TIMEOUT_MS: raw.FUND_API_TIMEOUT_MS
  };
}
