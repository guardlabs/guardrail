# Agent Wallet V1 Technical Spec

Date: 2026-03-25
Status: Draft for implementation
Source: `docs/superpowers/specs/2026-03-25-agent-wallet-design.md`

## Purpose

This document translates the approved product design into a technical V1 specification:

- runtime blocks and responsibilities
- inter-component contracts
- persisted data model
- lifecycle and state transitions
- minimum compatibility contract for third-party hosts

The design document remains the product source of truth. This document is the implementation source of truth for V1.

## Scope

V1 covers one provisioning flow for one wallet request:

- one explicit chain per request
- one target contract per request
- one allowlist of methods per request
- one human passkey owner
- one agent session keypair

V1 does not cover:

- wallet portfolio management
- multi-chain requests
- backend custody or durable signing
- rich user account management

## Architecture Principles

The implementation must preserve these invariants:

1. The browser creates and keeps the passkey secret.
2. The CLI creates and keeps the session private key.
3. The backend persists only public artifacts and orchestration state.
4. Permission enforcement happens on-chain in the smart wallet configuration.
5. The backend is required for provisioning only, not for later wallet administration.
6. A third-party operator must be able to host a compatible backend and frontend.

## Monorepo Target Shape

The implementation target is a monorepo with at least `backend`, `frontend`, and `cli`.

For V1, the monorepo should stay minimal and implementation-focused. Only the runtime surfaces described in the product design and one shared package are in scope.

## Backend Selection Rule

V1 must support a project-operated default backend while allowing explicit override.

Rules:

- the default backend URL used by the CLI is the project-operated orchestrator URL
- the default backend URL used by the frontend is the project-operated orchestrator URL
- both CLI and frontend must support overriding that default to target a compatible third-party backend
- override is configuration, not a separate feature set; behavior must stay identical once the backend base URL changes

Practical consequence:

- the product ships with our backend as the default path
- portability remains guaranteed because the backend base URL is not hard-coded as an unchangeable dependency

Configuration names:

- CLI flag: `--backend-url`
- CLI environment variable: `AGENT_WALLET_BACKEND_URL`
- frontend environment variable: `AGENT_WALLET_DEFAULT_BACKEND_URL`

Resolution order:

1. explicit CLI flag value
2. CLI environment variable
3. built-in project default backend URL

For the frontend:

1. deployed frontend environment variable
2. built-in project default backend URL

## V1 Working Configuration

These values are fixed for implementation unless changed in the repo documents.

Chain handling:

- `chainId` remains request-scoped and is always provided by the CLI request
- the default chain used for local testing is Base Sepolia

Backend URL:

- there is no production domain yet
- local development uses the local backend

Bundler:

- wallet provisioning uses the ZeroDev SDK with an Alchemy bundler
- bundler configuration is chain-specific
- bundler configuration must come from environment variables and must not be committed
- for local Base Sepolia testing, the current bundler endpoint is `https://base-sepolia.g.alchemy.com/v2/AwKbIjG6JcsQh4owa_7Hq`

Funding threshold:

- `AGENT_WALLET_MIN_FUNDING_WEI` is configurable
- the current working value for V1 is `500000000000000`
- this should be treated as a configured threshold, not as a USD-pegged value

Recommended workspace layout:

```text
apps/
  backend/
  frontend/
  cli/
packages/
  shared/
```

### Mandatory Apps

#### `apps/backend`

Owns:

- HTTP API
- PostgreSQL persistence
- provisioning state machine
- funding verification
- wallet context finalization

Must depend on:

- `packages/shared`

Stack choice:

- Node.js
- TypeScript
- Fastify
- PostgreSQL
- Drizzle

#### `apps/frontend`

Owns:

- provisioning UI
- passkey creation flow
- funding instructions and manual refresh
- resume flow from provisioning link

Must depend on:

- `packages/shared`

Notes:

- V1 frontend is a static React application built with Vite
- V1 frontend does not use SSR
- V1 should keep the frontend thin
- the frontend should not own wallet SDK orchestration beyond what is strictly required for local passkey creation
- when implementing the real frontend UI, use the local skills `frontend-skill` and `frontend-design`
- do not treat the current bootstrap shell as the final frontend implementation

#### `apps/cli`

Owns:

- local command boundary
- local session key generation
- local request persistence
- backend polling
- final wallet context handoff to agent code

Must depend on:

- `packages/shared`

Stack choice:

