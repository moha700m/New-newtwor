# Vercel Services deployment

This project supports Vercel's container-based **Services** runtime. It does not rely on legacy Vercel Serverless Functions for Chromium sessions.

## Layout

`vercel.json` defines two services:

- `mcp`: the Open Web MCP Node.js + Playwright container from `Dockerfile.vercel`.
- `searxng`: the private search service from `searxng/Dockerfile.vercel`.

The MCP service receives `SEARXNG_URL` through a Vercel service binding. Only the MCP service is routed publicly.

## Required project variables

Set these for Preview and Production:

```text
NODE_ENV=production
MCP_API_KEY=<strong random value>
SEARXNG_SECRET=<strong random value>
ENABLE_DDG_FALLBACK=true
```

Vercel system variables `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` are accepted automatically as allowed hostnames and are used to derive the public base URL when `PUBLIC_BASE_URL` is not explicitly set.

## Verification

After deployment, verify:

```text
GET  /health
GET  /ready
POST /mcp  (Authorization: Bearer <MCP_API_KEY>)
```

Then run an MCP client flow containing `browser_navigate`, `browser_snapshot`, an interaction, and `browser_close` as separate requests. The current browser manager stores live sessions in process memory, so production must prove session continuity on the chosen Vercel Services routing mode. If traffic is distributed across instances and continuity is not preserved, move the browser-session execution layer to a persistent Vercel Named Sandbox while retaining the same MCP tool contracts.
