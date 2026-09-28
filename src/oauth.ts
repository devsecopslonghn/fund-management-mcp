import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { Config } from "./config.js";

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  scope?: string;
  scp?: string[] | string;
  sub?: string;
  client_id?: string;
  azp?: string;
  [key: string]: unknown;
};

type Jwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

type OidcMetadata = {
  issuer: string;
  jwks_uri: string;
};

let metadataCache: { value: OidcMetadata; expiresAt: number } | undefined;
let jwksCache: { value: Jwk[]; expiresAt: number } | undefined;

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function parseJsonPart<T>(value: string): T {
  return JSON.parse(decodeBase64Url(value).toString("utf8")) as T;
}

async function getMetadata(config: Config): Promise<OidcMetadata> {
  if (metadataCache && metadataCache.expiresAt > Date.now()) return metadataCache.value;

  const wellKnown = config.OAUTH_METADATA_URL
    ?? `${config.OAUTH_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(wellKnown, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(config.OAUTH_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OAuth metadata returned HTTP ${response.status}`);

  const raw = await response.json() as Partial<OidcMetadata>;
  if (!raw.issuer || !raw.jwks_uri) throw new Error("OAuth metadata is missing issuer or jwks_uri");
  if (raw.issuer !== config.OAUTH_ISSUER) throw new Error("OAuth issuer metadata mismatch");

  metadataCache = {
    value: { issuer: raw.issuer, jwks_uri: raw.jwks_uri },
    expiresAt: Date.now() + 5 * 60_000,
  };
  return metadataCache.value;
}

async function getJwks(config: Config): Promise<Jwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.value;

  const metadata = await getMetadata(config);
  const response = await fetch(metadata.jwks_uri, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(config.OAUTH_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`JWKS endpoint returned HTTP ${response.status}`);

  const raw = await response.json() as { keys?: Jwk[] };
  if (!Array.isArray(raw.keys) || raw.keys.length === 0) {
    throw new Error("OAuth JWKS endpoint did not return signing keys");
  }

  jwksCache = { value: raw.keys, expiresAt: Date.now() + 5 * 60_000 };
  return jwksCache.value;
}

function audienceMatches(aud: JwtPayload["aud"], expected: string): boolean {
  return typeof aud === "string"
    ? aud === expected
    : Array.isArray(aud) && aud.includes(expected);
}

function tokenScopes(payload: JwtPayload): string[] {
  const result = new Set<string>();
  if (typeof payload.scope === "string") {
    for (const scope of payload.scope.split(/\s+/).filter(Boolean)) result.add(scope);
  }
  if (Array.isArray(payload.scp)) {
    for (const scope of payload.scp) if (typeof scope === "string") result.add(scope);
  } else if (typeof payload.scp === "string") {
    for (const scope of payload.scp.split(/\s+/).filter(Boolean)) result.add(scope);
  }
  return [...result];
}

async function signingKey(header: JwtHeader, config: Config): Promise<Jwk> {
  if (!header.kid) throw new Error("Access token is missing kid");

  let keys = await getJwks(config);
  let key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) {
    jwksCache = undefined;
    keys = await getJwks(config);
    key = keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!key) throw new Error("No signing key matches access token kid");
  return key;
}

export async function verifyAccessToken(token: string, config: Config): Promise<AuthInfo> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed access token");

  const encodedHeader = parts[0]!;
  const encodedPayload = parts[1]!;
  const encodedSignature = parts[2]!;
  const header = parseJsonPart<JwtHeader>(encodedHeader);
  const payload = parseJsonPart<JwtPayload>(encodedPayload);

  if (header.alg !== "RS256") throw new Error("Unsupported access-token signing algorithm");
  if (payload.iss !== config.OAUTH_ISSUER) throw new Error("Access token issuer mismatch");
  if (!audienceMatches(payload.aud, config.OAUTH_AUDIENCE)) throw new Error("Access token audience mismatch");

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error("Access token expired");
  if (payload.nbf && payload.nbf > now + 30) throw new Error("Access token is not active yet");

  const jwk = await signingKey(header, config);
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key,
    decodeBase64Url(encodedSignature),
  );
  if (!valid) throw new Error("Invalid access-token signature");

  return {
    token,
    clientId: payload.client_id ?? payload.azp ?? payload.sub ?? "unknown-client",
    scopes: tokenScopes(payload),
    expiresAt: payload.exp,
    resource: new URL(config.MCP_PUBLIC_BASE_URL),
    resourceMetadataUrl: `${config.MCP_PUBLIC_BASE_URL}/.well-known/oauth-protected-resource`,
    extra: { sub: payload.sub }
  };
}

export function oauthChallenge(config: Config): string {
  const scopes = ["fund.read", "transaction.write", "reconciliation.write"].join(" ");
  return `Bearer resource_metadata="${config.MCP_PUBLIC_BASE_URL}/.well-known/oauth-protected-resource", scope="${scopes}"`;
}

export function oauthMiddleware(config: Config) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.header("authorization");
    if (!auth?.startsWith("Bearer ")) {
      res.setHeader("WWW-Authenticate", oauthChallenge(config));
      res.status(401).json({
        error: "invalid_token",
        error_description: "Bearer token required"
      });
      return;
    }

    try {
      const authInfo = await verifyAccessToken(auth.slice("Bearer ".length), config);
      (req as Request & { auth?: AuthInfo }).auth = authInfo;
      next();
    } catch (error) {
      res.setHeader("WWW-Authenticate", oauthChallenge(config));
      res.status(401).json({
        error: "invalid_token",
        error_description: error instanceof Error ? error.message : "Access token rejected",
      });
    }
  };
}