- Node.js
- TypeScript
- Commander

### Mandatory Shared Package

#### `packages/shared`

This package is the source of truth for shared contracts and simple domain logic.

Owns:

- TypeScript types
- runtime schemas
- request and response codecs
- status enums
- scope normalization
- selector validation
- status transition helpers
- small pure helpers used by multiple apps

Rules:

- no vendor SDK imports
- no filesystem access
- no framework-specific code
- pure functions only

Library choice:

- `zod` for runtime schemas and shared validation

### Dependency Rules

The monorepo should enforce these boundaries:

1. `apps/*` may depend on `packages/*`.
2. `packages/shared` must not depend on any app.
3. `apps/backend` must not import UI code from `apps/frontend`.
4. `apps/cli` must not import browser code from `apps/frontend`.
5. wallet SDK integration lives inside the app that uses it in V1.

### Build and Release Guidance

Recommended default tooling:

- `pnpm` workspaces for dependency management
- `turbo` for task orchestration and caching
- one root TypeScript config with per-package specializations
- `React + Vite` for `apps/frontend`
- `Node.js + Fastify` for `apps/backend`
- `commander` for `apps/cli`
- `zod` for shared runtime schemas
- `drizzle` for PostgreSQL access in `apps/backend`
- `vitest` for unit and integration tests

The CLI should be publishable or runnable independently, but it should still consume the same workspace packages as the frontend and backend.

### Simplification Rule

Default to the smallest shape that preserves trust boundaries and shared contracts:

- shared data shapes and validation go in `packages/shared`
- backend-specific orchestration stays in `apps/backend`
- browser-specific passkey UX stays in `apps/frontend`
- local key management and polling stay in `apps/cli`
- no additional package extraction is in scope for V1

## Technical Blocks

The runtime system is split into three product blocks and one shared technical contract layer.

### Block A. Agent CLI

The CLI is the only entry point used by agent skills.

Responsibilities:

- accept a wallet request from local code or a CLI command
- normalize and validate the requested scope
- generate the session keypair locally
- persist the session private key only on the agent machine
- call the backend create endpoint
- return a human-facing provisioning URL
- poll the backend until the request reaches a terminal or usable state
- expose the final wallet context needed for post-provisioning use

Submodules:

- `scope-normalizer`
- `session-key-manager`
- `orchestrator-client`
- `request-poller`
- `local-request-store`
- `wallet-runtime-adapter`

Inputs:

- `chain_id`
- `target_contract`
- `allowed_methods`
- optional backend base URL override
- optional operator API credential

Outputs:

- `request_id`
- `provisioning_url`
- `session_public_key`
- locally persisted `session_private_key`
- final `wallet_context`

Local persistence requirements:

- the session private key must never be sent over the network
- the CLI must persist request metadata so polling can resume after restart
- filesystem permissions should be restricted to the local user
- V1 may use a local file store; OS keychain integration is recommended but not required

Recommended local record:

```ts
type LocalWalletRequest = {
  requestId: string
  backendBaseUrl: string
  chainId: number
  targetContract: `0x${string}`
  allowedMethods: `0x${string}`[]
  sessionPublicKey: `0x${string}`
  sessionPrivateKeyRef: string
  createdAt: string
  lastKnownStatus: WalletRequestStatus
}
```

### Block B. Human Frontend

The frontend runs in the browser from the provisioning URL.

Responsibilities:

- resolve the request from the URL payload
- display the requested chain and permission scope clearly
- create the passkey locally
- save the passkey wherever the browser is supposed to save it (keychain? password manager?)
- derive the public owner artifacts needed by the smart wallet flow
- compute or fetch the counterfactual wallet address (that will depend on the session key + permissions associated with the session key)
- guide the human to fund the address
- submit only public artifacts back to the backend
- resume the flow if the page is reopened later

Submodules:

- `request-loader`
- `passkey-owner-adapter`
- `wallet-address-preview`
- `funding-status-checker`
- `provisioning-publisher`
- `resume-state-ui`

Browser-side persistence:

- the passkey credential remains managed by the browser platform
- temporary UI state may live in session or local storage
- no session private key is ever handled in the browser

Frontend configuration requirement:

- the frontend deployment must have one configured default backend base URL pointing to the project-operated orchestrator
- that default must be overrideable when the frontend is redeployed by a third party
- the frontend environment variable name is `AGENT_WALLET_DEFAULT_BACKEND_URL`

