import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
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
  [key: string]: unknown;
};

type Jwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
  [key: string]: unknown;
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

function tokenScopes(payload: JwtPayload): Set<string> {
  const result = new Set<string>();
  if (typeof payload.scope === "string") {
    for (const scope of payload.scope.split(/\s+/).filter(Boolean)) result.add(scope);
  }
  if (Array.isArray(payload.scp)) {
    for (const scope of payload.scp) if (typeof scope === "string") result.add(scope);
  } else if (typeof payload.scp === "string") {
    for (const scope of payload.scp.split(/\s+/).filter(Boolean)) result.add(scope);
  }
  return result;
}

export type VerifiedAccessToken = {
  payload: JwtPayload;
  scopes: Set<string>;
};

export async function verifyAccessToken(
  token: string,
  config: Config,
  requiredScopes: string[],
): Promise<VerifiedAccessToken> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed access token");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonPart<JwtHeader>(encodedHeader);
  const payload = parseJsonPart<JwtPayload>(encodedPayload);

  if (header.alg !== "RS256") throw new Error("Unsupported access-token signing algorithm");
  if (!header.kid) throw new Error("Access token is missing kid");
  if (payload.iss !== config.OAUTH_ISSUER) throw new Error("Access token issuer mismatch");
  if (!audienceMatches(payload.aud, config.OAUTH_AUDIENCE)) throw new Error("Access token audience mismatch");

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error("Access token expired");
  if (payload.nbf && payload.nbf > now + 30) throw new Error("Access token is not active yet");

  const keys = await getJwks(config);
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    jwksCache = undefined;
    const refreshed = await getJwks(config);
    const rotated = refreshed.find((candidate) => candidate.kid === header.kid);
    if (!rotated) throw new Error("No signing key matches access token kid");
    const key = createPublicKey({ key: rotated as JsonWebKey, format: "jwk" });
    const ok = verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), key, decodeBase64Url(encodedSignature));
    if (!ok) throw new Error("Invalid access-token signature");
  } else {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
    const ok = verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), key, decodeBase64Url(encodedSignature));
    if (!ok) throw new Error("Invalid access-token signature");
  }

  const scopes = tokenScopes(payload);
  const missing = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missing.length > 0) throw new Error(`Missing required scope: ${missing.join(" ")}`);

  return { payload, scopes };
}

export function scopeForRequest(req: Request): string[] {
  if (req.body?.method === "tools/call") {
    const toolName = req.body?.params?.name;
    if (toolName === "create_manual_bank_transaction") return ["transaction.write"];
    if (toolName === "reconcile_bank_transaction") return ["reconciliation.write"];
  }
  return ["fund.read"];
}

export function oauthChallenge(config: Config, scope = "fund.read"): string {
  return `Bearer resource_metadata="${config.MCP_PUBLIC_BASE_URL}/.well-known/oauth-protected-resource", scope="${scope}"`;
}

export function oauthMiddleware(config: Config) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.header("authorization");
    if (!auth?.startsWith("Bearer ")) {
      const scope = scopeForRequest(req).join(" ");
      res.setHeader("WWW-Authenticate", oauthChallenge(config, scope));
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const requiredScopes = scopeForRequest(req);
      const verified = await verifyAccessToken(auth.slice("Bearer ".length), config, requiredScopes);
      res.locals.oauth = {
        sub: verified.payload.sub,
        scopes: [...verified.scopes],
      };
      next();
    } catch (error) {
      const scope = scopeForRequest(req).join(" ");
      res.setHeader("WWW-Authenticate", oauthChallenge(config, scope));
      res.status(401).json({
        error: "invalid_token",
        error_description: error instanceof Error ? error.message : "Access token rejected",
      });
    }
  };
}
