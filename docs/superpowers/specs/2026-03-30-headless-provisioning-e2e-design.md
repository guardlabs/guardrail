# Headless Provisioning E2E Design

Date: 2026-03-30
Status: Approved for planning

## Summary

This document defines the first automated end-to-end test for Conduit Wallet provisioning.

The initial scope is intentionally narrow:

- local/dev only
- no browser automation
- no real WebAuthn ceremony
- real CLI
- real backend
- real Postgres
- real forked chain environment
- stop at wallet status `ready`

The goal is to exercise the real provisioning system across process boundaries without taking on browser and native passkey complexity in the first iteration.

## Current Repo Findings

### Current Test Coverage

The repository currently has strong unit coverage and some narrow integration coverage, but no automated end-to-end test that runs the full provisioning flow:

- `packages/shared` covers schemas, contracts, and supported chains
- `packages/zerodev` covers wallet helper behavior with mocks
- `apps/backend` covers route behavior with `app.inject(...)`, an in-memory repository, and a fake provisioning service
- `apps/cli` covers command behavior with mocked `fetch` and mocked wallet hydration
- `apps/frontend` covers UI behavior in `jsdom` with injected fake APIs and fake passkey client

There is no current suite that:

- starts multiple real processes
- uses the real Postgres repository
- runs the real CLI binary flow
- performs backend persistence through the real database
- checks funding through a real JSON-RPC endpoint

### Runtime Constraints

The current product is pinned to Base Sepolia chain metadata:

- `chainId = 84532`
- passkey validator address is fixed in shared contracts
- Kernel runtime assumptions come from the installed ZeroDev stack

Because of those assumptions, an empty local chain is not sufficient for realistic provisioning/runtime checks. The local chain environment should therefore be an Anvil fork of Base Sepolia rather than a standalone Anvil instance.

### Provisioning Constraints

The frontend currently creates three provisioning artifacts:

- `owner`
- `counterfactualWalletAddress`
- `regularValidatorInitArtifact`

The backend does not independently perform a WebAuthn ceremony. It accepts those artifacts, persists them, and derives request status by checking funding and deployment state through RPC.

At runtime, the CLI reconstructs the wallet using:

- the stored owner public artifacts
- the stored regular validator init artifact
- the local agent private key
- the backend remote signer

This means the first e2e test does not need a live passkey signature at runtime, but it does need provisioning artifacts that are internally consistent with the wallet configuration.

## Goals

- Add one automated local/dev e2e test for the full provisioning flow.
- Use the real CLI, backend, Postgres, and forked chain.
- Replace only the WebAuthn ceremony with a deterministic test path.
- Verify status progression from `created` to `owner_bound` to `ready`.
- Verify CLI local state persistence after the wallet becomes ready.
- Keep the first e2e isolated from browser automation and runtime user operations.

## Non-Goals

- Browser or Playwright coverage
- Real WebAuthn or OS-native passkey prompts
- CI-hardening in the first iteration
- Local deployment of Kernel or validator contracts from scratch
- Testing `deploy`, `call`, or `sign-typed-data`
- Multi-chain support

## Recommended Scope

The first e2e test should be headless and system-oriented.

It should validate:

1. CLI can create a wallet request against the real backend
2. backend persists the request in Postgres
3. a test provisioning helper can publish valid owner artifacts
4. backend resolves funding against the forked chain
5. CLI can wait until the wallet becomes `ready`
6. CLI local state reflects the final ready wallet metadata

It should not attempt to validate:

- frontend rendering
- provisioning query parsing in the browser
- native WebAuthn registration behavior
- runtime deployment or transaction execution

## Target Architecture

### Test Placement

This e2e suite should live outside the existing app/package `src` trees because it spans multiple services.

Recommended layout:

- `tests/e2e/provisioning-headless.e2e.test.ts`
- `tests/e2e/helpers/provision-headless.ts`
- `tests/e2e/helpers/process.ts`
- `tests/e2e/helpers/ports.ts`
- `tests/e2e/fixtures/`

Recommended root scripts:

- `test:e2e`
- `test:e2e:provisioning`

### Environment Topology

The test environment should consist of:

- Postgres from `docker compose`
- Anvil forked from Base Sepolia
- backend process with local env overrides
- CLI commands executed as child processes

The backend should point its chain RPC to the local Anvil fork so funding and code checks operate against the controlled local environment while preserving Base Sepolia chain assumptions.

Bundler support can remain out of scope for this first slice if the test stops at `ready`.

### Headless Provisioning Helper

The core new testing primitive is a headless provisioning helper.

Responsibilities:

