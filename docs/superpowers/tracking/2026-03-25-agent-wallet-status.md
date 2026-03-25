# Agent Wallet Status

Date: 2026-03-25
Status: In progress
Owner: Codex + user

## Purpose

This document is the current implementation snapshot for the repo. It must be updated as work advances so the project can continue without relying on chat history.

## Source Documents

- Product design: `docs/superpowers/specs/2026-03-25-agent-wallet-design.md`
- Technical spec: `docs/superpowers/specs/2026-03-25-agent-wallet-technical-spec.md`
- Handoff brief: `docs/superpowers/tracking/2026-03-25-agent-wallet-handoff.md`

## Locked Decisions

- Monorepo shape is fixed for V1:
  - `apps/backend`
  - `apps/frontend`
  - `apps/cli`
  - `packages/shared`
- Frontend stack:
  - React
  - Vite
  - static app
  - no SSR
  - when implementing the real UI, use the local skills `frontend-skill` and `frontend-design`
- Backend stack:
  - Node.js
  - TypeScript
  - Fastify
  - PostgreSQL
  - Drizzle
- CLI stack:
  - Node.js
  - TypeScript
  - Commander
- Shared validation and schemas:
  - Zod
- Test runner:
  - Vitest
- CLI discoverability is mandatory:
  - `agent-wallet --help`
  - `agent-wallet <command> --help`
- Backend override contract is fixed:
  - CLI flag: `--backend-url`
  - CLI env: `AGENT_WALLET_BACKEND_URL`
  - frontend env: `AGENT_WALLET_DEFAULT_BACKEND_URL`
- Working implementation configuration:
  - chain remains request-scoped via CLI
  - Base Sepolia is the default local test chain
  - backend runs locally for now
  - bundler is Alchemy, chain-specific, and env-configured
  - local Base Sepolia bundler endpoint currently provided by the user
  - `AGENT_WALLET_MIN_FUNDING_WEI=500000000000000`

## Current Repo State

The following bootstrap work has been added:

- root workspace files:
  - `package.json`
  - `pnpm-workspace.yaml`
  - `turbo.json`
  - `tsconfig.base.json`
- `packages/shared`:
  - initial contracts
  - initial schemas
  - basic status transition helper
  - basic tests
- `apps/backend`:
  - Fastify app skeleton
  - health endpoints
  - basic health test
- `apps/frontend`:
  - Vite + React app skeleton
  - default backend URL wiring
- `apps/cli`:
  - Commander skeleton
  - `create`, `status`, `await`
  - `--help` support
  - backend URL resolution
  - basic help test

## Important Limitation

The repo has been bootstrapped, but the provisioning flow itself is not implemented yet.

Today the codebase contains:

- structure
- contracts
- help-capable CLI shell
- backend shell
- frontend shell

It does not yet contain:

- PostgreSQL persistence
- real wallet request lifecycle
- passkey flow
- funding checks
- ZeroDev or Kernel integration
- first-operation activation

## Verification State

Bootstrap verification has been completed once on 2026-03-25.

Verified successfully:

1. `pnpm install`
2. `pnpm build`
3. `pnpm test`
4. `pnpm --filter @agent-wallet/cli exec node dist/index.js --help`
5. `pnpm --filter @agent-wallet/backend dev` then `curl http://127.0.0.1:3000/health`
6. `pnpm --filter @agent-wallet/frontend dev` then `curl http://127.0.0.1:5173`

Verification result:

- dependency installation succeeded
- workspace build succeeded
- workspace tests succeeded
- CLI help output is available and includes the expected commands
- backend starts and serves `/health`
- frontend starts and serves the Vite app shell

## Next Recommended Work

1. Add backend config and PostgreSQL wiring.
2. Implement the first real wallet request endpoints.
3. Add shared request and response schemas for those endpoints.
4. Replace CLI placeholder output for `create` and `status` with real backend calls.
5. Implement the frontend provisioning route and request loading.
6. Keep tests minimal and aligned with the implemented V1 slice.

## Open Work Items

- choose the exact database migration flow for Drizzle
- define the first database-backed wallet request repository shape
- define the adapter translation from `{ credentialId, publicKey }` to the ZeroDev owner configuration

## Notes For Continuation

- Do not rely on chat history for project decisions. Update this file when a decision changes or a milestone is completed.
- Keep this file factual. It is a state snapshot, not a design discussion.
- The deleted file `docs/superpowers/plans/2026-03-25-agent-wallet-v1.md` existed before this bootstrap work and was intentionally left untouched.
