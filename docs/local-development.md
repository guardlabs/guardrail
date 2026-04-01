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
- `CONDUIT_PUBLIC_FRONTEND_URL` for the hosted frontend origin
- `CONDUIT_BACKEND_URL`
- `CONDUIT_BUNDLER_URL_84532` required for backend startup
- `CONDUIT_PUBLIC_RPC_URL_84532` required for backend startup
- `CONDUIT_PASSKEY_SERVER_URL`

Start Postgres and run migrations:

```bash
docker compose up -d postgres
pnpm db:migrate
```

`pnpm db:migrate` now applies the checked-in Drizzle migrations. The backend fails fast on startup if a supported chain is missing its RPC or bundler URL.

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

For hosted deployments, treat the frontend and backend as a pair. The official frontend is pinned to its configured backend; custom backends should ship with their own frontend deployment.

## Testing

Run the full workspace checks:

```bash
pnpm lint
pnpm format:check
pnpm knip
pnpm test
pnpm test:coverage
pnpm test:e2e:provisioning
pnpm typecheck
pnpm check
```

Run frontend checks only:

```bash
pnpm --filter @conduit/frontend test
pnpm --filter @conduit/frontend typecheck
pnpm --filter @conduit/frontend build
```

`pnpm test:coverage` runs coverage for the CLI, backend, frontend, shared packages, ZeroDev helpers, and the Vitest-based e2e workspace, then writes an aggregate summary to `coverage/combined-summary.json`.

`pnpm lint` runs ESLint across the workspace, `pnpm format:check` verifies Prettier formatting with double quotes preserved, `pnpm knip` reports unused files, exports, and dependencies, and `pnpm check` runs the full static validation stack in one command.

The headless provisioning e2e under `tests/e2e` runs the real CLI plus backend against Docker Postgres, an Anvil fork of Base Sepolia, a local Alto bundler, and a deterministic headless passkey owner.
