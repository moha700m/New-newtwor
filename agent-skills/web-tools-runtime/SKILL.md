---
name: web-tools-runtime
description: Route web extraction and browser automation across Scrapling, Patchright Enhanced, and Agent Reach. Use local runtimes when possible; when the ChatGPT container blocks outbound DNS/network or Chrome navigation, automatically execute the same task through the user's GitHub Actions remote runtime in moha700m/New-newtwor on branch web-tools-runtime, then retrieve and verify the artifact result.
---

# Web Tools Runtime

This is the orchestration skill for the user's three web tools:

- Scrapling 0.4.15 — structured/static HTTP extraction and reusable scraping.
- Patchright Enhanced / Patchright — JavaScript-heavy pages, browser interactions, sessions, QA, and browser automation.
- Agent Reach 1.5.0 — multi-platform routing for web, RSS, YouTube, GitHub/social backends, and capability health checks.

Choose the shortest correct path and transparently fall back to the remote runtime when the active ChatGPT container blocks outbound access.

## Source of truth

Remote runtime repository: `moha700m/New-newtwor`
Remote runtime branch: `web-tools-runtime`
Workflow: `.github/workflows/web-tools-runtime.yml`
Request directory: `runtime-requests/`
Result artifact contains: `runtime-output/request.json` and `runtime-output/result.json`

## Routing rules

1. Prefer native ChatGPT web/connectors/plugins when they already solve the task reliably and with less machinery.
2. Use Scrapling for direct HTTP/static HTML and structured extraction.
3. Escalate to Patchright Enhanced when JavaScript, real browser rendering, clicks, forms, navigation, sessions, or browser-only behavior is required.
4. Use Agent Reach when the task is platform-oriented or benefits from its channel/backend routing, especially RSS/YouTube/social/dev-platform research.
5. Prefer direct HTTP first when sufficient.
6. Do not use stealth or browser automation to bypass authorization, paywalls, CAPTCHA, WAF, private data, or access controls.

## Local runtime

Expected local commands:

- `/usr/local/bin/scrapling`
- `/usr/local/bin/patchright-enhanced`
- `/usr/local/bin/agent-reach`

Python environment for Scrapling and Agent Reach: `/opt/agent-web-tools`.

Known ChatGPT-container restrictions can include:

- `NETWORK=caas_packages_only`
- outbound DNS/network denial
- Chrome policy `URLBlocklist: ["*"]`
- `ERR_BLOCKED_BY_ADMINISTRATOR`

These are environment restrictions, not evidence that the tools are broken.

## Automatic remote fallback

Use the remote runtime when DNS resolution fails, outbound HTTP/TCP is blocked, Chrome navigation is blocked by administrator policy, or the local tool runs correctly but cannot reach the public target because of platform egress policy.

Do not claim the local restriction was removed. State that the remote runtime handled the network-dependent execution.

## Remote request format

Create a unique JSON file under `runtime-requests/` on branch `web-tools-runtime`.

Scrapling:
```json
{"tool":"scrapling","url":"https://example.com","selector":"h1"}
```

Patchright Enhanced:
```json
{"tool":"patchright-enhanced","url":"https://example.com","selector":"h1"}
```

Agent Reach RSS:
```json
{"tool":"agent-reach","operation":"rss","url":"https://hnrss.org/frontpage"}
```

Agent Reach web:
```json
{"tool":"agent-reach","operation":"web","url":"https://example.com"}
```

## GitHub connector execution procedure

1. Create a unique request file on `web-tools-runtime` using the GitHub connector.
2. Record the returned commit SHA.
3. Query Actions runs for `moha700m/New-newtwor`, branch `web-tools-runtime`, event `push`.
4. Select the run whose `head_sha` exactly matches the request commit SHA.
5. Poll until completed.
6. Require workflow/job conclusion `success`; on failure inspect logs and fix before retrying.
7. Query and download artifact `web-tool-result-<run_id>`.
8. Read `runtime-output/result.json`.
9. Require `ok: true` before treating execution as successful.
10. Distinguish raw tool output from interpretation.

## Secret handling

This repository is public. NEVER place passwords, cookies, API keys, bearer tokens, private session data, personal secrets, or credentials in request JSON, commit messages, workflow logs, or artifacts.

Authenticated remote workflows must use GitHub Actions Secrets with least privilege and explicit user approval.

## Failure policy

- Static/HTTP failure due to JS -> escalate Scrapling to Patchright Enhanced.
- Missing platform backend -> inspect Agent Reach health and use a supported backend or native ChatGPT connector.
- Remote workflow code/dependency failure -> inspect logs and repair the workflow, do not repeatedly submit the same broken request.
- Target-side denial -> respect it; do not bypass access controls.

## Response behavior

Focus on the result. Do not make the user choose local vs remote unless authorization, secrets, or cost materially change the decision. Choose automatically.

Do not say “DNS is fixed” when only the remote fallback is working. The precise statement is: local egress remains restricted, but network-dependent web-tool tasks have a verified remote execution path.
