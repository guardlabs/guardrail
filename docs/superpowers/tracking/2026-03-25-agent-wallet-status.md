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
  - `AGENT_WALLET_PASSKEY_SERVER_URL=https://passkeys.zerodev.app/api/v3/ec78db7a-024e-42b8-a404-d78986033fca`
  - `AGENT_WALLET_MIN_FUNDING_WEI=500000000000000`
  - local root `.env.local` is supported for backend, CLI, and frontend local runtime configuration
  - the root `.env.local` remains the single local-development env file for the monorepo
  - CLI local env usage is limited to `AGENT_WALLET_BACKEND_URL` as an optional convenience override
  - backend status model is simplified to `created`, `owner_bound`, `ready`, `failed`
  - persisted owner artifacts are minimal: `{ credentialId, publicKey }`
  - the durable orchestration identifier is now `walletId` everywhere
  - HTTP API uses `/v1/wallets/...`
- Frontend design context is fixed for the real provisioning UI:
  - audience: non-developers and users with limited Web3 familiarity
  - use case: securely grant an autonomous agent limited wallet rights
  - tone: reassuring, high-tech, simple, and secure

## Current Repo State

The following work is implemented:

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
  - shared response and local-store schemas renamed from `requestId` to `walletId`
- `apps/backend`:
  - Fastify app skeleton
  - health endpoints
  - `POST /v1/wallets`
  - `GET /v1/wallets/:walletId`
  - `POST /v1/chains/:chainId/rpc`
  - `POST /v1/chains/:chainId/bundler`
  - `GET /v1/provisioning/:walletId?t=...`
  - `POST /v1/provisioning/:walletId/owner-artifacts?t=...`
  - PostgreSQL repository wiring with Drizzle
  - `DATABASE_URL` required at runtime
  - SQL migration script
  - SQL table renamed to `wallets` with `wallet_id` primary key
  - wallet finalization service that accepts the real frontend-produced counterfactual address and serialized permission account
  - funding check against chain RPC or bundler RPC
  - explicit funding refresh endpoint at `POST /v1/wallets/:walletId/refresh-funding`
  - wallet context generation and persistence
  - verified live runtime against local PostgreSQL
  - health and wallet tests
  - root `.env.local` and `.env` autoload at runtime and migration entrypoints
- `apps/frontend`:
  - Vite + React provisioning UI
  - provisioning-link parsing
  - backend request loading
  - browser passkey creation through ZeroDev passkey flow
  - ZeroDev permission validator and Kernel account preparation
  - owner-artifact publication
  - funding-wait state after owner binding
  - automatic funding refresh polling every 5 seconds while `owner_bound`
  - funding and ready-state rendering
  - Vite node polyfills required for browser-side ZeroDev SDK compatibility
  - Vite config reads root `.env.local` and root `.env` from the monorepo root
- `apps/cli`:
  - Commander-based commands
  - `create`, `status`, `await`, `call`
  - `--help` support
  - backend URL resolution
  - local session key generation
  - local wallet store
  - real ZeroDev permission-account hydration on `await`
  - real ZeroDev or Kernel first-call submission via `call`
  - Alchemy-compatible fee estimation for Kernel user operations
  - funding refresh on `await` when a request is `owner_bound`
  - immediate waiting message on `await` start
  - structured `nextSteps` guidance in `create` output for agent callers
  - `create` explicitly tells the agent to send the human to `provisioningUrl`, then call CLI `status` again to obtain the wallet address
  - live backend calls for `create` and `status`
  - help and command tests
  - root `.env.local` and `.env` autoload at CLI entrypoint

## Important Limitation

The runtime implementation now uses ZeroDev and Kernel where V1 needs them, and the main end-to-end path has been manually exercised.

Remaining limits are now narrower:

- runtime currently supports Base Sepolia only in the CLI wallet hydration path
- the first live call path has been verified against one concrete authorized contract method, not against a wider matrix of targets or permission shapes

## Verification State

Verification has been re-run after the real ZeroDev or Kernel integration on 2026-03-25.

Verified successfully:

