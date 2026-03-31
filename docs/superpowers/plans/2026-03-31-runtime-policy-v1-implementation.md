# Runtime Policy V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement immutable wallet-creation policies and backend-enforced runtime signing rules so the `agent + backend` path becomes deny-by-default and only explicitly authorized non-USDC calls or supported official-USDC actions can be co-signed.

**Architecture:** Extend the shared wallet-request contracts with a persisted policy model, replace the blind backend signer route with explicit typed-data, user-operation, and deployment endpoints, and refactor the CLI/runtime path so the backend validates the exact operation it co-signs. Keep V1 narrow: no batch calls, no `initCode` on normal user operations, no USDC in the generic allowlist, and no support for `transferFrom` or `ReceiveWithAuthorization`.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Drizzle, Commander, Zod, Vitest, viem, ZeroDev SDK, Kernel

---

### Task 1: Define The Policy Contracts And Persistence Shape

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/shared/src/contracts.test.ts`
- Modify: `apps/backend/src/db/schema.ts`
- Modify: `apps/backend/sql/001_wallets.sql` or add a follow-up migration file
- Modify: `apps/backend/src/repository.ts`
- Modify: `apps/backend/src/postgres-repository.ts`

- [ ] **Step 1: Write failing shared contract tests**

Add tests for:
- valid policy parsing with `contractAllowlist`
- valid policy parsing with `usdcPolicy`
- rejection when both mechanisms are missing
- rejection when official USDC appears in the generic allowlist
- rejection of unsupported USDC operation names

- [ ] **Step 2: Run shared tests to verify failure**

Run: `pnpm --filter @conduit/shared test`
Expected: FAIL on the new policy-schema cases.

- [ ] **Step 3: Add minimal shared policy schemas**

Add:
- persisted wallet policy schema
- CLI create input schema additions
- wallet request response additions
- backend request schemas for typed-data, user-operation, and deploy signing

- [ ] **Step 4: Add backend persistence fields**

Persist:
- immutable policy object
- USDC budget accounting state needed for the current time window

- [ ] **Step 5: Run shared and backend typechecks**

Run: `pnpm --filter @conduit/shared typecheck`
Expected: PASS

Run: `pnpm --filter @conduit/backend typecheck`
Expected: PASS

### Task 2: Add CLI Policy Parsing For `create`

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`
- Modify: `apps/cli/src/commands.ts`
- Modify: `apps/cli/src/commands.test.ts`

- [ ] **Step 1: Write failing CLI tests for policy flags**

Cover:
- `--allow-call` normalization from Solidity signatures to selectors
- repeated `--allow-call` accumulation
- full USDC policy parsing
- rejection of partial USDC config
- rejection when no mechanism is configured
- rejection when official USDC appears in `--allow-call`

- [ ] **Step 2: Run CLI tests to verify failure**

Run: `pnpm --filter @conduit/cli test`
Expected: FAIL on the new `create` flag and validation cases.

- [ ] **Step 3: Implement CLI parsing and normalization**

Add:
- repeated `--allow-call`
- `--usdc-period`
- `--usdc-max`
- `--usdc-allow`
- selector normalization and de-duplication
- USDC max normalization to minor units

- [ ] **Step 4: Wire normalized policy into `executeCreate`**

Send the normalized policy object to the backend and persist it in local wallet state if the backend echoes it back.

- [ ] **Step 5: Run CLI tests to verify pass**

Run: `pnpm --filter @conduit/cli test`
Expected: PASS

### Task 3: Replace The Blind Backend Signer API

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/app.test.ts`
- Modify: `packages/zerodev/src/backend-remote-signer.ts`
- Modify: `packages/zerodev/src/weighted-validator.ts`
- Modify: `packages/zerodev/src/weighted-validator.test.ts`
- Modify: `apps/cli/src/kernel.ts`
- Modify: `apps/cli/src/kernel.test.ts`

- [ ] **Step 1: Write failing backend route tests**

Add tests for:
- old blind route removed
- typed-data route rejects unsupported shapes
- user-operation route rejects `initCode`
- deploy route rejects already deployed wallets
- user-operation route rejects call-context mismatch

- [ ] **Step 2: Run backend tests to verify failure**

Run: `pnpm --filter @conduit/backend test`
Expected: FAIL on missing routes and policy-aware verification.

- [ ] **Step 3: Implement new shared request/response schemas**

Define:
- `backend-sign-typed-data`
- `backend-sign-user-operation`
- `backend-deploy-wallet`

- [ ] **Step 4: Remove the old backend-sign route**

Delete the generic blind route and its request handling.

- [ ] **Step 5: Implement typed-data signing route**

Keep the existing agent auth and replay logic, but scope it to the new typed-data request schema.

- [ ] **Step 6: Implement user-operation signing route**

Require:
- `single_call`
- `initCode == 0x`
- exact decoded-call match to the declared context
- backend recomputation of the real `userOpHash`

- [ ] **Step 7: Implement deploy-wallet route**

Require:
- deployment-only user operation shape
- no arbitrary call payload
- backend recomputation of the deployment user-op hash

- [ ] **Step 8: Refactor the runtime client path**

Change the runtime integration so:
- typed data use the dedicated typed-data endpoint
- normal wallet calls request backend co-signing through the user-operation-aware path
- wallet deployment uses the dedicated deploy route

- [ ] **Step 9: Run backend, zerodev, and CLI tests to verify pass**

Run: `pnpm --filter @conduit/backend test`
Expected: PASS

Run: `pnpm --filter @conduit/zerodev test`
Expected: PASS

Run: `pnpm --filter @conduit/cli test`
Expected: PASS

### Task 4: Implement Policy Evaluation And USDC Budget Accounting

**Files:**
- Create: `apps/backend/src/policy.ts`
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/app.test.ts`
- Modify: `packages/shared/src/chains.ts` if extra official-USDC metadata is required

