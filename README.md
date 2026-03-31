<h1 align="center">Conduit Wallet</h1>

<p align="center">
  Secure wallet rails for autonomous agents.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-10b981" alt="License: MIT" />
  <img src="https://img.shields.io/badge/status-pre--release-6b7280" alt="Status: pre-release" />
  <img src="https://img.shields.io/badge/chain-Base%20Sepolia-0052FF" alt="Chain: Base Sepolia" />
</p>

## 🧭 Overview

Conduit Wallet is an EVM wallet for autonomous agents that avoids storing a long-lived EOA private key on disk, where it can leak.

It lets an agent trigger actions autonomously while staying secure because Conduit can enforce runtime policies and a leaked agent key is not enough to drain the wallet.

The human stays the end owner through a passkey.

For more detail, see [How It Works](#how-it-works).

## 🚀 Quickstart

> These commands use placeholders for the future public deployment. Replace them with your real package name and hosted URLs once they exist.
>
> The published CLI is expected to use the hosted backend by default, so the examples below do not pass `--backend-url`.

Create a wallet request:

```bash
npx @your-scope/conduit-wallet create \
  --chain-id 84532
```

The command returns:

- a `walletId`
- a provisioning URL for the human
- local wallet state stored on disk
- the agent signer address

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

Build an x402 `PAYMENT-SIGNATURE` header for an `exact/eip3009` challenge using the ready Conduit wallet signer:

```bash
npx @your-scope/conduit-wallet x402-sign wal_xxx \
  --payment-required-header eyJ4NDAyVmVyc2lvbiI6Mn0=
```

This command deploys the wallet if needed, then signs `TransferWithAuthorization` through the Conduit smart wallet path, including backend co-signing.

Fetch a resource and automatically complete the x402 challenge when needed:

```bash
npx @your-scope/conduit-wallet x402-fetch wal_xxx \
  https://api.example.com/premium-data
```

<a id="how-it-works"></a>

## 🔄 How It Works

Conduit Wallet is designed so an agent can act autonomously without controlling a fully privileged wallet key.

The ownership model is split:

- the human stays the owner through a passkey
- the agent can trigger actions on its own
- Conduit must still approve runtime actions before they execute

In normal operation, the human is only needed for the initial wallet setup and later policy changes, not for each transaction. Conduit is the place where runtime policies are enforced, such as which contracts the agent may call, which methods are allowed, and how much value can be moved over time.

This is what makes the model safer than giving the agent a hot EOA key. If the agent key leaks, that key alone is still not enough to drain the wallet or execute arbitrary actions. It can only be used for actions that Conduit is willing to co-sign under the configured policy.

A wallet can be created with policies from the start, such as target contracts or spending limits. That means an autonomous agent or skill can request a dedicated wallet for a specific task, tell the human to fund it, and then use that wallet autonomously within those predefined constraints without any risk.

The high-level flow is:

1. The CLI creates a wallet request and generates an agent key locally.
2. The backend creates a matching Conduit co-signer and returns a provisioning link.
3. A human opens the hosted frontend, creates a passkey, and becomes the wallet owner.
4. Once the wallet is ready, the agent can trigger actions autonomously.
5. Each runtime action still requires Conduit approval before it is executed.

<a id="technical-design"></a>

## 🛠️ Technical Design

Conduit Wallet currently builds on [Kernel](https://github.com/zerodevapp/kernel), the modular ERC-4337 smart account, and uses [ZeroDev](https://zerodev.app/) plus the [ZeroDev SDK](https://docs.zerodev.app/) for provisioning and validator integration.

The wallet uses two validator layers:

- a human passkey as the `sudo` validator, created in the browser with ZeroDev's [passkey flow](https://docs.zerodev.app/sdk/permissions/signers/passkeys)
- a weighted ECDSA validator for runtime use, implemented with ZeroDev's [multisig signer tooling](https://docs.zerodev.app/sdk/permissions/signers/multisig)

In the current setup, the runtime validator is a `2-of-2` weighted signer set: one key for the agent and one key for the Conduit backend, each with weight `1` and a threshold of `2`.

That means:

- runtime operations require both signatures
- the passkey remains the human-controlled admin path
- the backend co-signer is the place where Conduit can enforce policies before approving agent-triggered transactions

Runtime policy is opinionated and deny-by-default on the `agent + backend` path:

- the passkey keeps full admin access and does not go through backend policy checks
- the backend only co-signs calls that were explicitly attached to the wallet request at creation time
- generic runtime calls use a strict `contract address + method selector` allowlist
- official USDC uses a dedicated policy with an explicit operation allowlist and a daily, weekly, or monthly budget
- typed data are denied by default unless they match an explicitly supported official USDC flow such as `Permit` or `TransferWithAuthorization`

The provisioning frontend shows the attached runtime policy before the human creates the passkey owner.

The current implementation targets Base Sepolia.

## ⛓️ Supported Chains

Conduit Wallet currently supports a single chain:

| Chain | Chain ID | Status | Notes |
| --- | --- | --- | --- |
| Base Sepolia | `84532` | Supported | Primary development and testing network |

Chain support is defined centrally in the shared package and is currently limited to Base Sepolia.

## 💻 Local Development

### ✅ Prerequisites

- Node.js 22+
- `pnpm` 10+
- Docker
- [Foundry](https://book.getfoundry.sh/getting-started/installation) with `anvil` on your `PATH` for the local e2e suite

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

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

### 3. Start Postgres

```bash
docker compose up -d postgres
```

### 4. Run Database Migrations

```bash
pnpm db:migrate
```

### 5. Start the Workspace

Run the full workspace:

```bash
pnpm dev
```

This starts the monorepo dev processes through Turbo.

Run each app individually if needed:

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

- frontend: `http://localhost:5173`
- backend: `http://localhost:3000`

### 🔄 Local End-to-End Flow

Create a wallet request locally:

```bash
pnpm --filter @conduit/cli dev -- create \
  --chain-id 84532 \
  --allow-call '0x1111111111111111111111111111111111111111:0xdeadbeef' \
  --usdc-period daily \
  --usdc-max 25 \
  --usdc-allow transferWithAuthorization \
  --backend-url http://localhost:3000
```

The runtime policy is required. Provide at least one of:

- `--allow-call <address>:<methodOrSelector>[,<methodOrSelector>...]` for non-USDC calls
- `--usdc-period`, `--usdc-max`, and `--usdc-allow` together for official USDC

Notes:

- `--allow-call` accepts either raw `0x` selectors or Solidity signatures such as `'0x1111...:approve(address,uint256)'`
- the official USDC contract is reserved for `--usdc-*` options and is rejected from the generic allowlist
- native `ETH` value is not allowed on the `agent + backend` runtime path in this version

Open the returned provisioning URL in a browser, create the passkey, fund the wallet on Base Sepolia, then wait for readiness:

```bash
pnpm --filter @conduit/cli dev -- await wal_xxx \
  --backend-url http://localhost:3000
```

Local wallet state is stored under:

```text
~/.conduit/wallets
```

## 🧪 Testing and Typechecking

Run the whole workspace:

```bash
pnpm test
pnpm test:e2e:provisioning
pnpm typecheck
```

Run individual package test commands:

```bash
pnpm --filter @conduit/backend test
pnpm --filter @conduit/frontend test
pnpm --filter @conduit/cli test
pnpm --filter @conduit/shared test
pnpm --filter @conduit/zerodev test
```

The headless provisioning e2e lives under `tests/e2e` and runs the real CLI plus backend against:

- Docker Postgres
- an Anvil fork of Base Sepolia
- a local Alto bundler for ERC-4337 user operations
- a deterministic headless passkey owner

It covers the flow through `ready`, then exercises:

- deployment through the dedicated backend deploy route
- one allowlisted co-signed transaction
- one denied transaction rejected by the backend policy
- one denied arbitrary typed-data signature
- one successful `conduit-wallet x402-fetch ...` round-trip using exact EIP-3009 settlement on official Base Sepolia USDC
- one denied x402 round-trip after the configured USDC budget is exhausted

Before running it, make sure either `CONDUIT_E2E_FORK_URL` or `CONDUIT_PUBLIC_RPC_URL_84532` points to a Base Sepolia RPC URL. The test starts its own backend, Anvil, and Alto processes locally.

Run individual package typecheck commands:

```bash
pnpm --filter @conduit/backend typecheck
pnpm --filter @conduit/frontend typecheck
pnpm --filter @conduit/cli typecheck
pnpm --filter @conduit/shared typecheck
pnpm --filter @conduit/zerodev typecheck
```

## 🗂️ Repository Layout

- `apps/backend`: Fastify backend, wallet request lifecycle, backend signing, chain relays, Postgres persistence
- `apps/frontend`: provisioning UI used by the human operator to create the passkey owner
- `apps/cli`: CLI used by the agent to create, await, and use wallets
- `packages/shared`: shared contracts, schemas, chain metadata, and wallet config helpers
- `packages/zerodev`: ZeroDev and Kernel runtime helpers for provisioning and execution

## 🚧 Current Status

This repository is still pre-deployment:

- the hosted URLs in this README are placeholders
- the npm package name is a placeholder
- the repository badges are intentionally static until the public repo and package coordinates are finalized
- Base Sepolia is the only supported chain
- runtime policy is intentionally narrow and opinionated in this version:
  - non-USDC calls require an explicit contract + selector allowlist
  - official USDC is supported only through the dedicated USDC policy
  - typed data are denied except for explicitly supported official USDC flows
