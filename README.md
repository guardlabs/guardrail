<h1 align="center">Conduit Wallet</h1>

<p align="center">
  Secure wallet rails for autonomous agents.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-10b981" alt="License: MIT" />
  <img src="https://img.shields.io/badge/status-pre--release-6b7280" alt="Status: pre-release" />
  <img src="https://img.shields.io/badge/chain-Base%20Sepolia-0052FF" alt="Chain: Base Sepolia" />
  <img src="https://img.shields.io/badge/runtime-Node.js%2022%2B-339933" alt="Runtime: Node.js 22+" />
  <img src="https://img.shields.io/badge/package%20manager-pnpm%2010-F69220" alt="Package manager: pnpm 10" />
</p>

It combines three actors:
- a human passkey used during wallet provisioning,
- an agent-held key used by the CLI at runtime,
- a backend co-signer that is intended to enforce wallet policies.

Conduit is the brand. Conduit Wallet is the wallet product built on top of it.

Today, the repository already covers wallet provisioning, backend-assisted co-signing, local agent runtime, and a small provisioning frontend. Policy enforcement by the backend is the next major step.

## How It Works

1. The CLI creates a wallet request and generates an agent key locally.
2. The backend creates a matching backend signer and returns a provisioning link.
3. A human opens the hosted frontend, creates a passkey, and binds the wallet.
4. Once funded and ready, the CLI can use the wallet to send transactions or sign typed data.

The current implementation targets Base Sepolia.

## Supported Chains

Conduit Wallet currently supports a single chain:

| Chain | Chain ID | Status | Notes |
| --- | --- | --- | --- |
| Base Sepolia | `84532` | Supported | Primary development and testing network |

Chain support is defined centrally in the shared package and is currently limited to Base Sepolia.

## Hosted Usage

These commands use placeholders for the future public deployment. Replace them with your real package name and hosted URLs once they exist.

The published CLI is expected to use the hosted backend by default, so the examples below do not pass `--backend-url`.

```bash
npx @your-scope/conduit-wallet create \
  --chain-id 84532
```

The command returns:
- a `walletId`,
- a provisioning URL for the human,
- local wallet state stored on disk,
- the agent signer address.

Share the provisioning URL with the human operator:

```text
https://app.example.com/?walletId=wal_xxx&token=token_xxx
```

Check wallet status:

```bash
npx @your-scope/conduit-wallet status wal_xxx
```

Wait until the wallet is fully ready:

```bash
npx @your-scope/conduit-wallet await wal_xxx
```

Send a transaction from a ready wallet:

```bash
npx @your-scope/conduit-wallet call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

Sign EIP-712 typed data:

```bash
npx @your-scope/conduit-wallet sign-typed-data wal_xxx \
  --typed-data-file ./typed-data.json
```

## Local Development

### Prerequisites

- Node.js 22+
- `pnpm` 10+
- Docker

### Install

```bash
pnpm install
```

### Environment

Create a local env file from the example:

```bash
cp .env.example .env.local
```

At minimum, check these values in `.env.local`:

- `DATABASE_URL`
- `CONDUIT_PUBLIC_BACKEND_URL`
- `CONDUIT_PUBLIC_FRONTEND_URL`
- `CONDUIT_BACKEND_URL`
- `CONDUIT_BUNDLER_URL_84532`
- `CONDUIT_PUBLIC_RPC_URL_84532`
- `CONDUIT_PASSKEY_SERVER_URL`

The backend needs chain-specific RPC and bundler URLs. The frontend needs a passkey server URL.

### Start Postgres

```bash
docker compose up -d postgres
```

### Run Database Migrations

```bash
pnpm db:migrate
```

### Run the Full Workspace

```bash
pnpm dev
```

This starts the monorepo dev processes through Turbo.

### Run Each App Individually

Backend:

```bash
pnpm --filter @conduit/backend dev
```

Frontend:

```bash
pnpm --filter @conduit/frontend dev
```

CLI:

```bash
pnpm --filter @conduit/cli dev -- --help
```

Useful local URLs:

- frontend: `http://127.0.0.1:5173`
- backend: `http://127.0.0.1:3000`

### Local End-to-End Flow

Create a wallet request locally:

```bash
pnpm --filter @conduit/cli dev -- create \
  --chain-id 84532 \
  --backend-url http://127.0.0.1:3000
```

Open the returned provisioning URL in a browser, create the passkey, fund the wallet on Base Sepolia, then wait for readiness:

```bash
pnpm --filter @conduit/cli dev -- await wal_xxx \
  --backend-url http://127.0.0.1:3000
```

Local wallet state is stored under:

```text
~/.conduit/wallets
```

## Testing and Typechecking

Run the whole workspace:

```bash
pnpm test
pnpm typecheck
```

Run individual packages:

```bash
pnpm --filter @conduit/backend test
pnpm --filter @conduit/frontend test
pnpm --filter @conduit/cli test
pnpm --filter @conduit/shared test
pnpm --filter @conduit/zerodev test
```

```bash
pnpm --filter @conduit/backend typecheck
pnpm --filter @conduit/frontend typecheck
pnpm --filter @conduit/cli typecheck
pnpm --filter @conduit/shared typecheck
pnpm --filter @conduit/zerodev typecheck
```

## Repository Layout

- `apps/backend`: Fastify backend, wallet request lifecycle, backend signing, chain relays, Postgres persistence
- `apps/frontend`: provisioning UI used by the human operator to create the passkey owner
- `apps/cli`: CLI used by the agent to create, await, and use wallets
- `packages/shared`: shared contracts, schemas, chain metadata, and wallet config helpers
- `packages/zerodev`: ZeroDev and Kernel runtime helpers for provisioning and execution

## Current Status

This repository is still pre-deployment:

- the hosted URLs in this README are placeholders,
- the npm package name is a placeholder,
- the repository badges are intentionally static until the public repo and package coordinates are finalized,
- Base Sepolia is the only supported chain,
- backend policy enforcement is planned and not fully implemented yet.
