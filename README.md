<h1 align="center">Guardrail</h1>

<p align="center">
  Wallet guardrails for agents.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-10b981" alt="License: MIT" />
  <img src="https://img.shields.io/badge/status-pre--release-6b7280" alt="Status: pre-release" />
  <img src="https://img.shields.io/badge/chains-Base%20%2B%20Base%20Sepolia-0052FF" alt="Chains: Base and Base Sepolia" />
</p>

## Overview

Guardrail is the Guard Labs product for giving agents wallet access without shipping a long-lived hot private key.

The human stays the owner through a passkey. The agent can still act autonomously, but only on the runtime path that Guardrail is willing to co-sign under the wallet policy.

The hosted frontend at `https://guardlabs.ai` serves both as the public homepage and the provisioning surface. The official hosted frontend is pinned to the official backend. If you deploy your own backend, deploy your own frontend with it.

## Quickstart

> These commands use the published package name and the official Guard Labs domain shape.

Create a wallet request with an official USDC budget limited to `$10` per trailing 24 hours.

The example below uses Base Sepolia for safe testing. The same flow also supports Base Mainnet with `--chain-id 8453` once production endpoints are configured:

```bash
npx @guardlabs/guardrail-cli create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

This returns:

- a `walletId`
- a provisioning URL for the human owner
- local wallet state on disk
- the agent signer address

Share the provisioning URL with the human:

```text
https://guardlabs.ai/?walletId=wal_xxx&token=token_xxx
```

Wait for readiness:

```bash
npx @guardlabs/guardrail-cli await wal_xxx
```

Use the ready wallet:

```bash
npx @guardlabs/guardrail-cli call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

In this example, Guardrail counts the authorized USDC amount for official USDC `transfer`, `approve`, `increaseAllowance`, `Permit`, and `TransferWithAuthorization`. A `4` USDC transfer plus a `6` USDC permit fills the budget. Another `1` USDC action is denied until enough prior usage falls out of the trailing 24-hour window.

## Documentation

Detailed documentation lives under [`docs/`](docs/README.md):

- [Documentation index](docs/README.md)
- [Quickstart](docs/quickstart.md)
- [Runtime policy](docs/runtime-policy.md)
- [Use cases](docs/use-cases.md)
- [x402 payments](docs/x402.md)
- [How it works](docs/how-it-works.md)
- [CLI reference](docs/cli.md)
- [Local development](docs/local-development.md)

## Supported Chains

Guardrail currently supports two chains:

| Chain        | Chain ID | Status    |
| ------------ | -------- | --------- |
| Base         | `8453`   | Supported |
| Base Sepolia | `84532`  | Supported |

## Local Development

Prerequisites:

- Node.js 22+
- `pnpm` 10+
- Docker
- [Foundry](https://book.getfoundry.sh/getting-started/installation) with `anvil` on your `PATH` for the local e2e suite

Basic setup:

```bash
pnpm install
cp .env.example .env.local
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Useful local URLs:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3000`

The backend also ships with a production Dockerfile at `apps/backend/Dockerfile`. Build it from the repository root with:

```bash
docker build -f apps/backend/Dockerfile -t guardrail-backend .
```

The container runs the checked-in Drizzle migrations automatically before starting the backend server.

For the full local flow, required environment variables, and testing commands, see [Local development](docs/local-development.md).

Before starting the backend, fill the per-chain RPC and bundler variables in `.env.local`. The backend only requires URLs for chains listed in `GUARDRAIL_SUPPORTED_CHAIN_IDS`, and it fails fast if any enabled chain is missing its runtime URLs.

Coverage across the workspace test suites is available with:

```bash
pnpm test:coverage
```

Developer checks are available with:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm knip
pnpm check
```

## Repository Layout

- `apps/backend`: Fastify backend, wallet lifecycle, runtime policy enforcement, backend signing
- `apps/frontend`: public Guard Labs homepage and Guardrail provisioning UI
- `apps/cli`: CLI used by the agent to create, await, and use wallets
- `packages/shared`: shared contracts, schemas, chain metadata, and Guardrail config helpers
- `packages/zerodev`: Kernel and ZeroDev runtime helpers used by Guardrail

## Status

This repository is still pre-deployment:

- the CLI is published on npm as `@guardlabs/guardrail-cli`
- the official hosted frontend domain is `https://guardlabs.ai`
- the intended official backend domain is `https://api.guardlabs.ai`
- Base and Base Sepolia are supported
- runtime policy is intentionally narrow and deny-by-default on the agent runtime path

## Deployment Model

- the official frontend is paired with the official backend
- provisioning links no longer carry a backend override parameter
- if you self-host the backend, self-host the frontend too

## Signer Trust Model

- the human passkey is the durable owner path
- the local agent key alone is not enough to use the runtime path
- the backend signer key alone is not enough to use the runtime path
- the `agent + backend` runtime path is where Guardrail enforces policy
- the backend operator is trusted for policy enforcement and service availability