- read wallet state from the backend after `create`
- derive valid provisioning artifacts from the returned `walletConfig`
- publish those artifacts through the real provisioning endpoint

The helper must not return arbitrary fake values. It must produce:

- an `owner.publicKey` compatible with the passkey validator encoding expected by the runtime
- a `counterfactualWalletAddress` consistent with the wallet configuration
- a `regularValidatorInitArtifact` whose contents are consistent with the runtime weighted validator configuration

### Artifact Generation Strategy

The recommended implementation is to extract the artifact-construction logic from the current frontend passkey path into a reusable module, while keeping owner creation pluggable.

Two owner sources should exist:

- browser path: real WebAuthn-derived owner artifacts
- e2e path: deterministic test owner artifacts

Shared logic should then compute:

- provisioning weighted validator
- counterfactual account address
- regular validator enable data
- plugin enable signature

This keeps the only simulated step limited to "how the owner identity is obtained", while keeping wallet construction logic real.

## End-to-End Flow

### Step 1: Start Infrastructure

The e2e test starts:

- `docker compose up -d postgres`
- `anvil --fork-url <base-sepolia-rpc> --chain-id 84532`
- backend migrations
- backend process with e2e env vars

The test should wait for explicit readiness signals before continuing.

### Step 2: Create Wallet Through CLI

The test runs the real CLI `create` command against the local backend.

Expected outputs:

- `walletId`
- `provisioningUrl`
- local wallet state file path

The test then parses the provisioning URL to extract:

- `walletId`
- `token`
- `backendUrl`

### Step 3: Publish Owner Artifacts

The test invokes the headless provisioning helper with:

- `walletId`
- `token`
- `backendUrl`

The helper posts to:

- `POST /v1/provisioning/:walletId/owner-artifacts?t=...`

Expected outcome:

- backend returns a wallet in status `owner_bound`
- response includes `counterfactualWalletAddress`

### Step 4: Fund the Wallet

The test transfers ETH on Anvil from a funded local account to the returned counterfactual wallet address.

The amount must exceed `CONDUIT_MIN_FUNDING_WEI`.

### Step 5: Wait for Ready State

The test runs the real CLI `await` command against the same backend.

Expected outcome:

- CLI exits successfully
- backend status becomes `ready`

## Assertions

The e2e test should assert at minimum:

- CLI `create` succeeds
- provisioning URL is returned
- provisioning endpoint accepts the published artifacts
- backend status becomes `owner_bound` after artifact publication
- backend exposes a counterfactual wallet address
- funding check eventually becomes `verified`
- CLI `await` succeeds
- backend status becomes `ready`
- local wallet state contains:
  - `walletAddress`
  - `ownerPublicArtifacts`
  - `regularValidatorInitArtifact`
  - `lastKnownStatus = "ready"`

Useful additional assertions:

- backend `walletContext.walletAddress` matches CLI local wallet address
- backend `walletContext.agentAddress` matches local stored agent address
- backend `walletContext.backendAddress` matches local stored backend address
- `deployment.status` remains allowed to be `undeployed` in this first e2e slice

## Failure Handling

The test harness should fail clearly when:

- Postgres never becomes reachable
- Anvil fork fails to start
- backend does not become healthy
- CLI output cannot be parsed into a provisioning URL
- published artifacts are rejected
- funding never becomes verified within timeout
- CLI `await` times out or exits non-zero

Child processes should always be cleaned up on failure to avoid leaving stray ports or containers behind.

## Risks

### Fork Dependency

The first e2e depends on a working Base Sepolia RPC endpoint for Anvil forking. This is acceptable for local/dev-only scope, but it is one reason this design is not yet CI-ready.

### Artifact Validity

If the e2e helper invents provisioning artifacts instead of deriving them through the real wallet-construction path, the test may pass the API boundary but fail later when wallet hydration or runtime deployment is attempted. The implementation must therefore preserve real artifact derivation.

### Output Parsing Fragility

If the test relies on human-readable CLI logs only, it may become brittle. The implementation should prefer a machine-readable path where possible, or isolate output parsing into a single helper with stable expectations.

## Testing Strategy

The initial testing surface should be layered:

1. unit tests for the new headless provisioning helper
2. unit tests for CLI output parsing helpers if needed
3. one full e2e provisioning spec covering the real local system

This keeps the system test focused while still allowing fast feedback on the new deterministic owner path.

## Future Follow-Ups

Once this V1 is stable, the next useful layers are:

1. browser e2e for the provisioning page using a test passkey client
2. runtime e2e covering deployment and one simple transaction on the forked chain
3. later CI-hardening if the team decides the setup is worth operationalizing
