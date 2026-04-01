# Local Development

[Docs index](README.md) | [CLI reference](cli.md) | [How it works](how-it-works.md)

## Prerequisites

- Node.js 22+
- `pnpm` 10+
- Docker
- [Foundry](https://book.getfoundry.sh/getting-started/installation) with `anvil` on your `PATH`

## Setup

Install dependencies:

```bash
pnpm install
```

Create a local env file:

```bash
cp .env.example .env.local
```

At minimum, review these variables in `.env.local`:

- `DATABASE_URL`
- `CONDUIT_PUBLIC_BACKEND_URL`
- `CONDUIT_PUBLIC_FRONTEND_URL`
- `CONDUIT_BACKEND_URL`
- `CONDUIT_BUNDLER_URL_84532`
- `CONDUIT_PUBLIC_RPC_URL_84532`
- `CONDUIT_PASSKEY_SERVER_URL`

Start Postgres and run migrations:

```bash
docker compose up -d postgres
pnpm db:migrate
```

Start the workspace:

```bash
pnpm dev
```

Useful local URLs:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3000`

Run apps individually if needed:

```bash
pnpm --filter @conduit/backend dev
pnpm --filter @conduit/frontend dev
pnpm --filter @conduit/cli dev -- --help
```

## Local End-To-End Flow

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

Open the returned provisioning URL in a browser, create the passkey, fund the wallet on Base Sepolia, then wait for readiness:

```bash
pnpm --filter @conduit/cli dev -- await wal_xxx \
  --backend-url http://localhost:3000
```

Local wallet state is stored under:

```text
~/.conduit/wallets
```

## Testing

Run the full workspace checks:

```bash
pnpm test
pnpm test:coverage
pnpm test:e2e:provisioning
pnpm typecheck
```

Run frontend checks only:

```bash
pnpm --filter @conduit/frontend test
pnpm --filter @conduit/frontend typecheck
pnpm --filter @conduit/frontend build
```

`pnpm test:coverage` runs coverage for the CLI, backend, frontend, shared packages, ZeroDev helpers, and the Vitest-based e2e workspace, then writes an aggregate summary to `coverage/combined-summary.json`.

The headless provisioning e2e under `tests/e2e` runs the real CLI plus backend against Docker Postgres, an Anvil fork of Base Sepolia, a local Alto bundler, and a deterministic headless passkey owner.
