# Fund Management MCP

MCP adapter for the Fund Management system.

The Spring Boot backend remains the financial source of truth. This service exposes a small semantic tool surface for ChatGPT, Codex, and other MCP clients. It never connects directly to MongoDB and never reimplements accounting calculations.

## v0.1 tools

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
ChatGPT / Codex
      |
      | MCP (HTTP or stdio)
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

## Local / Codex

```bash
npm install
npm run build

export FUND_API_BASE_URL=http://localhost:8080/api/v1
export FUND_API_USERNAME=admin
export FUND_API_PASSWORD='...'
export MCP_TRANSPORT=stdio

npm start
```

## Remote / ChatGPT

```bash
export FUND_API_BASE_URL=http://fund-management-backend.fund-management.svc.cluster.local:8080/api/v1
export FUND_API_USERNAME=admin
export FUND_API_PASSWORD='...'
export MCP_TRANSPORT=http
export MCP_BEARER_TOKEN='replace-with-a-long-random-secret'

npm start
```

HTTP endpoints:
- `POST /mcp`
- `GET /healthz`

HTTP mode refuses to start without `MCP_BEARER_TOKEN`. Static bearer authentication is the v0.1 boundary; OAuth/OIDC is the intended production direction for a user-facing ChatGPT App.

## Container and GitOps

CI type-checks and builds the service, scans source and the final image, then publishes an immutable image to:

```text
ghcr.io/devsecopslonghn/fund-management-mcp:<git-sha>
```

On a successful push to `master`, CI opens a GitOps PR in `fund-management-helm-chart` using the exact image digest.

The Helm chart keeps `mcp.enabled=false` by default. Provision the `fund-management-mcp` runtime Secret containing `MCP_BEARER_TOKEN`, then enable the component when remote MCP access is ready.

## Design boundaries

1. Backend owns finance rules, totals, reconciliation, and audit.
2. MCP owns LLM-friendly tool semantics and client transport.
3. MCP reuses backend admin credentials from the existing admin Secret in Kubernetes.
4. MCP has a separate runtime Secret for its external bearer token.
5. High-impact backend operations such as reverse transaction, member mutation, and settings mutation are intentionally not exposed in v0.1.
