# Kernel Weighted Multisig Migration Design

Date: 2026-03-29
Status: Approved for planning

## Summary

This document defines the migration from the current session-key-based Kernel wallet model to a single weighted multisig model based on:

- `Kernel v3.1`
- `EntryPoint 0.7`
- `passkey` as the `sudo` validator
- `@zerodev/weighted-ecdsa-validator` as the `regular` validator
- one `agent EOA` generated and stored by the CLI
- one `backend EOA` generated and stored by the backend per wallet

The target mode removes the current session-key and permission-validator runtime path. All runtime signing becomes `agent + backend` co-signing through the official ZeroDev weighted validator.

## Current Repo Findings

### Package Architecture

The monorepo currently contains:

- `apps/frontend`
- `apps/backend`
- `apps/cli`
- `packages/shared`
- `packages/zerodev`
- `contracts`

Current responsibilities:

- `apps/frontend` provisions the wallet in the browser and creates the passkey owner.
- `apps/backend` stores provisioning state and wallet metadata, but does not currently co-sign operations.
- `apps/cli` creates local agent secrets and later executes calls from the ready wallet.
- `packages/shared` contains the shared chain registry, schemas, request/response contracts, and persisted local wallet state.
- `packages/zerodev` currently contains local helpers around permission-account reconstruction and the outgoing-budget policy.
- `contracts` currently contains the outgoing-budget policy contract and tests.

### Mode A Coupling

The current product is strongly coupled to the session-key model:

- the CLI generates a `session key` locally
- the frontend builds a `permission validator`
- the frontend serializes a `permission account`
- the backend stores `sessionPublicKey`
- the CLI later deserializes `serializedPermissionAccount` and uses the session private key to send transactions

Critical mode-A-specific files include:

- `apps/frontend/src/passkey.ts`
- `apps/cli/src/session-key.ts`
- `apps/cli/src/kernel.ts`
- `packages/zerodev/src/permission-account.ts`
- `packages/shared/src/contracts.ts`

### Current Data Model

The current shared contracts still encode the mode-A model through fields such as:

- `sessionPublicKey`
- `sessionPrivateKey`
- `serializedPermissionAccount`
- `walletContext.sessionPublicKey`

The current `scope` structure is also inherited from the permission-validator world:

- `contractPermissions`
- `outgoingBudgets`

### SDK Validation

The installed SDK versions are:

- `@zerodev/sdk` `5.5.8`
- `@zerodev/permissions` `5.6.3`
- `@zerodev/passkey-validator` `5.6.0`

`@zerodev/weighted-ecdsa-validator` is not installed in the repo today, but npm metadata confirms:

- package exists
- latest available version is `5.4.4`
- peer dependency is `@zerodev/sdk ^5.4.0`
- peer dependency is `viem ^2.28.0`

This is compatible with the repo's current `sdk` and `viem`.

### Weighted Validator Behavior

Inspection of `@zerodev/weighted-ecdsa-validator@5.4.4` confirms:

- `createWeightedECDSAValidator(...)` is the official helper
- it is not install-only; it also performs runtime signing
- it expects `signers: Array<Signer>`
- for `signUserOperation(...)`, signers do not all sign the same payload:
  - the first `n - 1` signers sign `Approve(callDataAndNonceHash)`
  - the last signer signs the final `userOpHash`
- for `signMessage(...)` and `signTypedData(...)`, all signers sign the same payload and their signatures are concatenated in the order expected by the validator

Inspection of the installed Kernel SDK confirms:

- `Kernel v3.1` wraps off-chain signatures through Kernel's ERC-1271 path
- `signMessage(...)` and `signTypedData(...)` for the smart account are ultimately expressed as a validator-backed Kernel signature, then prefixed with the validator identifier expected by `isValidSignature`

## Goals

- Replace the session-key model with a single `agent + backend` weighted multisig model.
- Keep the passkey as the `sudo` validator.
- Use the official `@zerodev/weighted-ecdsa-validator` package rather than a custom regular validator.
- Support both:
  - on-chain transaction and user operation signing
  - off-chain signature generation compatible with `isValidSignature`
