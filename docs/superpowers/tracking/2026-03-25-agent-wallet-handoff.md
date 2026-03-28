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
- `AGENT_WALLET_PASSKEY_SERVER_URL=https://passkeys.zerodev.app/api/v3/ec78db7a-024e-42b8-a404-d78986033fca`
- `AGENT_WALLET_MIN_FUNDING_WEI=500000000000000`
- backend and CLI autoload root `.env.local`, then root `.env`, through `dotenv`
- frontend Vite config resolves root `.env.local` and root `.env` from the monorepo root
- the root `.env.local` is the single local-development env file for the monorepo
- CLI local env usage is intentionally limited to `AGENT_WALLET_BACKEND_URL` as an optional convenience override
- backend status model is simplified to `created`, `owner_bound`, `ready`, `failed`
- persisted owner artifacts are minimal: `{ credentialId, publicKey }`
- backend runtime requires `DATABASE_URL`; there is no in-memory fallback
- backend SQL migration exists and local PostgreSQL runtime has been verified
- backend funding checks currently use `AGENT_WALLET_PUBLIC_RPC_URL_<chainId>` with `AGENT_WALLET_BUNDLER_URL_<chainId>` as fallback
- the durable orchestration identifier is `walletId`, not `requestId`
- backend API uses `/v1/wallets/...`
- supported-chain metadata lives in `packages/shared/src/chains.ts`
- backend, frontend, and CLI must treat that shared chain registry as the single source of truth
- `GET /v1/wallets/:walletId` is a pure read
- `POST /v1/wallets/:walletId/refresh-funding` is the explicit funding recheck path
- frontend polls funding refresh every 5 seconds while the wallet is `owner_bound`
- CLI `await` refreshes funding every 5 seconds by default once the wallet is `owner_bound`
- CLI `create` output includes structured `nextSteps` guidance for agent callers
- `create.nextSteps` must explicitly tell the agent to send the human to `provisioningUrl`, then rerun CLI `status` to obtain the wallet address before asking for funding
- CLI `await` emits an immediate waiting message before entering the poll loop
- `agent-wallet call` is the post-`ready` path that hydrates the local permission account and submits the first permitted user operation
- the first permitted `call` is the place where the wallet is effectively deployed on-chain if it is still counterfactual
- `agent-wallet call` must supply standard fee estimation for user operations so Alchemy bundlers work without ZeroDev-specific RPC methods
- CLI no longer requires direct `AGENT_WALLET_PUBLIC_RPC_URL_<chainId>` or `AGENT_WALLET_BUNDLER_URL_<chainId>` configuration
- backend now exposes `POST /v1/chains/:chainId/rpc` and `POST /v1/chains/:chainId/bundler` as proxy transports for CLI runtime hydration and calls
- frontend design context is fixed:
  - audience: non-developers and users with limited Web3 familiarity
  - use case: securely grant an autonomous agent limited wallet rights
  - tone: reassuring, high-tech, simple, and secure

## Scope Rules

- Do not expand the V1 feature scope.
- Do not introduce additional optional packages.
- Implement only the features already described in the design and technical spec.
- Keep the monorepo minimal.
- Do not implement the final frontend UI without explicitly using the local skills `frontend-skill` and `frontend-design`.
- The current runtime now imports and uses ZeroDev or Kernel SDKs in the frontend and CLI; do not regress that to a fake or deterministic substitute.

## Required Working Method

1. Inspect the current repo state.
2. Verify the actual build and test state.
3. Read `docs/superpowers/plans/2026-03-25-agent-wallet-v1-completion.md`.
4. Pick the next smallest useful V1 increment.
5. Implement it end to end.
6. Update the tracking documents before finishing.

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

1. run build and test
2. verify the live `create` and `status` flow if needed
3. use the already-verified Base Sepolia manual flow as the regression path:
   - create a wallet against a real contract and authorized selector
   - complete browser passkey provisioning
   - fund until `ready`
   - run `agent-wallet call`
   - confirm deployed bytecode with `eth_getCode`
4. continue with hardening or operator guidance only if still needed

## Definition Of Done For A Step

Before claiming a step is complete:

- code is updated
- relevant tests are added or adjusted
- verification commands are run
- `status.md` reflects the current repo state
- `log.md` records what changed and what was verified
