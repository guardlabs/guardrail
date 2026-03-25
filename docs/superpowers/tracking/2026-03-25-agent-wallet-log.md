# Agent Wallet Log

## 2026-03-25

### Baseline

- Read the approved design document.
- Produced a technical spec aligned with the design.
- Simplified the monorepo target to the strict V1 shape:
  - `apps/backend`
  - `apps/frontend`
  - `apps/cli`
  - `packages/shared`
- Locked the default stack choices:
  - frontend: React + Vite
  - backend: Node.js + Fastify + PostgreSQL + Drizzle
  - cli: Node.js + Commander
  - shared: Zod
  - tests: Vitest

### CLI Contract

- Locked `--help` as a mandatory CLI feature.
- Locked the backend override contract:
  - `--backend-url`
  - `AGENT_WALLET_BACKEND_URL`
  - `AGENT_WALLET_DEFAULT_BACKEND_URL`

### Frontend Constraint

- Locked that the real frontend implementation must explicitly use the local skills `frontend-skill` and `frontend-design`.

### Runtime Configuration

- Locked that the requested chain remains CLI-provided and request-scoped.
- Locked Base Sepolia as the default local test chain.
- Locked local backend use for now until a domain exists.
- Locked Alchemy as the bundler provider with chain-specific env-based configuration.
- Recorded the current Base Sepolia bundler endpoint provided by the user for local testing.
- Locked `AGENT_WALLET_MIN_FUNDING_WEI=500000000000000` as the current working threshold.

### Bootstrap

- Added workspace root files.
- Added `packages/shared` with initial runtime schemas and helpers.
- Added `apps/backend` skeleton with health endpoints.
- Added `apps/frontend` skeleton with default backend URL wiring.
- Added `apps/cli` skeleton with Commander commands and help.
- Added basic tests for shared logic, backend health, and CLI help.
- Added a handoff document for future agents to continue from repo state only.

### Pending

- Business flow implementation still pending.

### Verification

- Ran `pnpm install` successfully.
- Fixed root workspace metadata by adding `packageManager` to the root `package.json`.
- Fixed a TypeScript issue in `packages/shared` status transition typing.
- Fixed the CLI entrypoint so tests can import the command builder without triggering `process.exit`.
- Ran `pnpm build` successfully.
- Ran `pnpm test` successfully.
- Verified CLI help manually with `pnpm --filter @agent-wallet/cli exec node dist/index.js --help`.
- Verified backend manually by starting it and requesting `/health`.
- Verified frontend manually by starting Vite and requesting the served HTML shell.

## How To Use This Log

- Add a dated entry whenever meaningful work lands.
- Record what changed, what was verified, and what remains blocked.
- Keep it short and operational.