- Keep the existing monorepo boundaries and package responsibilities.
- Remove mode-A-specific code that is no longer needed.

## Non-Goals

- Implement backend transaction-signing policy rules in this migration.
- Preserve the old permission-validator abstractions.
- Keep compatibility with session-key wallet requests.
- Maintain the outgoing-budget permission model in critical runtime paths.

## Target Architecture

### Wallet Shape

The wallet mode B is:

- `sudo validator`: passkey
- `regular validator`: weighted ECDSA validator
- weighted validator config:
  - `threshold = 2`
  - `agent weight = 1`
  - `backend weight = 1`
  - `delay = 0`

There is exactly one backend signing key per wallet.

### Runtime Ownership

- The passkey remains the durable human admin.
- The agent CLI owns the local `agent EOA` private key.
- The backend owns the wallet-specific backend private key.
- Runtime wallet operations require both the agent and the backend.

### Remote Signer Model

The weighted validator runtime should live on the agent side:

- the agent instantiates `createWeightedECDSAValidator(...)`
- the agent provides:
  - a local signer for the agent EOA
  - a remote signer for the backend EOA

The backend should not manually reimplement weighted-signature assembly if the official helper can be used directly through a remote signer transport.

## Provisioning Flow

1. The CLI runs `agent-wallet create`.
2. The CLI generates the agent EOA locally.
3. The CLI sends the backend:
   - `chainId`
   - wallet configuration payload
   - `agentAddress`
4. The backend:
   - creates the wallet request
   - generates a backend EOA dedicated to this wallet
   - stores:
     - `agentAddress`
     - `backendAddress`
     - `backendPrivateKey`
     - weighted validator config
5. The backend returns the provisioning link.
6. The human opens the frontend link.
7. The frontend creates the passkey.
8. The frontend provisions the Kernel account with:
   - `sudo = passkey`
   - `regular = weighted validator`
9. The frontend returns wallet artifacts to the backend.
10. The backend persists the final wallet metadata and marks the request `owner_bound` or `ready` depending on funding.

## Runtime Transaction Flow

1. The agent wants to execute a transaction.
2. The CLI loads the local agent key and wallet metadata.
3. The CLI instantiates the official weighted validator helper with:
   - the local agent signer
   - a backend remote signer
4. The helper requests whatever signatures are required for the user operation.
5. The backend remote signer verifies the signed request from the agent before signing.
6. The weighted helper assembles the validator signature.
7. The Kernel client uses the weighted validator signature to send the user operation.

The implementation should rely on the official helper's behavior for signer ordering and user operation signing semantics.

## Runtime Off-Chain Signature Flow

1. The agent wants a smart-account off-chain signature.
2. The CLI constructs the typed data or message to sign.
3. The CLI uses the weighted validator runtime with:
   - local agent signer
   - backend remote signer
4. The helper gathers the weighted validator signatures.
5. The smart-account signing path wraps the signature in the Kernel ERC-1271 format expected by `isValidSignature`.
6. The CLI receives final bytes suitable for external on-chain validation later.

For off-chain requests, replay protection must be provided by the backend using:

- `requestId`
- `expiresAt`

## Backend Remote Signer Authentication

Every backend signing request must be authenticated by a separate agent-signed authorization envelope.

Recommended signed request fields:

- `walletAddress`
- `backendSignerAddress`
- `method`
- `bodyHash`
- `requestId`
- `expiresAt`

The backend must:

1. load the wallet record
2. verify that the request belongs to the expected `agentAddress`
3. verify `expiresAt`
4. reject already-used `requestId` values where replay protection is required
5. verify the agent authentication signature
6. only then perform the backend signature operation

## Data Model Changes

The current `scope` name is tied to the permission-validator model. The migration should replace it with a more accurate name:

- recommended new name: `walletConfig`

The new shared contracts should remove:

- `sessionPublicKey`
- `sessionPrivateKey`
- `serializedPermissionAccount`

The new wallet context should include at least:

