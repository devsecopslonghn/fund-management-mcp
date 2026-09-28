# Fund Management MCP

MCP adapter for the Fund Management system.

The Spring Boot backend remains the financial source of truth. This service only exposes a small MCP-friendly surface for ChatGPT, Codex, and other MCP clients.

## v0.1 tools

- `get_fund_summary`
- `get_ingestion_health`

This first slice is intentionally read-only. Write operations such as manual transaction creation and reconciliation will be added behind explicit confirmation after the remote authentication model is finalized.

## Architecture

```text
ChatGPT / Codex
      |
      | MCP
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

The MCP service never accesses MongoDB directly and does not duplicate accounting calculations.

## Configuration

Required backend credentials:

```bash
FUND_API_BASE_URL=http://fund-management-backend.fund-management.svc.cluster.local:8080/api/v1
FUND_API_USERNAME=admin
FUND_API_PASSWORD=...
```

### Local / Codex

```bash
npm install
npm run build
MCP_TRANSPORT=stdio npm start
```

### Remote / ChatGPT

```bash
MCP_TRANSPORT=http
MCP_BEARER_TOKEN=replace-with-a-long-random-secret
npm start
```

HTTP mode exposes:

- `POST /mcp`
- `GET /healthz`

HTTP mode refuses to start without a bearer token. Static bearer auth is only the v0.1 boundary; OAuth/OIDC is the intended production direction for ChatGPT integration.

## Design principles

1. Backend owns all finance rules and totals.
2. Gmail is an optional ingestion adapter, not the ledger source of truth.
3. MCP exposes semantic tools rather than mirroring every REST endpoint.
4. External transaction/email text is data, not executable instructions.
5. High-impact write operations stay out of v0.1 until confirmation and auth boundaries are finalized.
