# T3MP3ST production runtime

Source of truth: `moha700m/New-newtwor`, branch `web-tools-runtime`, this directory.
Production: https://t3mp3st-full.vercel.app, Vercel project `t3mp3st-full`.
Upstream is pinned to `elder-plinius/T3MP3ST` commit
`29824d5625ede419ac8cdae418c8f4c72c6270f7`. The retained source patch,
package manifest, and lockfile are applied by `prepare.mjs`. Nothing is patched
only inside Vercel. See `DEPENDENCY-SECURITY.md` for dependency changes.

## Build and verification

The Dockerfile pins the Node/Alpine image by digest, pins direct OS packages,
and verifies the official Trivy and Go compiler downloads by SHA-256. Gitleaks is rebuilt from its pinned upstream release with patched modules and a checksum-verified compiler (see `gitleaks/BUILD.md`). The final runtime omits npm, Corepack, and Yarn. It installs
dependencies with `npm ci --ignore-scripts`, checks types/lint/build/audit, runs
supervisor tests, and excludes development dependencies from the runtime image.
Trivy scans the final filesystem, including OS and language dependencies;
fixable high/critical findings fail the build. The database is fetched from the
official GHCR repository. The application and supervisor run as user `node`.

To verify source changes without a container, use an isolated checkout:

```sh
git clone https://github.com/elder-plinius/T3MP3ST.git /tmp/t3mp3st-source
git -C /tmp/t3mp3st-source checkout 29824d5625ede419ac8cdae418c8f4c72c6270f7
sh deploy/t3mp3st-lifetime/verify.sh /tmp/t3mp3st-source
```

To build the actual production image from the repository root:

```sh
docker build -f deploy/t3mp3st-lifetime/Dockerfile.vercel \
  -t t3mp3st-runtime deploy/t3mp3st-lifetime
```

The GitHub workflow repeats clean installation, type checking, lint, the full
upstream test suite, supervisor tests, dependency audit, secret scanning, and
the actual container build. It needs no deployment credentials.

## Environment and OpenAI

Set `OPENAI_API_KEY` as a Vercel Sensitive production secret. Set the connected
private store's `BLOB_READ_WRITE_TOKEN` as Sensitive in production and preview.
Never include either value in source files, configuration snapshots, or logs.
The `.env.example` contains only nonsecret settings and explanatory comments.

Production uses `TEMPEST_DEFAULT_PROVIDER=openai` and
`T3MP3ST_OPENAI_MODEL=gpt-6.1-sol`. Model discovery and inference always use
`https://api.openai.com/v1`. Startup reports whether the preferred model is
available. Fallback is disabled unless the operator explicitly sets both
`T3MP3ST_OPENAI_ALLOW_FALLBACK=true` and an allowlist in
`T3MP3ST_OPENAI_FALLBACK_MODELS`; selection is reported, never silent.

`T3MP3ST_RUN_SMOKE=true` performs one bounded request through the actual
application's `/api/llm/chat`, requesting the exact marker `T3MP3ST_OK` with
32 maximum output tokens. Runtime status reports only success/status/model.

## Persistent state

Local mirrors are `/tmp/t3mp3st-state` and `/tmp/t3mp3st-config/runtime`.
The supervisor validates and restores state before starting the server.
It persists `state.json`, the complete `events.jsonl`, and sanitized
`config.json`. It never imports or persists `config/.env`. Benign configuration
preferences are retained, while provider, URL, credentials, fallback, proxy,
timeout, and token controls are enforced from the production configuration.

The default namespace is `t3mp3st-runtime/v2`: content-addressed immutable
snapshots plus a manifest committed with an ETag conditional write. The manifest
contains schema version, revision, snapshot hashes, timestamps, and deployment/
boot writer identity. Private reads bypass the CDN cache. Startup also verifies
that a snapshot cannot be fetched without authentication.

The old `t3mp3st-runtime/v1` files are a read-only migration source. They remain
available for rollback; the new supervisor never writes or deletes them.
Legacy snapshots are checked for changes so a staged migration can be rejected
before promotion if the live legacy deployment changed its data.

Only one writer is allowed per namespace. Set `T3MP3ST_WRITER_EPOCH` to a
strictly increasing integer for each deployment that takes ownership. Equal
epochs cannot preempt an unexpired writer; older deployments are fenced by
conditional writes. A fenced replica returns unhealthy/read-only status and
rejects mutations. This protects Blob state from concurrent writers; it is a
single-writer deployment and does not provide a multiwriter database.

Uploads are serialized and transient storage failures retry with bounded
backoff. A manifest is published only after all referenced snapshots exist.
Invalid JSON, invalid schemas, incomplete snapshots, and digest mismatches stop
startup instead of replacing durable data with empty state. Atomic local
writes avoid partial snapshots. SIGTERM/SIGINT stop scheduling, signal the
application, wait for its local flush, perform the final Blob flush, and release
the lease. Failed durability produces a nonzero shutdown status.

`T3MP3ST_BLOB_PREFIX` permits isolated rehearsal namespaces. Explicit
`T3MP3ST_READ_ONLY=true` restores diagnostic replicas without publishing.
An optional `T3MP3ST_AUDIT_CANARY` creates one harmless pending memory proposal,
records its ID and content hash, and confirms it was present at the next boot.
It does not approve memory, start a mission, or issue scope receipts.

## Hosted security and tooling

Keep Vercel Authentication/SSO enabled on deployment and production URLs.
Application Origin/Host checks protect browser requests but do not replace SSO.
Hosted APIs reject foreign origins, unsafe provider URLs, client-supplied
credentials, local CLI/proxy controls, oversized bodies, and excessive requests.
Generic command execution accepts only fixed local version checks and still
requires approval; scoped recon and missions retain existing ScopeGuard and
receipt checks. Analysis roots are contained in `/tmp/t3mp3st-workspace`.
Tool subprocesses do not inherit OpenAI, Blob, or deployment credentials.

Added tools are defensive/local: Gitleaks, Trivy, readelf/binutils, ExifTool,
and YARA. Existing curl/git/openssl/file/DNS/nmap tools are retained for
authorized functionality. Catalog-only dangerous tooling is not installed.
Semgrep and additional active network scanners are not installed without a
compatible, tested integration.

## Release and rollback

Preserve a repository rollback ref and the current healthy deployment ID.
Disable automatic domain assignment while building production candidates.
Deploy an exact committed revision, inspect the container audit/build logs,
verify authenticated endpoints, real inference, private storage, and a canary
across redeployment, then explicitly promote the verified deployment. Verify
the production alias and runtime logs afterward. On verification failure,
restore the previous deployment immediately.

Rollback to a v1 deployment uses preserved v1 data, so it does not include new
v2 changes. After v2 activation, prefer a previously verified v2 deployment
with a higher writer epoch to preserve the latest v2 state. Never reuse an old
writer epoch or promote a fenced deployment. Historical immutable snapshots
remain intact; any future retention cleanup must preserve rollback revisions.

`/api/runtime/status` exposes only sanitized readiness, version, persistence,
canary, and inference evidence. See `PRODUCTION-AUDIT.md` for the latest actual
release results and deployment IDs; a successful build alone is not acceptance.