### Block C. Orchestration Backend

The backend is an ephemeral coordinator and system of record for provisioning state.

Responsibilities:

- create and persist `WalletRequest`
- issue an unguessable provisioning token and URL
- serve request state to the browser and CLI
- accept owner public artifacts from the browser
- derive and persist the counterfactual wallet address if needed
- verify funding on demand
- compile the on-chain permission configuration payload
- return the final public wallet context to the polling CLI

Submodules:

- `wallet-request-api`
- `wallet-request-service`
- `state-machine`
- `funding-verifier`
- `wallet-config-compiler`
- `postgres-repository`

Backend constraints:

- no permanent funding watcher in V1
- no storage of passkey secrets
- no storage of session private keys
- no durable dependency after activation

### Block D. Shared Contracts Layer

This is not a separate product surface, but it should exist as a small shared package or specification.

Responsibilities:

- canonical request and response schemas
- status enum and transition rules
- chain-scoped address and selector normalization rules
- small shared domain helpers

This block is critical to portability. The CLI and frontend must both be able to target a third-party backend by relying on the same JSON contract.

## Canonical Types

V1 should standardize the following types.

```ts
type WalletRequestStatus =
  | 'created'
  | 'link_opened'
  | 'owner_bound'
  | 'funded'
  | 'ready'
  | 'activated'
  | 'failed'

type PermissionScope = {
  chainId: number
  targetContract: `0x${string}`
  allowedMethods: `0x${string}`[] // bytes4 selectors
}

type OwnerPublicArtifacts = {
  ownerType: 'passkey'
  credentialId: string
  credentialPublicKey: string
  ownerIdentifier: string
  attestationFormat?: string
}

type FundingState = {
  status: 'unverified' | 'insufficient' | 'verified'
  balanceWei?: string
  checkedAt?: string
}

type WalletContext = {
  walletAddress: `0x${string}`
  chainId: number
  kernelVersion: string
  sessionPublicKey: `0x${string}`
  owner: OwnerPublicArtifacts
  scope: PermissionScope
  policyDigest: string
  activationState: 'counterfactual' | 'ready' | 'activated'
}

type WalletRequest = {
  id: string
  status: WalletRequestStatus
  scope: PermissionScope
  sessionPublicKey: `0x${string}`
  ownerPublicArtifacts?: OwnerPublicArtifacts
  counterfactualWalletAddress?: `0x${string}`
  funding: FundingState
  walletContext?: WalletContext
  errorCode?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
  expiresAt: string
}
```

## Normalization Rules

These rules are part of the compatibility contract.

### Chain

- `chainId` must use the EIP-155 numeric chain ID.
- The backend must reject unsupported chains explicitly.

### Target Contract

- `targetContract` must be a checksummed EVM address.
- The zero address is invalid in V1.

### Allowed Methods

- `allowedMethods` must be an array of unique 4-byte selectors encoded as `0x`-prefixed hex.
- Empty `allowedMethods` is invalid in V1.
- The backend must treat the list as immutable after request creation.

### Session Key

- The session keypair format must be explicit in code.
- V1 should use a standard EVM-compatible keypair for the agent signer.
- Only the public key is sent to the backend.

### Owner Artifacts

- The browser publishes only material needed to bind the passkey owner to the wallet.
- Private passkey material must never be serialized or transmitted.

## Backend API

All endpoints are versioned under `/v1`.

### 1. Create Wallet Request

`POST /v1/wallet-requests`

Purpose:

- create a provisioning record from the CLI
- return the request id and human-facing URL

Request:

```json
{
  "chainId": 8453,
  "targetContract": "0x1234...",
  "allowedMethods": ["0xa9059cbb"],
  "sessionPublicKey": "0x04..."
}
```

Response:

```json
{
  "requestId": "wr_123",
  "status": "created",
  "provisioningUrl": "https://operator.example/w/wr_123?t=opaque_token",
  "expiresAt": "2026-03-26T10:00:00.000Z"
}
```

Validation:

- reject invalid chain, address, or selector format
- reject duplicate selectors
- mint a high-entropy provisioning token
- store only a hash of the provisioning token

### 2. Get Wallet Request Status for CLI

`GET /v1/wallet-requests/:requestId`

Purpose:

- allow polling by the CLI
- return only public state

Response:

