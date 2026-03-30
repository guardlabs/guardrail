# Conduit Wallet V1 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining V1 provisioning flow so a wallet can move from CLI creation to browser owner binding and backend `ready` state.

**Architecture:** Keep the existing monorepo and first wallet-request slice intact. Finish V1 by adding the minimal ZeroDev/Kernel integration needed to derive wallet state, verify funding, and surface a real provisioning UI without adding optional subsystems.

**Tech Stack:** React, Vite, Fastify, PostgreSQL, Drizzle, Commander, Zod, Vitest, ZeroDev SDK, viem

---

### Task 1: Persist The New Locked Inputs

**Files:**
- Modify: `docs/superpowers/specs/2026-03-25-conduit-wallet-technical-spec.md`
- Modify: `docs/superpowers/tracking/2026-03-25-conduit-wallet-status.md`
- Modify: `docs/superpowers/tracking/2026-03-25-conduit-wallet-log.md`
- Modify: `docs/superpowers/tracking/2026-03-25-conduit-wallet-handoff.md`

- [ ] **Step 1: Update the technical spec**
Add the confirmed frontend audience, tone, passkey server URL, and note that the frontend design context is now fixed.

- [ ] **Step 2: Update the tracking snapshot**
Record that the design context and `CONDUIT_PASSKEY_SERVER_URL` are no longer open questions.

- [ ] **Step 3: Update the chronological log**
Append the decisions made in this session.

- [ ] **Step 4: Verify docs changed as intended**

Run: `git diff -- docs/superpowers/specs/2026-03-25-conduit-wallet-technical-spec.md docs/superpowers/tracking/2026-03-25-conduit-wallet-status.md docs/superpowers/tracking/2026-03-25-conduit-wallet-log.md docs/superpowers/tracking/2026-03-25-conduit-wallet-handoff.md`
Expected: only the newly confirmed inputs and status changes appear.

### Task 2: Make Backend Finalization Reach `ready`

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/shared/src/contracts.test.ts`
- Modify: `apps/backend/src/config.ts`
- Modify: `apps/backend/src/repository.ts`
- Modify: `apps/backend/src/postgres-repository.ts`
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/app.test.ts`
- Modify: `apps/backend/src/db/schema.ts`
- Modify: `apps/backend/sql/001_wallets.sql` or add a follow-up migration if needed
- Create: `apps/backend/src/wallet.ts`
- Create: `apps/backend/src/funding.ts`

- [ ] **Step 1: Write the failing backend tests**
Add tests for:
`owner-artifacts` publishing can compute wallet data,
funding insufficient keeps status at `owner_bound`,
funding sufficient advances status to `ready`.

- [ ] **Step 2: Run backend tests to verify failure**

Run: `pnpm --filter @conduit/backend test`
Expected: FAIL on the new `ready` transition cases.

- [ ] **Step 3: Add the minimal shared contract fields**
Only add fields that V1 needs to expose the derived wallet address and funding check result cleanly.

- [ ] **Step 4: Implement wallet preparation helpers**
Create a small backend-local ZeroDev/viem integration that derives the counterfactual wallet address from the passkey owner artifacts, session public key, and request scope.

- [ ] **Step 5: Implement funding verification**
Read per-chain RPC/bundler configuration from env, check the wallet balance on the request chain, compare against `CONDUIT_MIN_FUNDING_WEI`, and compute `funding.status`.

- [ ] **Step 6: Wire finalization into the provisioning route**
After `owner-artifacts` is accepted, update the request with owner artifacts, derived address, funding state, optional wallet context, and status `owner_bound` or `ready`.

- [ ] **Step 7: Run backend tests to verify pass**

Run: `pnpm --filter @conduit/backend test`
Expected: PASS

### Task 3: Build The Real Provisioning Frontend

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/main.tsx`
- Modify: `apps/frontend/vite.config.ts`
- Create: `apps/frontend/src/api.ts`
- Create: `apps/frontend/src/passkey.ts`
- Create: `apps/frontend/src/provisioning.ts`
- Create: `apps/frontend/src/App.test.tsx`
- Modify: `apps/frontend/package.json`

- [ ] **Step 1: Write the failing frontend tests**
Cover:
query parsing,
loading a provisioning request,
binding owner artifacts,
rendering funding and `ready` states.

- [ ] **Step 2: Run frontend tests to verify failure**

Run: `pnpm --filter @conduit/frontend test`
Expected: FAIL because the real provisioning flow is not implemented yet.

- [ ] **Step 3: Implement the frontend UI**
Use the approved design direction:
calm, reassuring, high-tech, simple for non-dev users.
Keep one primary action at a time.

- [ ] **Step 4: Implement passkey creation**
Use the ZeroDev passkey flow with `CONDUIT_PASSKEY_SERVER_URL`, then convert the result to the minimal `{ credentialId, publicKey }` payload expected by the backend.

- [ ] **Step 5: Implement frontend API wiring**
Load the provisioning request from the signed URL params and post owner artifacts back to the backend.

- [ ] **Step 6: Run frontend tests to verify pass**

Run: `pnpm --filter @conduit/frontend test`
Expected: PASS

### Task 4: Tighten CLI Around The Completed Flow

**Files:**
- Modify: `apps/cli/src/commands.ts`
- Modify: `apps/cli/src/commands.test.ts`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Write the failing CLI tests**
Add coverage for `await` returning the finalized backend payload and for any new output fields needed by V1.

- [ ] **Step 2: Run CLI tests to verify failure**

Run: `pnpm --filter @conduit/cli test`
Expected: FAIL on the new `await` expectations.

- [ ] **Step 3: Implement the minimal CLI changes**
Keep the command surface stable. Only add output fields and status handling needed for the completed provisioning flow.

- [ ] **Step 4: Run CLI tests to verify pass**

Run: `pnpm --filter @conduit/cli test`
Expected: PASS

### Task 5: End-To-End Verification And Documentation

**Files:**
- Modify: `docs/superpowers/tracking/2026-03-25-conduit-wallet-status.md`
- Modify: `docs/superpowers/tracking/2026-03-25-conduit-wallet-log.md`
- Modify: `docs/superpowers/tracking/2026-03-25-conduit-wallet-handoff.md`
- Modify: `.env.example`

- [ ] **Step 1: Add any missing env examples**
Document the required per-chain RPC, bundler, and passkey env vars without committing secrets.

- [ ] **Step 2: Run the full workspace verification**

Run: `pnpm build`
Expected: PASS

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: Run the backend migration against local PostgreSQL**

Run: `DATABASE_URL=postgresql://conduit:conduit@127.0.0.1:5432/conduit pnpm db:migrate`
Expected: PASS

- [ ] **Step 4: Run the live backend**

Run: `DATABASE_URL=postgresql://conduit:conduit@127.0.0.1:5432/conduit pnpm --filter @conduit/backend dev`
Expected: backend starts cleanly on `127.0.0.1:3000`

- [ ] **Step 5: Run the live frontend**

Run: `pnpm --filter @conduit/frontend dev`
Expected: frontend serves on `127.0.0.1:5173`

- [ ] **Step 6: Run the live CLI flow**

Run: `pnpm --filter @conduit/cli exec node dist/index.js create --chain-id 84532 --target-contract 0x1111111111111111111111111111111111111111 --allowed-method 0xa9059cbb`
Expected: returns `walletId`, `provisioningUrl`, and local state path.

- [ ] **Step 7: Update the tracking docs with factual results**
Mark exactly what was verified and what, if anything, still depends on operator-provided environment.
