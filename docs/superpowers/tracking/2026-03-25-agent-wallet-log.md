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

- Full provisioning flow implementation still pending.

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

### First Slice

- Simplified the backend status model to:
  - `created`
  - `owner_bound`
  - `ready`
  - `failed`
- Simplified persisted owner artifacts to the minimal shape:
  - `{ credentialId, publicKey }`
- Switched the built-in local backend default to `http://127.0.0.1:3000`.
- Added shared API contracts for wallet creation, status reads, provisioning resolve, and owner artifact publication.
- Implemented backend routes:
  - `POST /v1/wallets`
  - `GET /v1/wallets/:walletId`
  - `GET /v1/provisioning/:walletId?t=...`
  - `POST /v1/provisioning/:walletId/owner-artifacts?t=...`
- Removed the backend in-memory fallback.
- Kept PostgreSQL as the only runtime repository with `DATABASE_URL` required.
- Implemented CLI session key generation and local request persistence.
- Implemented live CLI `create`, `status`, and polling `await`.
- Added tests for the new shared contracts, backend request flow, and CLI command helpers.
- Verified the live create and status round-trip against the running backend.

### PostgreSQL Runtime

- Removed the backend in-memory fallback completely.
- Added a SQL migration script for `wallets`.
- Added backend migration scripts and a Drizzle config file.
- Added a root `docker-compose.yml` and `.env.example` for local runtime setup.
- Verified that local PostgreSQL is reachable on the machine.
- Created the local `agent_wallet` role and database for development.
- Applied the backend SQL migration successfully.
- Verified live backend + CLI create/status against PostgreSQL persistence.

### V1 Completion Inputs

- Locked the frontend design context for the real provisioning UI:
  - audience: non-developers and users with limited Web3 familiarity
  - use case: securely grant an autonomous agent limited wallet rights
  - tone: reassuring, high-tech, simple, and secure
- Locked `AGENT_WALLET_PASSKEY_SERVER_URL=https://passkeys.zerodev.app/api/v3/ec78db7a-024e-42b8-a404-d78986033fca`.
- Wrote the remaining V1 execution plan in `docs/superpowers/plans/2026-03-25-agent-wallet-v1-completion.md`.

### Provisioning Flow Runtime

- Added a backend wallet provisioning service that runs during owner binding.
- Added live funding checks using a chain-specific RPC URL, with bundler URL fallback.
- Added wallet context generation and persisted counterfactual wallet address metadata.
- Added frontend provisioning UI with:
  - signed-link parsing
  - request loading
  - browser passkey creation
  - owner-artifact publication
  - funding and ready-state rendering
- Added frontend Vitest coverage for the provisioning path.
- Added CLI coverage for `await` reaching a finalized `ready` payload.
- Added `AGENT_WALLET_PUBLIC_RPC_URL_<chainId>` to `.env.example`.

### Live Verification

- Ran `pnpm build` successfully after the provisioning implementation.
- Ran `pnpm test` successfully after the provisioning implementation.
- Re-ran `DATABASE_URL=postgresql://agent_wallet:agent_wallet@127.0.0.1:5432/agent_wallet pnpm db:migrate` successfully.
- Re-verified CLI help manually.
- Started backend live with PostgreSQL plus Base Sepolia RPC configuration.
- Started frontend live with Vite.
- Verified live backend health.
- Verified live frontend HTML serving.
- Verified live CLI `create`.
- Verified live provisioning resolve.
- Verified live owner-artifact publication returning:
  - `status=owner_bound`
  - derived wallet address
  - `funding.status=insufficient`
  - persisted wallet context

### Remaining Gap

- The browser passkey gesture has not yet been manually exercised end to end in this session with a human click.
- First-operation activation remains intentionally out of scope for the backend V1.

### ZeroDev And Kernel Runtime Alignment

- Replaced the earlier partial wallet runtime with real ZeroDev and Kernel usage where V1 needs it.
- Frontend now prepares the passkey-backed owner and permission account with the ZeroDev SDK and Kernel account creation flow.
- Backend now accepts the frontend-produced counterfactual wallet address and serialized permission account instead of deriving a fake or deterministic wallet locally.
- CLI now reconstructs the ready permission account locally from the serialized approval plus the stored session private key.
- Rebuilt `packages/shared/dist` so every workspace consumer uses the same updated contract surface.
- Added a frontend Vite Node polyfill plugin so the browser build can bundle the ZeroDev SDK dependencies cleanly.

### Final Verification Pass

- Re-ran `pnpm install` after adding the frontend polyfill dependency.
- Re-ran package-local test suites for shared, backend, frontend, and CLI successfully.
- Re-ran `pnpm build` successfully for the full workspace.
- Re-ran `pnpm test` successfully for the full workspace.
- Re-ran `DATABASE_URL=postgresql://agent_wallet:agent_wallet@127.0.0.1:5432/agent_wallet pnpm db:migrate` successfully.
- Started the built backend with PostgreSQL plus Base Sepolia runtime configuration and verified `/health`.
- Re-verified `agent-wallet --help` against the built CLI.
- Re-verified live CLI `create` and `status` against the running backend.

### Local Env Autoload

- Kept `dotenv` as the runtime env loader for local Node entrypoints.
- Removed the failed `packages/shared` env-loader approach.
- Moved root `.env.local` and `.env` autoloading into backend-local and CLI-local entrypoints.
- Updated frontend Vite config so it resolves root `.env.local` and root `.env` from the monorepo root.
- Re-ran `pnpm install`, `pnpm build`, and `pnpm test` successfully after the env-loader move.
- Verified `pnpm db:migrate` succeeds with only a temporary root `.env.local`.
- Verified the CLI entrypoint reads `AGENT_WALLET_BACKEND_URL` from a temporary root `.env.local`.
- Verified frontend build succeeds with `AGENT_WALLET_PASSKEY_SERVER_URL` coming only from a temporary root `.env.local`.