- [ ] **Step 1: Write failing backend policy tests**

Cover:
- non-USDC allowlisted selector accepted
- non-USDC non-allowlisted selector denied
- USDC `transfer` accepted when enabled and budget is sufficient
- USDC `approve` consumes full amount
- USDC `increaseAllowance` consumes only the added value
- USDC `Permit` accepted when enabled
- USDC `TransferWithAuthorization` accepted when enabled
- unsupported USDC method denied
- unsupported typed data denied
- budget exhaustion denied

- [ ] **Step 2: Run backend tests to verify failure**

Run: `pnpm --filter @conduit/backend test`
Expected: FAIL on the new policy decision cases.

- [ ] **Step 3: Implement policy evaluation helpers**

Add helpers for:
- partitioning between generic allowlist and official USDC
- decoding selectors and supported USDC calldata
- recognizing supported official-USDC typed data
- computing budget consumption

- [ ] **Step 4: Implement budget window logic**

Track the current budget window and consumed amount for:
- `daily`
- `weekly`
- `monthly`

- [ ] **Step 5: Wire policy enforcement into the new signing routes**

Enforce policy before backend signing and update persisted consumption state only on successful approval.

- [ ] **Step 6: Run backend tests to verify pass**

Run: `pnpm --filter @conduit/backend test`
Expected: PASS

### Task 5: Show The Attached Policy During Frontend Provisioning

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/App.test.tsx`
- Modify: `apps/frontend/src/api.ts` if the UI needs extra typed accessors

- [ ] **Step 1: Write failing frontend tests**

Cover rendering of a simple policy summary during provisioning, including:
- generic contract allowlist summary
- official-USDC policy summary
- explicit indication that the passkey remains fully privileged

- [ ] **Step 2: Run frontend tests to verify failure**

Run: `pnpm --filter @conduit/frontend test`
Expected: FAIL on the new provisioning policy summary expectations.

- [ ] **Step 3: Implement the provisioning policy summary UI**

Add a clean, compact summary in the provisioning flow so the human sees the attached runtime policy before creating the passkey owner.

- [ ] **Step 4: Run frontend tests to verify pass**

Run: `pnpm --filter @conduit/frontend test`
Expected: PASS

### Task 6: Update Local State, E2E Coverage, And README

**Files:**
- Modify: `apps/cli/src/local-store.ts`
- Modify: `apps/cli/src/commands.test.ts`
- Modify: `tests/e2e/provisioning-headless.e2e.test.ts`
- Modify: `tests/e2e/helpers/provision-headless.ts` if needed
- Modify: `README.md`

- [ ] **Step 1: Write failing tests for persisted local policy metadata**

Cover local wallet state persistence of the backend-confirmed policy data returned by `create`.

- [ ] **Step 2: Extend e2e coverage**

Add real end-to-end policy scenarios on the existing local stack:
- one allowed scenario:
  - create a wallet with explicit policy
  - complete provisioning
  - execute one explicitly allowed action successfully
- one denied scenario:
  - create a wallet with explicit policy
  - complete provisioning
  - attempt one action outside policy and assert backend policy denial
- one USDC budget scenario:
  - create a wallet with a small USDC policy budget
  - consume budget with one allowed action
  - assert a later action exceeding the remaining budget is denied

- [ ] **Step 3: Run targeted tests to verify failure**

Run: `pnpm --filter @conduit/cli test`
Expected: FAIL on the new local-state expectations.

Run: `pnpm test:e2e:provisioning`
Expected: FAIL on missing runtime policy behavior.

- [ ] **Step 4: Update local state persistence**

Store the policy returned by the backend so the CLI can display and reuse the normalized policy shape.

- [ ] **Step 5: Update the README**

Document:
- deny-by-default runtime permissions
- passkey vs `agent + backend`
- `contractAllowlist`
- `usdcPolicy`
- the official-USDC partition rule
- the new `create` flags
- the supported official-USDC operations in V1

- [ ] **Step 6: Run final verification**

Run: `pnpm test`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test:e2e:provisioning`
Expected: PASS
