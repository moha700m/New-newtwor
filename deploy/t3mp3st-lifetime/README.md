# T3MP3ST Lifetime Runtime

Production wrapper for deploying the upstream T3MP3ST project on Vercel Container Runtime with durable state.

## Source pin

Upstream: `elder-plinius/T3MP3ST`
Commit: `29824d5625ede419ac8cdae418c8f4c72c6270f7`

The upstream commit is pinned so a future upstream change cannot silently alter production.

## Persistence

The container uses local runtime mirrors:

- `T3MP3ST_STATE_DIR=/tmp/t3mp3st-state`
- `T3MP3ST_CONFIG_DIR=/tmp/t3mp3st-config`

A supervisor synchronizes these files to a **private Vercel Blob** store:

- state/state.json
- state/events.jsonl
- config/config.json
- config/.env
- meta/runtime.json

On boot it restores the durable copies before starting T3MP3ST. On changes it syncs every 5 seconds and flushes on SIGTERM/SIGINT.

Private Blob reads use `useCache: false` so overwritten agent-memory/state files are read consistently.

## Required Vercel environment

- `BLOB_READ_WRITE_TOKEN` — provisioned by the connected private Blob store.
- `T3MP3ST_STATE_DIR=/tmp/t3mp3st-state`
- `T3MP3ST_CONFIG_DIR=/tmp/t3mp3st-config`
- `T3MP3ST_MODE=t3mp3st`
- `NODE_ENV=production`

## OpenAI

Production uses OpenAI through Vercel secrets:

- `OPENAI_API_KEY` — sensitive production secret; never commit its value.
- `TEMPEST_DEFAULT_PROVIDER=openai`
- `T3MP3ST_OPENAI_MODEL=gpt-6.1-sol`

At container startup the wrapper validates the credential against the OpenAI model listing endpoint and confirms the preferred model is available. If the preferred model is unavailable, it can fall back to a compatible model without exposing the key.

## Security

Keep Vercel Authentication / SSO protection enabled. T3MP3ST's own server warns that its command-executing API has no built-in internet-grade authentication.

## Current production

Vercel project: `t3mp3st-full`
Production domain: `https://t3mp3st-full.vercel.app`

Persistence was verified by a real redeploy: the second container boot restored data from private Blob (`boot=2; restored=1`).