```json
{
  "id": "wr_123",
  "status": "ready",
  "scope": {
    "chainId": 8453,
    "targetContract": "0x1234...",
    "allowedMethods": ["0xa9059cbb"]
  },
  "sessionPublicKey": "0x04...",
  "counterfactualWalletAddress": "0xabcd...",
  "funding": {
    "status": "verified",
    "balanceWei": "1200000000000000",
    "checkedAt": "2026-03-25T15:00:00.000Z"
  },
  "walletContext": {
    "walletAddress": "0xabcd...",
    "chainId": 8453,
    "kernelVersion": "v1",
    "sessionPublicKey": "0x04...",
    "owner": {
      "ownerType": "passkey",
      "credentialId": "cred_1",
      "credentialPublicKey": "0x...",
      "ownerIdentifier": "owner_1"
    },
    "scope": {
      "chainId": 8453,
      "targetContract": "0x1234...",
      "allowedMethods": ["0xa9059cbb"]
    },
    "policyDigest": "0xdeadbeef",
    "activationState": "ready"
  }
}
```

### 3. Resolve Request for Browser

`GET /v1/provisioning/:requestId?t=:token`

Purpose:

- load the request in the browser
- validate the provisioning token

Response:

```json
{
  "id": "wr_123",
  "status": "created",
  "scope": {
    "chainId": 8453,
    "targetContract": "0x1234...",
    "allowedMethods": ["0xa9059cbb"]
  },
  "counterfactualWalletAddress": null,
  "expiresAt": "2026-03-26T10:00:00.000Z"
}
```

Side effect:

- first successful resolution may transition `created -> link_opened`

### 4. Publish Owner Artifacts

`POST /v1/provisioning/:requestId/owner-artifacts?t=:token`

Purpose:

- bind the human owner identity to the request

Request:

```json
{
  "owner": {
    "ownerType": "passkey",
    "credentialId": "cred_1",
    "credentialPublicKey": "0x...",
    "ownerIdentifier": "owner_1"
  }
}
```

Response:

```json
{
  "status": "owner_bound",
  "counterfactualWalletAddress": "0xabcd..."
}
```

Rules:

- the backend persists only public owner artifacts
- the backend derives or confirms the counterfactual address
- the request scope must remain unchanged

### 5. Check Funding

`POST /v1/wallet-requests/:requestId/funding-check`

Purpose:

- verify funding on demand from CLI or browser

Response:

```json
{
  "status": "funded",
  "funding": {
    "status": "verified",
    "balanceWei": "1200000000000000",
    "checkedAt": "2026-03-25T15:00:00.000Z"
  }
}
```

Rules:

- no background watcher is required
- the backend queries chain state on demand
- `funded` means the current balance is sufficient for the configured activation path

### 6. Finalize Wallet Context

`POST /v1/wallet-requests/:requestId/finalize`

Purpose:

- compile the final public wallet configuration
- transition to `ready` when owner artifacts and funding are sufficient

Response:

```json
{
  "status": "ready",
  "walletContext": {
    "walletAddress": "0xabcd...",
    "chainId": 8453,
    "kernelVersion": "v1",
    "sessionPublicKey": "0x04...",
    "owner": {
      "ownerType": "passkey",
      "credentialId": "cred_1",
      "credentialPublicKey": "0x...",
      "ownerIdentifier": "owner_1"
    },
    "scope": {
      "chainId": 8453,
      "targetContract": "0x1234...",
      "allowedMethods": ["0xa9059cbb"]
    },
    "policyDigest": "0xdeadbeef",
    "activationState": "ready"
  }
}
```

Rules:

- finalization must be idempotent
- the backend may call the chain adapter here, but it must not require a long-lived backend process afterward

## State Machine

Canonical lifecycle:

| State | Meaning | Entry Condition | Exit Condition |
| --- | --- | --- | --- |
| `created` | request exists, browser has not loaded it yet | create request | browser resolves provisioning link |
| `link_opened` | human opened the flow | valid link resolution | owner artifacts submitted |
| `owner_bound` | passkey public owner is bound | owner artifacts stored | funding verified |
| `funded` | counterfactual wallet balance is sufficient | on-demand funding check succeeds | finalization succeeds |
| `ready` | wallet context is compiled and usable | finalization succeeds | first successful permitted operation activates wallet |
| `activated` | wallet is initialized on-chain and session policy is active | first permitted user operation succeeds | terminal success |
| `failed` | request cannot proceed without intervention | explicit unrecoverable error | optional operator retry path |

