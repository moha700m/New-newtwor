# Open Web MCP

Production-oriented Web Research + Browser Automation MCP server for ChatGPT and other MCP hosts.

It provides:

- public web search through self-hosted SearXNG, with an optional DuckDuckGo HTML fallback;
- SSRF-safe HTTP retrieval with DNS validation at connection time and redirect re-validation;
- readability extraction to Markdown, text, or article HTML;
- automatic Playwright rendering for JavaScript-heavy pages;
- screenshots;
- persistent isolated browser sessions with stable session-local element IDs;
- Bearer authentication, rate limiting, concurrency limits, cache, structured logs, health/readiness endpoints;
- Docker, Railway, Render, Fly.io, VPS, CI, and OpenAI Agent Plugin packaging.

## Runtime requirements

- Node.js 22+
- Chromium supplied by Playwright
- SearXNG recommended for production search
- public HTTPS endpoint ending in `/mcp` for ChatGPT

The project targets MCP TypeScript SDK v2 and the 2026-era Streamable HTTP transport.

## Local development

```bash
cp .env.example .env
# Set a real key in .env
npm install
npx playwright install chromium
npm run dev
```

Health endpoints:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/ready
```

For a protocol-aware smoke test:

```bash
npm run smoke
```

The smoke runner negotiates MCP through the official client SDK, lists tools, runs `search_web`, `open_url`, `extract_page`, `browser_navigate`, `browser_snapshot`, and `browser_close`.

In development/test mode, authentication is optional when `MCP_API_KEY` is unset. In production, startup fails unless `MCP_API_KEY` is configured.

## Docker

The included Compose stack runs both Open Web MCP and SearXNG.

```bash
cp .env.example .env
openssl rand -hex 32
# Put the generated value into SEARXNG_SECRET.
openssl rand -hex 32
# Put the second generated value into MCP_API_KEY.

docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/ready
```

SearXNG JSON output is explicitly enabled in `searxng/settings.yml`.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `PORT` | HTTP port | `8787` |
| `HOST` | bind address | `0.0.0.0` |
| `MCP_API_KEY` | Bearer key for `/mcp` | required in production |
| `MCP_ALLOWED_HOSTS` | comma-separated Host allowlist | localhost in development |
| `PUBLIC_BASE_URL` | public service base URL | derived locally/Railway |
| `SEARXNG_URL` | SearXNG base URL | optional outside Compose |
| `ENABLE_DDG_FALLBACK` | enable free HTML fallback | `true` |
| `MAX_BROWSER_SESSIONS` | max persistent sessions | `5` |
| `BROWSER_SESSION_TTL` | absolute session TTL seconds | `600` |
| `BROWSER_IDLE_TTL` | idle session TTL seconds | `300` |
| `PAGE_TIMEOUT_MS` | browser/fetch timeout | `30000` |
| `MAX_HTML_BYTES` | HTML retrieval limit | `10000000` |
| `MAX_TEXT_CHARS` | model-facing text limit | `100000` |
| `MAX_DOWNLOAD_BYTES` | generic body limit | `25000000` |
| `MAX_REDIRECTS` | redirect limit | `5` |
| `SEARCH_CACHE_TTL` | search cache seconds | `300` |
| `PAGE_CACHE_TTL` | page cache seconds | `300` |
| `REQUEST_DELAY_MS` | minimum per-domain pacing | `100` |
| `PER_DOMAIN_CONCURRENCY` | max same-domain requests | `2` |
| `RATE_LIMIT_MAX` | per-client requests/window | `120` |
| `RATE_LIMIT_WINDOW_MS` | rate-limit window | `60000` |
| `GLOBAL_CONCURRENCY` | max simultaneous MCP requests | `16` |

## MCP tools

### Research

- `search_web` — public web discovery with language and freshness controls.
- `open_url` — fast HTTP retrieval with automatic JavaScript rendering fallback.
- `extract_page` — main content as Markdown, text, or article HTML.
- `find_text` — literal phrase lookup with surrounding context.
- `get_links` — absolute normalized links, optionally same-host only.
- `fetch_json` — SSRF-safe public GET/HEAD JSON retrieval with dangerous proxy headers blocked.

### Browser

- `screenshot`
- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_select`
- `browser_back`
- `browser_reload`
- `browser_close`

`browser_snapshot` writes `data-openweb-id` attributes into the isolated page DOM and returns IDs such as `e12`. Later actions use those IDs rather than brittle CSS selectors.

## Smart fetch pipeline

`open_url` uses this path:

1. Parse and validate URL.
2. Resolve every address and reject private/special networks.
3. Connect through a custom DNS lookup that repeats public-IP checks at connection time.
4. Follow redirects manually and repeat validation for every hop.
5. Fetch HTML over Node HTTP(S).
6. Extract readable content.
7. If content is suspiciously sparse and the document looks client-rendered, render it with Playwright.
8. Run Readability, then Cheerio fallback.
9. Normalize model-facing Markdown and truncate only at configured output limits.

## SSRF and browser network security

Blocked target classes include loopback, RFC1918 private space, link-local, carrier-grade NAT, IPv6 unique-local/link-local, unspecified, multicast/reserved ranges, and metadata addresses such as `169.254.169.254`.