1. `pnpm install`
2. `pnpm build`
3. `pnpm test`
4. `pnpm --filter @agent-wallet/cli exec node dist/index.js --help`
5. `DATABASE_URL=... pnpm --filter @agent-wallet/backend dev` then `curl http://127.0.0.1:3000/health`
6. `pnpm --filter @agent-wallet/frontend dev` then `curl http://127.0.0.1:5173`
7. `pnpm --filter @agent-wallet/cli exec node dist/index.js create ...`
8. `pnpm --filter @agent-wallet/cli exec node dist/index.js status <wallet-id> ...`
9. `DATABASE_URL=... pnpm db:migrate`
10. runtime backend + CLI `create/status` verified against local PostgreSQL
11. runtime backend + provisioning resolve + owner-artifacts publication verified against local PostgreSQL
12. funding check verified live against Base Sepolia RPC using the configured chain endpoint
13. frontend Vitest coverage for provisioning load, invalid links, and owner binding
14. `pnpm --filter @agent-wallet/shared build`
15. `pnpm --filter @agent-wallet/backend build`
16. `pnpm --filter @agent-wallet/cli build`
17. `pnpm --filter @agent-wallet/frontend build`
18. real CLI Kernel hydration verified in unit tests against ZeroDev or Kernel serialization boundaries
19. live CLI `create` and `status` re-verified against the current backend build
20. `pnpm db:migrate` verified with only a temporary root `.env.local` and no exported shell variables
21. CLI entrypoint verified to read `AGENT_WALLET_BACKEND_URL` from a temporary root `.env.local`
22. frontend build verified with `AGENT_WALLET_PASSKEY_SERVER_URL` and chain RPC settings coming only from a temporary root `.env.local`
23. backend test coverage for `POST /v1/wallets/:walletId/refresh-funding`
24. frontend test coverage for funding-wait state and automatic polling after owner binding
25. CLI test coverage for `await` triggering backend funding refresh
26. CLI and frontend HTTP helpers verified not to send `content-type: application/json` on body-less `POST /refresh-funding` calls
27. CLI `create` output includes structured `nextSteps` guidance for agents
28. CLI `await` emits an immediate waiting message before polling
29. CLI `create` guidance explicitly covers the human provisioning step and the follow-up CLI call to obtain the wallet address
30. CLI `call` builds successfully, is covered by unit tests, and submits the first permitted user operation through the hydrated Kernel client
31. CLI Kernel client now overrides user-operation fee estimation so `call` works with an Alchemy bundler instead of requiring ZeroDev-specific `zd_getUserOperationGasPrice`
32. manual browser passkey provisioning was exercised end to end against the live local stack
33. live `agent-wallet call` succeeded on Base Sepolia against USDC `approve(address,uint256)` for wallet `wal_c700ae7d9b64436c9dcac2456e4172cc`
34. post-call `eth_getCode` for wallet `0x1144ff65e1407C7e8766bbAcB5dB37FbD79a8994` returned deployed bytecode, confirming the first permitted call deployed the counterfactual wallet on-chain
35. request-centric naming was refactored to wallet-centric naming across contracts, CLI, frontend, backend routes, and SQL schema
36. full workspace verification passed after the `walletId` and `/v1/wallets` refactor

Verification result:

- dependency installation succeeded
- workspace build succeeded
- workspace tests succeeded
- CLI help output is available and includes the expected commands
- backend starts and serves `/health` when `DATABASE_URL` is set
- frontend starts and serves the Vite app shell
- CLI can create a wallet against the live backend
- CLI can read wallet status from the live backend
- backend migrations can be applied to local PostgreSQL
- backend create and status flow has been verified against PostgreSQL persistence
- backend owner binding can accept a real ZeroDev-prepared wallet address and serialized permission account, compute funding state, and persist wallet context
- frontend can load a provisioning link, prepare a real passkey-backed Kernel permission account, and publish the minimal public artifacts plus approval payload to the backend
- CLI can reconstruct the ready permission account locally from the serialized approval and the stored session private key
- live owner-artifact publication currently still depends on a manual browser passkey interaction to be exercised end to end outside tests
- backend, CLI, and frontend local runtime can bootstrap configuration from a non-committed root `.env.local` without manual shell exports
- `await` now rechecks funding every `5000ms` by default once a request reaches `owner_bound`
- CLI can hydrate a ready wallet locally and submit the first permitted contract call, which is the path that deploys the wallet on first use if needed
- manual provisioning and first permitted on-chain call have now both been exercised successfully against the real local stack plus Base Sepolia
- the Alchemy bundler path now works because CLI `call` supplies standard EIP-1559 fee estimates instead of relying on ZeroDev-only bundler RPC methods
- CLI no longer requires local chain RPC or bundler env vars; it now reaches both through backend proxy endpoints derived from the stored backend URL
- backend proxy transport was re-validated live: `agent-wallet call` succeeded against Base Sepolia through `/v1/chains/84532/rpc` and `/v1/chains/84532/bundler`, returning transaction hash `0xe2203902730242b8d18da7f69509c702f2dfe4d737ca98bd26e7babe257bd01e`

## Next Recommended Work

1. Add a small operator guide for required env vars and the manual provisioning plus first-call flow.
2. Expand manual validation to at least one additional authorized contract method if broader confidence is needed.
3. Generalize runtime chain support beyond Base Sepolia only if V1 now needs it.

## Open Work Items

- choose the exact database migration flow for Drizzle
- decide whether `AGENT_WALLET_PUBLIC_RPC_URL_<chainId>` remains the stable env contract for both frontend and backend runtime
- decide whether the frontend should support more than Base Sepolia in V1 UI runtime or whether Base Sepolia-only runtime support is acceptable for the first shipped version

## Notes For Continuation

- Do not rely on chat history for project decisions. Update this file when a decision changes or a milestone is completed.
- Keep this file factual. It is a state snapshot, not a design discussion.
- The execution plan for the remaining V1 delta lives in `docs/superpowers/plans/2026-03-25-agent-wallet-v1-completion.md`.
- The deleted file `docs/superpowers/plans/2026-03-25-agent-wallet-v1.md` existed before this bootstrap work and was intentionally left untouched.
