# Agent Wallet Handoff

Use this file to resume implementation without relying on chat history.

## Read First

Before making any change, read these files in this order:

1. `docs/superpowers/specs/2026-03-25-agent-wallet-design.md`
2. `docs/superpowers/specs/2026-03-25-agent-wallet-technical-spec.md`
3. `docs/superpowers/tracking/2026-03-25-agent-wallet-status.md`
4. `docs/superpowers/tracking/2026-03-25-agent-wallet-log.md`

## Mission

Continue the implementation of `agent-wallet` from the current repository state only.

Do not assume any external context beyond the files in this repo.

## Locked Constraints

These decisions are already fixed and must not be changed unless the repo documents are explicitly updated first:

- V1 monorepo shape:
  - `apps/backend`
  - `apps/frontend`
  - `apps/cli`
  - `packages/shared`
- Frontend stack:
  - React
  - Vite
  - static app
  - no SSR
  - when implementing the real frontend UI, use the local skills `frontend-skill` and `frontend-design`
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
- Shared schemas and validation:
  - Zod
- Test runner:
  - Vitest

## CLI Contract

The CLI must remain agent-friendly.

Mandatory requirements:

- `agent-wallet --help`
- `agent-wallet <command> --help`
- concise and stable help output
- command and flag names are part of the V1 contract

Backend override contract:

- CLI flag: `--backend-url`
- CLI env: `AGENT_WALLET_BACKEND_URL`
- frontend env: `AGENT_WALLET_DEFAULT_BACKEND_URL`

Working implementation configuration:

- chain remains request-scoped via CLI
- Base Sepolia is the default local test chain
- backend runs locally for now
- bundler is Alchemy, chain-specific, and env-configured
- local Base Sepolia bundler endpoint has been provided by the user and must not be committed into persistent runtime config
- `AGENT_WALLET_MIN_FUNDING_WEI=500000000000000`

## Scope Rules

- Do not expand the V1 feature scope.
- Do not introduce additional optional packages.
- Implement only the features already described in the design and technical spec.
- Keep the monorepo minimal.
- Do not implement the final frontend UI without explicitly using the local skills `frontend-skill` and `frontend-design`.

## Required Working Method

1. Inspect the current repo state.
2. Verify the actual build and test state.
3. Pick the next smallest useful V1 increment.
4. Implement it end to end.
5. Update the tracking documents before finishing.

## Tracking Requirement

These files are the project memory and must be kept current:

- `docs/superpowers/tracking/2026-03-25-agent-wallet-status.md`
- `docs/superpowers/tracking/2026-03-25-agent-wallet-log.md`

Update them whenever:

- a technical decision is locked
- a meaningful implementation step lands
- verification is run
- a blocker is found

## Immediate Next Step

Unless the tracking files say otherwise, start here:

1. run dependency installation
2. run build and test
3. fix bootstrap issues
4. implement the next smallest real provisioning slice

## Definition Of Done For A Step

Before claiming a step is complete:

- code is updated
- relevant tests are added or adjusted
- verification commands are run
- `status.md` reflects the current repo state
- `log.md` records what changed and what was verified