Only `http:` and `https:` top-level targets are accepted. Embedded browser HTTP(S) requests are intercepted and validated before network access. Redirects are not delegated blindly to the HTTP client.

`fetch_json` is intentionally not an unrestricted proxy: credential, cookie, host-routing, and forwarding headers are rejected.

For high-assurance scraping of untrusted websites, add host-level egress filtering and a Chromium sandbox/seccomp policy where the deployment platform supports it. The supplied container already runs the application as a non-root user; network-level controls remain recommended defense in depth.

## Authentication

Production uses:

```http
Authorization: Bearer <MCP_API_KEY>
```

Comparison is timing-safe. Authorization and cookies are redacted from logs.

Generate a key with:

```bash
openssl rand -hex 32
```

## Observability

Pino JSON logs include `request_id`, `tool`, `duration_ms`, `status`, `hostname`, `browser_used`, and `cache_hit`. Secrets, cookies, and Authorization headers are redacted.

## Testing

Core quality gate:

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Live browser/network integration tests:

```bash
npx playwright install chromium
RUN_LIVE_TESTS=1 npx vitest run tests/live.integration.test.ts
```

The live suite covers redirect-to-private blocking and a persistent browser navigate → snapshot → type → click → close flow.

## MCP Inspector

Start the service and run:

```bash
npx @modelcontextprotocol/inspector@latest
```

Choose **Streamable HTTP** and connect to `http://localhost:8787/mcp`. Provide the Bearer header when authentication is enabled.

## Connect to ChatGPT

1. Deploy this service to a public HTTPS domain.
2. Confirm `https://YOUR-DOMAIN/health` and `/ready` return healthy status.
3. Confirm `https://YOUR-DOMAIN/mcp` works with MCP Inspector or the included official-client smoke runner.
4. In ChatGPT, enable Developer mode under **Settings → Security and login**.
5. Open **Plugins**, choose **+**, and add the full MCP URL: `https://YOUR-DOMAIN/mcp`.
6. Configure the connection to send `Authorization: Bearer <MCP_API_KEY>`.
7. Install the personal plugin and invoke it when web research/browser actions are needed.

The root `plugin.json`, `mcp.json`, and `skills/` directory use the portable Agent Plugins package layout. Before packaging/publishing, replace `https://MY-DOMAIN.com/mcp` inside `mcp.json` with the deployed endpoint.

## Railway

When this project lives in a larger repository, set the MCP service root directory to `open-web-mcp` and the SearXNG service root directory to `open-web-mcp/searxng`.

Recommended production layout:

- service 1: `open-web-mcp` using the project Dockerfile;
- service 2: `open-web-searxng` using `searxng/Dockerfile`;
- private Railway networking between services;
- `SEARXNG_URL=http://<private-searxng-host>:8080` on the MCP service;
- a generated public HTTPS domain only on the MCP service.

Set at minimum:

```text
NODE_ENV=production
MCP_API_KEY=<random 32+ byte value>
MCP_ALLOWED_HOSTS=<public railway domain>
SEARXNG_URL=http://<searxng-private-host>:8080
ENABLE_DDG_FALLBACK=true
```

## Render

`render.yaml` defines the MCP service. Deploy SearXNG as a second private service or point `SEARXNG_URL` at another trusted instance. Set `MCP_API_KEY` and `MCP_ALLOWED_HOSTS` in the dashboard.

## Fly.io

`fly.toml` runs the MCP service. Configure secrets:

```bash
fly secrets set MCP_API_KEY=... MCP_ALLOWED_HOSTS=your-app.fly.dev SEARXNG_URL=http://your-private-searx:8080
fly deploy
```

## VPS

The shortest production path on a VPS is Docker Compose behind Caddy or Nginx:

```text
Internet → HTTPS reverse proxy → open-web-mcp:8787
                              ↘ private Docker network → searxng:8080
```

Do not publish the SearXNG container unless you intentionally want a public search instance.

## Troubleshooting

### `/ready` reports `chromium: false`

Verify Chromium and its system libraries are available. The supplied Dockerfile uses the matching official Playwright image.

### SearXNG returns 403 for JSON

Confirm the mounted `searxng/settings.yml` enables both `html` and `json` under `search.formats`.

### ChatGPT receives 401

Verify the plugin connection sends the same Bearer value configured as `MCP_API_KEY`.

### ChatGPT receives 403 before MCP runs

Verify `MCP_ALLOWED_HOSTS` includes the deployment hostname exactly, without a URL scheme or path.

### Browser session expired

Persistent sessions are intentionally bounded by absolute and idle TTLs. Call `browser_navigate` again and take a fresh snapshot.

## Production notes

- Browser session state is in-memory by design. Run one replica unless you add sticky routing or an external session layer.
- Search/page cache is in-memory. Redis is deliberately not required.
- Hard container memory/CPU enforcement belongs to Docker/Railway/Render/Fly; `BROWSER_MEMORY_MB` additionally constrains Chromium V8 heap intent.
- The DuckDuckGo HTML provider is a fallback, not a search SLA. Self-host SearXNG for predictable production behavior.
- Use a dedicated egress policy/firewall in high-assurance environments as defense in depth in addition to application SSRF controls.
