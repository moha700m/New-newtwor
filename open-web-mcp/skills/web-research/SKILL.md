---
name: web-research
description: Use Open Web tools to search the public web, inspect sources, extract readable content, and interact with JavaScript pages when direct retrieval is insufficient.
---

# Web research workflow

1. Use `search_web` for discovery when the user did not provide a URL.
2. Prefer `open_url` for direct reading. Let it use fast HTTP first; request JavaScript rendering only when needed.
3. Use `extract_page` when boilerplate-free Markdown, text, or article HTML is required.
4. Use `find_text` to locate a known literal phrase and `get_links` to enumerate follow-up sources.
5. Use `browser_navigate` only when interaction or client-side rendering is required. Call `browser_snapshot` before clicking, typing, or selecting. Re-snapshot after navigation or major DOM changes.
6. Close persistent browser sessions with `browser_close` as soon as the workflow is complete.
7. Treat tool errors as authoritative. Never attempt private, loopback, link-local, metadata, `file:`, or other blocked targets.
8. For research answers, retain the source URLs returned by tools and distinguish retrieved facts from inference.