Transition rules:

- no transition may mutate `chainId`, `targetContract`, or `allowedMethods`
- `failed` must preserve the last known public artifacts for diagnostics
- polling must be safe and repeatable across restarts

## PostgreSQL Model

V1 should separate immutable request scope, mutable provisioning state, and audit timestamps.

Suggested table:

```sql
create table wallet_requests (
  id text primary key,
  status text not null,
  chain_id integer not null,
  target_contract text not null,
  allowed_methods jsonb not null,
  session_public_key text not null,
  provisioning_token_hash text not null,
  owner_public_artifacts jsonb,
  counterfactual_wallet_address text,
  funding_status text not null default 'unverified',
  funding_balance_wei text,
  funding_checked_at timestamptz,
  wallet_context jsonb,
  error_code text,
  error_message text,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

Indexes:

- index on `status`
- index on `created_at`
- index on `expires_at`

Persistence rules:

- `allowed_methods` is stored exactly as normalized at create time
- `owner_public_artifacts` is nullable until the browser step completes
- `wallet_context` is nullable until finalization
- expired requests may be garbage-collected without affecting already activated wallets

## Wallet Integration Boundary

Vendor-specific logic for `Kernel + ZeroDev` must remain isolated in code, but for V1 it lives inside the runtime apps that need it instead of a separate package.

In practice:

- backend owns provisioning-time wallet compilation and funding estimation
- cli owns first-operation activation and post-provisioning runtime use
- shared types exchanged between them still live in `packages/shared`
- ZeroDev SDK is used with:
  - main key = human passkey
  - session key = agent local key with scoped permissions
  - Alchemy bundler configured per chain via environment variables

The following interface remains a useful internal design target.

```ts
type WalletProvisioningAdapter = {
  deriveCounterfactualAddress(input: {
    chainId: number
    owner: OwnerPublicArtifacts
    sessionPublicKey: `0x${string}`
    scope: PermissionScope
  }): Promise<`0x${string}`>

  estimateRequiredFunding(input: {
    chainId: number
    owner: OwnerPublicArtifacts
    sessionPublicKey: `0x${string}`
    scope: PermissionScope
  }): Promise<{ minimumBalanceWei: string }>

  compileWalletContext(input: {
    chainId: number
    owner: OwnerPublicArtifacts
    sessionPublicKey: `0x${string}`
    scope: PermissionScope
  }): Promise<WalletContext>
}
```

Rationale:

- the rest of each app should not depend directly on SDK-specific objects
- the JSON contract remains stable even if the internal integration changes

## CLI Interface Specification

The CLI should expose both a programmatic API and a command boundary.

Programmatic API:

```ts
type CreateWalletInput = {
  chainId: number
  targetContract: `0x${string}`
  allowedMethods: `0x${string}`[]
  backendBaseUrl?: string // overrides the project default backend
}

type CreateWalletResult = {
  requestId: string
  provisioningUrl: string
  sessionPublicKey: `0x${string}`
}

type AwaitWalletResult =
  | { status: 'ready'; walletContext: WalletContext }
  | { status: 'activated'; walletContext: WalletContext }
  | { status: 'failed'; errorCode?: string; errorMessage?: string }
```

Command boundary:

- `agent-wallet create`
- `agent-wallet status <request-id>`
- `agent-wallet await <request-id>`
- `agent-wallet --help`
- `agent-wallet <command> --help`

CLI behavior:

- `create` generates the session keypair locally
- `await` resumes cleanly after process restart using the local request store
- `status` must not require access to the session private key

CLI discoverability requirements:

- `agent-wallet --help` is mandatory in V1
- every subcommand must support `--help`
- help output must list available commands, required arguments, supported flags, and one minimal example
- help output should stay concise and stable enough for agents to parse visually
- command names and flag names shown in help are part of the V1 CLI contract

CLI configuration requirement:

- the CLI must work with the project default backend when no override is provided
- the CLI must support an explicit backend URL override through its command interface
- the CLI override flag name is `--backend-url`
- the CLI environment variable name is `AGENT_WALLET_BACKEND_URL`
- the root help and `create --help` output must document `--backend-url`

Example:

```bash
agent-wallet create \
  --chain-id 8453 \
  --target-contract 0x1234... \
  --allowed-method 0xa9059cbb \
  --backend-url https://operator.example
