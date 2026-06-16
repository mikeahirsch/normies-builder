# Normies Builder

Monorepo for Normies Builder:

- `packages/web`: Next.js frontend for drawing a 40x40 Normies Canvas target.
- `packages/api`: standalone Bun API for finding candidate base Normies plus burn-action paths.

The API reads Normies mainnet state through RPC and uses OpenSea listing data for sale-aware ranking. This repo does not include Solidity or on-chain deployment tooling.

## Setup

```bash
bun install
cp packages/api/.env.example packages/api/.env
cp packages/web/.env.example packages/web/.env
```

Set `OPENSEA_API_KEY` in `packages/api/.env` for the default listed-base search mode. RPC can be configured with `ETH_RPC_URL`, `RPC_URL`, or `ALCHEMY_API_KEY`; otherwise the API falls back to a public RPC endpoint.

The web app reads `NEXT_PUBLIC_API_BASE_URL` from `packages/web/.env`. Local and production builds default to `https://normies-api.blockhash.xyz`.

## Fly API

The mining API runs as a small Fly.io app so Vercel does not execute the expensive route as a serverless function.

```bash
fly apps create normies-api
fly secrets set OPENSEA_API_KEY=... ETH_RPC_URL=...
fly deploy
```

The committed `fly.toml` deploys `packages/api`, runs one `shared-cpu-1x` machine with 1 GB RAM in `ord`, allows the machine to auto-stop, and exposes `/api/health` for checks.

After Fly is live, set these on the Vercel project:

```bash
NEXT_PUBLIC_API_BASE_URL=https://normies-api.blockhash.xyz
```

For a stricter CORS policy on Fly, also set:

```bash
fly secrets set API_ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app
```

Hosted API cost guards default to listed-token searches only, top 25 results, 100-token RPC batches, five OpenSea pages, 500 listed tokens, and 10 build requests per minute per client. OpenSea listings refresh automatically after the API cache TTL; leave `ALLOW_FULL_COLLECTION_SCAN` and `ALLOW_MANUAL_REFRESH` unset for public deployments.

## Vercel Web

For the Vercel project, set the Root Directory to `packages/web` so Vercel detects the Next.js app directly. The package also has a `vercel.json` with the Next.js framework preset.

If the Vercel project was imported from the repository root instead, the root `vercel.json` explicitly sets the framework to Next.js, runs `bun run build:web`, and points Vercel at `packages/web/.next`.

## Development

```bash
bun run dev
```

This starts the API on [http://127.0.0.1:3001](http://127.0.0.1:3001) and the web app on [http://127.0.0.1:3000](http://127.0.0.1:3000). The web app uses the hosted API by default; set `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001` in `packages/web/.env` if you need it to call the local API.

## Scripts

```bash
bun run typecheck
bun run build
```
