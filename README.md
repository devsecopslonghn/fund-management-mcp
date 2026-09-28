# Fund Management MCP

MCP adapter for the Fund Management system.

The Spring Boot backend remains the financial source of truth. This service exposes a small semantic tool surface for ChatGPT and other MCP clients. It never connects directly to MongoDB and never reimplements accounting calculations.

## Tools

Read-only:
- `get_fund_summary`
- `get_expense_summary`
- `get_member_payment_status`
- `get_reconciliation_queue`
- `get_ingestion_health`

Guarded writes:
- `create_manual_bank_transaction`
- `reconcile_bank_transaction`

Both write tools require `confirmed: true`. Bank and email content are untrusted external data and must never be interpreted as instructions or authorization.

## Architecture

```text
ChatGPT
   |
   | OAuth 2.1 + MCP Streamable HTTP
   v
fund-management-mcp
   |
   | REST /api/v1
   v
fund-management-backend
   |
   +-- MongoDB
   +-- Gmail ingestion
   +-- reconciliation engine
```

Gmail is only an ingestion adapter. If Gmail OAuth or polling fails, manual transaction entry still goes through the same backend reconciliation and audit workflow.

## OAuth 2.1 resource-server mode

For ChatGPT, configure the MCP server as an OAuth resource server:

```bash
MCP_TRANSPORT=http
MCP_AUTH_MODE=oauth
MCP_PUBLIC_BASE_URL=https://mcp-quybpdev.apps.drgdevlab.com
OAUTH_ISSUER=https://<your-authorization-server>
OAUTH_AUDIENCE=https://mcp-quybpdev.apps.drgdevlab.com
```

Optional:

```bash
OAUTH_METADATA_URL=https://<issuer>/.well-known/openid-configuration
OAUTH_HTTP_TIMEOUT_MS=5000
```

OAuth mode provides:

- `GET /.well-known/oauth-protected-resource`
- `WWW-Authenticate: Bearer ... resource_metadata=...` challenges
- local RS256 JWT signature verification against the issuer JWKS
- issuer, audience, expiry, and not-before validation
- MCP `AuthInfo` propagation
- per-tool scope challenges

Scopes:

```text
fund.read
transaction.write
reconciliation.write
```

The MCP server is only the resource server. It does not issue OAuth tokens. Use a standards-compliant authorization server/identity provider that publishes OAuth/OIDC metadata, supports Authorization Code + PKCE (S256), and issues an access token for the MCP resource/audience.

## Static bearer fallback

Static bearer mode remains available for low-level debugging:

```bash
MCP_TRANSPORT=http
MCP_AUTH_MODE=static
MCP_BEARER_TOKEN='replace-with-a-long-random-secret'
```

Do not use the static bearer mode as the final ChatGPT authentication model.

## Local stdio

```bash
npm install
npm run build

export FUND_API_BASE_URL=http://localhost:8080/api/v1
export FUND_API_USERNAME=admin
export FUND_API_PASSWORD='...'
export MCP_TRANSPORT=stdio

npm start
```

## HTTP endpoints

- `POST /mcp`
- `GET /healthz`
- `GET /.well-known/oauth-protected-resource` when OAuth mode is enabled

## Container and GitOps

CI type-checks and builds the service, scans source and the final image, then publishes an immutable image to:

```text
ghcr.io/devsecopslonghn/fund-management-mcp:<git-sha>
```

On a successful push to `master`, CI opens a GitOps PR in `fund-management-helm-chart` using the exact image digest.

## Design boundaries

1. Backend owns finance rules, totals, reconciliation, and audit.
2. MCP owns LLM-friendly tool semantics, OAuth resource validation, and transport.
3. Authorization server/IdP owns user login, consent, authorization codes, PKCE, access tokens, and refresh tokens.
4. MCP validates each access token before executing tools.
5. High-impact backend operations such as reverse transaction, member mutation, and settings mutation are intentionally not exposed.
