<h1 align="center">Conduit Wallet</h1>

<p align="center">
  Secure wallet rails for autonomous agents.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-10b981" alt="License: MIT" />
  <img src="https://img.shields.io/badge/status-pre--release-6b7280" alt="Status: pre-release" />
  <img src="https://img.shields.io/badge/chains-Base%20%2B%20Base%20Sepolia-0052FF" alt="Chains: Base and Base Sepolia" />
</p>

## Overview

Conduit Wallet is an EVM wallet flow for autonomous agents that avoids shipping a long-lived hot private key.

The human stays the owner through a passkey. The agent can still act autonomously, but only on the runtime path that Conduit is willing to co-sign under the wallet policy.

The hosted frontend serves both as the public homepage and the provisioning surface. The official hosted frontend is pinned to the official backend. If you deploy your own backend, deploy your own frontend with it.

## Quickstart

> These commands still use placeholder package and hosted URLs until the public deployment is finalized.

Create a wallet request with an official USDC budget limited to `$10` per trailing 24 hours.

The example below uses Base Sepolia for safe testing. The same flow also supports Base Mainnet with `--chain-id 8453` once production endpoints are configured:

```bash
npx @your-scope/conduit-wallet create \
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
https://app.example.com/?walletId=wal_xxx&token=token_xxx
```

Wait for readiness:

```bash
npx @your-scope/conduit-wallet await wal_xxx
```

Use the ready wallet:

```bash
npx @your-scope/conduit-wallet call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

In this example, Conduit counts the authorized USDC amount for official USDC `transfer`, `approve`, `increaseAllowance`, `Permit`, and `TransferWithAuthorization`. A `4` USDC transfer plus a `6` USDC permit fills the budget. Another `1` USDC action is denied until enough prior usage falls out of the trailing 24-hour window.

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

Conduit Wallet currently supports two chains:

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

For the full local flow, required environment variables, and testing commands, see [Local development](docs/local-development.md).

Before starting the backend, fill the per-chain RPC and bundler variables in `.env.local`. The backend now fails fast if those supported-chain runtime URLs are missing.

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
- `apps/frontend`: public homepage and provisioning UI for passkey setup
- `apps/cli`: CLI used by the agent to create, await, and use wallets
- `packages/shared`: shared contracts, schemas, chain metadata, and wallet config helpers
- `packages/zerodev`: ZeroDev and Kernel runtime helpers

## Status

This repository is still pre-deployment:

- the hosted URLs in examples are placeholders
- the npm package name is still a placeholder
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
- the `agent + backend` runtime path is where Conduit enforces policy
- the backend operator is trusted for policy enforcement and service availability