- `walletAddress`
- `chainId`
- `kernelVersion`
- `owner`
- `agentAddress`
- `backendAddress`
- weighted validator config

The backend request and local CLI state should both become mode-B-native rather than wrapping old mode-A fields.

## Frontend Impact

The frontend keeps its core role:

- create passkey
- display counterfactual wallet
- guide funding
- publish public wallet artifacts

The frontend must stop:

- creating a permission validator
- serializing a permission account
- depending on the session-key flow

One technical point must be validated during implementation:

- whether the frontend can instantiate `createWeightedECDSAValidator(...)` with provisioning-only signers that expose the required interface but are never used for runtime signing

If this works, it is the preferred path because it preserves use of the official helper for install/config encoding.

## Backend Impact

The backend becomes the wallet-specific co-signer and orchestrator.

New responsibilities:

- generate and store a backend EOA per wallet
- expose backend remote signer endpoints
- authenticate agent requests for signing
- provide replay protection for off-chain signing requests

Mode-A-specific provisioning state should be removed from backend records once the migration is complete.

## CLI Impact

The CLI becomes the runtime signing client.

New responsibilities:

- generate and store the agent EOA
- request wallet creation using `agentAddress`
- instantiate the weighted validator at runtime
- use the backend as a remote signer
- support:
  - transaction/user operation execution
  - off-chain smart-account signature generation

The CLI should stop:

- generating a session key
- storing a permission-account blob
- hydrating a permission account from a serialized payload

## Packages Impact

### `packages/shared`

Must become the source of truth for:

- wallet request contracts
- wallet context
- local CLI state
- remote signer request/response schemas

### `packages/zerodev`

Should be reevaluated after migration.

Expected options:

- either remove the package if the repo only needs direct official ZeroDev helpers
- or repurpose it for small wrappers around:
  - weighted validator runtime creation
  - backend remote signer compatibility helpers

### `contracts`

The outgoing-budget policy is no longer part of the critical mode-B path. The migration should remove mode-A-specific contracts and tests if no remaining feature still depends on them.

## Cleanup List

Expected removals or rewrites:

- `apps/cli/src/session-key.ts`
- `apps/cli/src/kernel.ts`
- `packages/zerodev/src/permission-account.ts`
- `apps/frontend/src/passkey.ts` permission-validator flow
- mode-A-only fields in `packages/shared/src/contracts.ts`
- mode-A tests in CLI, frontend, backend, shared, and zerodev package
- mode-A custom outgoing-budget policy if no longer used

## Validation Targets

Minimum validation for the migration:

1. create and initialize a mode-B wallet with passkey sudo and weighted regular validator
2. produce a transaction/user operation signature path using:
   - local agent signer
   - backend remote signer
3. produce an off-chain signature path whose final bytes are compatible with `isValidSignature`
4. confirm that the runtime uses the official weighted validator assembly rather than a custom ad hoc format
5. confirm that critical paths no longer depend on session-key mode A

## Open Technical Validations

Two implementation-time validations remain mandatory:

1. `createWeightedECDSAValidator(...)` provisioning path
   - verify whether provisioning-only fake signers are sufficient when creating the frontend-side regular validator object

2. direct creation vs secondary enablement
   - verify whether the Kernel account can be created counterfactually with both:
     - `sudo = passkey`
     - `regular = weighted validator`
   - or whether the weighted validator must instead be enabled in a second step signed by the passkey

These do not change the target architecture, but they determine the exact provisioning implementation.

## Recommended Migration Sequence

1. Replace shared mode-A types with mode-B wallet contracts.
2. Add backend generation and persistence of a per-wallet backend EOA.
3. Replace CLI session-key generation with agent EOA generation.
4. Replace frontend permission-validator provisioning with weighted-validator provisioning.
5. Add backend remote signer endpoints and request authentication.
6. Add CLI runtime helpers for weighted validator with:
   - local agent signer
   - backend remote signer
7. Add off-chain signing primitive and replay protection.
8. Remove remaining mode-A code, tests, and contracts.