```

Minimum help coverage:

- root help for global navigation
- `create --help`
- `status --help`
- `await --help`

CLI implementation note:

- V1 CLI command parsing and help generation should be implemented with `commander`

## Frontend Flow Specification

The browser flow should be linear and resumable.

Step 1. Load request:

- validate token
- show chain, target contract, and allowed methods
- show expiration if present

Step 2. Create passkey:

- create the credential locally
- derive public owner artifacts
- submit owner artifacts

Step 3. Show funding target:

- display the counterfactual address
- provide chain-aware funding instructions
- allow manual refresh

Step 4. Ready confirmation:

- call funding check and finalization as needed
- show when the wallet is ready for the agent

UX constraints:

- the frontend must clearly state that the human remains the durable owner
- the allowed scope must be understandable before the passkey is created
- reopening the same link should resume from current backend state

## Security Requirements

The following are mandatory V1 controls.

### Secret Boundaries

- passkey secrets never leave the browser platform
- session private keys never leave the CLI host
- provisioning tokens are stored hashed on the backend

### Request Integrity

- request scope is immutable after creation
- the backend must reject attempts to bind owner artifacts to an expired or failed request
- every status-changing operation must validate the current state before transition

### Abuse Controls

- the create endpoint should support operator authentication or rate limiting
- provisioning tokens must be high entropy and single-purpose
- error responses must not leak sensitive internals

## Failure Handling

V1 must treat these as first-class scenarios.

### Browser abandoned

- request remains resumable until expiration
- CLI polling continues to report the current state

### No funding

- request can remain in `owner_bound`
- repeated funding checks are allowed

### Insufficient funding

- backend returns the last observed balance
- request does not advance to `ready`

### Activation failure on first use

- the first post-provisioning caller records the failure reason locally
- backend state may remain `ready` until an explicit activation confirmation path exists
- V1 should not infer `activated` without a successful on-chain confirmation

### CLI restart

- polling resumes from the local request store
- the session private key reference remains local and stable

## Third-Party Compatibility Contract

A third-party backend is considered compatible if it satisfies all of the following:

1. Implements the `/v1` endpoints in this document.
2. Preserves the canonical status model.
3. Treats `chainId`, `targetContract`, and `allowedMethods` as immutable.
4. Accepts and returns canonical JSON types.
5. Returns a wallet context that a compatible frontend and CLI can consume without operator-specific assumptions.

The frontend is considered portable if it requires only:

- backend base URL
- request id
- provisioning token

No frontend feature may depend on private operator state outside the documented API.

## Testing Requirements

Minimum V1 coverage:

- create request with valid scope
- reject invalid selector format
- confirm session private key is never serialized to backend payloads
- bind owner artifacts and compute a counterfactual address
- resume CLI polling after interruption
- verify funding on demand
- finalize a request into `ready`
- execute first permitted operation and confirm on-chain activation
- reject disallowed contract or method usage
- confirm the human can later revoke or update permissions with the passkey

Testing constraints:

- no separate testing package is required in V1
- `vitest` is the test runner for V1
- unit tests for shared logic should live with `packages/shared`
- backend API and state-machine tests should live in `apps/backend`
- cli flow tests should live in `apps/cli`
- frontend flow tests should cover only the core provisioning path and resume behavior
- the default local test chain is Base Sepolia

## Implementation Slices

A pragmatic delivery order for V1:

1. Bootstrap monorepo root with `apps/backend`, `apps/frontend`, `apps/cli`, and `packages/shared`
2. Implement `packages/shared` as the contract source of truth
3. Implement backend request creation, state persistence, funding checks, and finalization in `apps/backend`
4. Implement CLI local key generation, local store, and polling in `apps/cli`
5. Implement frontend request load, passkey publication, funding guidance, and resume flow in `apps/frontend`
6. Wire first-operation activation flow in `apps/cli`
7. Add only the minimum unit and integration tests required by the V1 flows

## Open Decisions Still Needed

These are narrower than the product-level open questions and should be resolved before coding the chain adapter.

1. Exact EVM key type used for the session signer in the CLI.
2. Exact translation from `{ credentialId, publicKey }` into the `Kernel + ZeroDev` owner configuration.
3. Whether request expiration is enforced at 24h, 7d, or operator-configurable.

## Recommended Next Document

The next useful artifact is an implementation plan that maps this spec into:

- packages or services to create
- endpoint-by-endpoint tasks
- frontend screens
- integration tests
- workspace bootstrap tasks and dependency boundaries