### Funding Refresh Loop

- Added `POST /v1/wallets/:walletId/refresh-funding` so funding rechecks are explicit and side-effectful writes stay out of `GET`.
- Kept `GET /v1/wallets/:walletId` as a pure status read.
- Updated the frontend to enter a funding-wait state after owner binding and poll the refresh endpoint every 5 seconds.
- Updated CLI `await` to recheck funding every 5 seconds by default once the request reaches `owner_bound`.
- Added backend, frontend, and CLI tests for the new refresh loop.
- Re-ran `pnpm test` successfully.
- Re-ran `pnpm build` successfully.

### Empty JSON Body Fix

- Fixed CLI and frontend body-less `POST` requests so they no longer force `content-type: application/json`.
- This resolves Fastify's `FST_ERR_CTP_EMPTY_JSON_BODY` on `POST /v1/wallets/:walletId/refresh-funding`.
- Added targeted tests for the CLI HTTP helper and frontend API helper.
- Re-ran `pnpm test` successfully.
- Re-ran `pnpm build` successfully.

### Agent-Friendly CLI Guidance

- Added structured `nextSteps` guidance to wallet-request creation responses.
- `create` output now tells agent callers how to poll status, when the wallet address should appear, and when to ask a human to fund the request on-chain.
- `await` now emits an immediate waiting message on start while preserving the final JSON payload on `stdout`.
- Re-ran `pnpm test` successfully.
- Re-ran `pnpm build` successfully.

### Human Provisioning Guidance In `create`

- Tightened `create.nextSteps` so an agent is told to send the human to `provisioningUrl` first.
- Added an explicit wallet-address command field that tells the agent which CLI command to call next to refresh status and obtain the wallet address.
- Kept the final `await` command in the output for the post-funding step.
- Re-ran `pnpm test` successfully.
- Re-ran `pnpm build` successfully.

### First Permitted Call Path

- Added `agent-wallet call` as the post-`ready` CLI command for submitting the first permitted contract call.
- The CLI now rehydrates the ZeroDev or Kernel permission account from local state and uses the Kernel client to submit the first user operation.
- This is the runtime path that deploys the wallet on first use if the account is still counterfactual.
- Re-ran `pnpm test` successfully.
- Re-ran `pnpm build` successfully.

### Alchemy Bundler Compatibility

- Fixed the CLI Kernel client so it no longer depends on ZeroDev-specific `zd_getUserOperationGasPrice` when using an Alchemy bundler.
- Added an explicit `estimateFeesPerGas` override for user operations in the CLI Kernel hydration path.
- Added CLI unit coverage for the custom fee-estimation hook used by `agent-wallet call`.
- Re-ran `pnpm build` successfully.
- Re-ran `pnpm test` successfully.

### End-To-End Manual Runtime Verification

- Exercised the real browser passkey flow manually against the local backend and frontend.
- Reached `ready` for a real Base Sepolia wallet.
- Verified a live `agent-wallet call` against Base Sepolia USDC on `approve(address,uint256)` for request `wal_c700ae7d9b64436c9dcac2456e4172cc`.
- Confirmed the call returned transaction hash `0x707e3da799586f62e92b49d5e818d6ae7d3eb208d35ce87258b198c0f0073ae1`.
- Confirmed the wallet address `0x1144ff65e1407C7e8766bbAcB5dB37FbD79a8994` has deployed bytecode on-chain after the first permitted call via `eth_getCode`.

### WalletId Refactor

- Renamed the durable orchestration identifier from `requestId` to `walletId` across shared contracts, CLI, frontend, backend routes, and local storage.
- Renamed HTTP routes from `/v1/wallet-requests/...` to `/v1/wallets/...` as the canonical V1 API surface.
- Renamed the SQL runtime shape to `wallets(wallet_id, ...)` and updated the migration to rename existing local `wallet_requests(id, ...)` installs in place.
- Switched generated ids and examples from the `wr_` prefix to the `wal_` prefix.
- Rebuilt `@agent-wallet/shared` so all workspace consumers picked up the renamed contract surface.
- Re-ran the focused package tests for shared, backend, CLI, and frontend successfully.
- Re-ran full workspace `pnpm build` successfully.
- Re-ran full workspace `pnpm test` successfully.

### CLI Infra Proxy Refactor

- Added centralized supported-chain metadata in `packages/shared` and kept Base Sepolia as the only V1 chain.
- Added backend proxy endpoints at `/v1/chains/:chainId/rpc` and `/v1/chains/:chainId/bundler`.
- Changed CLI Kernel hydration so it derives its runtime transports from the stored backend URL instead of local chain env vars.
- Kept session-key signing local to the CLI host; the backend only proxies RPC and bundler traffic.
- Narrowed CLI local env needs to `AGENT_WALLET_BACKEND_URL` as an optional convenience override.
- Updated `.env.example` to make the backend-only chain secrets explicit.
- Re-ran focused backend and CLI tests successfully, then re-ran full workspace `pnpm build` and `pnpm test` successfully.
- Re-validated the live Base Sepolia `call` path through the backend proxies with transaction hash `0xe2203902730242b8d18da7f69509c702f2dfe4d737ca98bd26e7babe257bd01e`.

## How To Use This Log

- Add a dated entry whenever meaningful work lands.
- Record what changed, what was verified, and what remains blocked.
- Keep it short and operational.
