# Runtime Policy V1 Design

Date: 2026-03-31
Status: Approved for planning

## Summary

This document defines the first backend-enforced runtime policy model for Conduit Wallet.

The model is intentionally opinionated:

- the human passkey remains fully privileged
- passkey actions do not pass through the backend policy path
- the `agent + backend` runtime path starts with zero permissions
- the backend only co-signs actions that were explicitly authorized at wallet creation time

V1 introduces two policy mechanisms:

- a generic contract allowlist for non-USDC contract calls
- a dedicated official-USDC policy for a narrow, closed set of USDC operations

Those mechanisms may be configured together, but at least one of them must be present.

## Current Repo Findings

### Current Wallet Creation Shape

Today, the CLI `create` flow only sends:

- `walletMode`
- `chainId`
- `agentAddress`

The shared request schemas and backend persistence model do not yet include any policy payload.

### Current Backend Signing Shape

Today, backend co-signing is exposed through a single generic route:

- `POST /v1/wallets/:walletId/backend-sign`

That route verifies:

- wallet readiness
- backend signer identity
- a short-lived agent authorization envelope
- request replay protection

It does not currently enforce any business policy.

### Current Runtime Limitation

The existing backend signer abstraction acts like a generic signer:

- `signMessage`
- `signTypedData`

That is sufficient for a remote signer, but insufficient for policy enforcement on runtime transactions because the backend does not currently receive or verify the full user operation intent for `call`.

## Goals

- Make runtime backend co-signing `deny-by-default`.
- Allow wallet creation to include an immutable runtime policy.
- Enforce policy for backend-approved transactions and typed data.
- Keep the passkey admin path outside the runtime policy model.
- Reserve official USDC for a closed, opinionated policy mechanism.
- Keep the first version narrow and auditable.

## Non-Goals

- Native ETH spending budgets
- WETH budgets
- Generic ERC-20 budget policies
- Batch user operations
- Arbitrary typed-data signing
- Flexible overlap between the generic allowlist and the USDC policy
- Automatic budget refunds if a signed permission is never used on-chain

## Policy Model

### Global Rules

- The passkey has full rights.
- Passkey actions do not pass through backend policy enforcement.
- The `agent + backend` runtime path starts with zero permissions.
- The backend only co-signs explicitly authorized actions.
- Wallet creation must include at least one configured mechanism:
  - `contractAllowlist`
  - `usdcPolicy`

### Mechanism 1: Generic Contract Allowlist

The generic mechanism authorizes contract calls outside the official USDC contract.

Shape:

- `contractAddress`
- explicit `allowedSelectors`

Rules:

- no wildcard contract
- no wildcard method
- native `value` must be `0`
- the official USDC contract address is forbidden in this mechanism

### Mechanism 2: Official USDC Policy

The USDC mechanism applies only to the official USDC contract already referenced by chain metadata.

It is intentionally closed and opinionated:

- a single budget period:
  - `daily`
  - `weekly`
  - `monthly`
- a single USDC budget ceiling
- a closed allowlist of supported USDC operations
- all other USDC methods and typed data are rejected

### Partition Rule

The two mechanisms do not overlap in V1.

- If a transaction targets the official USDC contract, only `usdcPolicy` applies.
- If a transaction targets any other contract, only `contractAllowlist` applies.
- If the official USDC address appears in `contractAllowlist`, wallet creation fails.

This removes ambiguity and avoids accidental widening of USDC permissions through the generic allowlist.

## Supported USDC Operations In V1

### Transactions

Supported official-USDC transactions:

- `transfer(address,uint256)`
- `approve(address,uint256)`
- `increaseAllowance(address,uint256)`

Not supported in V1:

- `transferFrom`
- any other USDC function

### Typed Data

Supported official-USDC typed data:

- `Permit`
- `TransferWithAuthorization`

Not supported in V1:

- `ReceiveWithAuthorization`
- any other typed-data shape

## Budget Consumption Rules

The backend records budget consumption at the moment it successfully co-signs.

This is intentionally conservative. A permission counts as spent once the backend authorizes it, even if the authorization is never exercised on-chain.

Consumption rules:

- `transfer(to, amount)` consumes `amount`
- `approve(spender, amount)` consumes `amount`
- `increaseAllowance(spender, addedValue)` consumes `addedValue`
- `Permit` consumes `value`
- `TransferWithAuthorization` consumes `value`

There is no budget refund in V1.

### Sliding Window Semantics

The budget period uses exact rolling windows rather than fixed UTC calendar windows.

That means:

- `daily` means the trailing last `24 hours`
- `weekly` means the trailing last `7 days`
- `monthly` means the trailing last `30 days`

Examples:

- a `daily` authorization granted at `2026-03-31T15:12:00Z` stops counting at `2026-04-01T15:12:00Z`
- a `weekly` authorization stops counting exactly `7 days` later
- there is no reset at UTC midnight, Monday midnight, or the first of the month

## API Design

### Remove The Blind Signer Route

The current generic route is removed:

- `POST /v1/wallets/:walletId/backend-sign`

It is replaced with explicit policy-aware routes:

- `POST /v1/wallets/:walletId/backend-sign-typed-data`
- `POST /v1/wallets/:walletId/backend-sign-user-operation`
- `POST /v1/wallets/:walletId/backend-deploy-wallet`

### Shared Authorization Envelope

Each route uses an agent-signed authorization envelope over the full backend request body.

That envelope authenticates:

- the wallet address
- the backend signer address
- the backend method being requested
- the body hash
- the request id
- the expiry

The backend verifies that:

- the agent signed the body being processed
- the body being processed matches the operation it will actually sign

### Typed Data Route

`backend-sign-typed-data` is used only for explicit typed-data signing requests.

The backend receives:

- the typed data
- the agent authorization envelope

The backend verifies:

- wallet readiness
- auth validity and replay protection
- official USDC `verifyingContract`
- matching chain id
- supported `primaryType`
- exact supported field shape
- operation explicitly enabled in `usdcPolicy`
- sufficient remaining budget

Everything else is rejected.

### User Operation Route

`backend-sign-user-operation` is used for runtime smart-wallet calls.

The backend receives:

- the full user operation
- a declared `single_call` operation context:
  - `to`
  - `data`
  - `value`
- the agent authorization envelope

The backend verifies:

- wallet readiness
- auth validity and replay protection
- `sender == walletAddress`
- `initCode == 0x`
- the Kernel call data decodes to a single call
- the decoded call exactly matches the declared operation context
- the call is allowed under the relevant policy partition

The backend then recomputes and signs the actual `userOpHash` itself rather than signing an opaque hash supplied by the client.

### Deploy Wallet Route

`backend-deploy-wallet` is a narrow technical route used only to bootstrap a wallet before the first runtime call.

The backend verifies:

- wallet readiness
- deployment not already completed
- valid agent authorization envelope
- expected deployment-only user operation shape
- no embedded arbitrary business call

This keeps deployment bootstrap separate from policy-controlled business actions.

## CLI Surface

The CLI `create` command gains explicit policy flags.

### Generic Calls

- `--allow-call <address>:<methodOrSelector>[,<methodOrSelector>...]`

Rules:

- option may be repeated
- methods may be provided as Solidity signatures or selectors
- CLI normalizes everything to unique `bytes4` selectors before submission

### USDC Policy

- `--usdc-period <daily|weekly|monthly>`
- `--usdc-max <amount>`
- `--usdc-allow <op[,op...]>`

Rules:

- all three USDC flags are required together
- `--usdc-max` is entered in human-readable USDC and normalized to 6-decimal minor units
- supported ops are only:
  - `transfer`
  - `approve`
  - `increaseAllowance`
  - `permit`
  - `transferWithAuthorization`

### Create Validation

Wallet creation fails when:

- neither mechanism is configured
- the official USDC contract appears in `--allow-call`
- a selector or Solidity signature cannot be normalized
- a USDC block is partially configured
- the normalized policy is empty after validation

## Frontend Provisioning Presentation

The human provisioning flow must display the runtime policy attached to the wallet request before the passkey owner is created.

This display should be intentionally simple and readable rather than exhaustive.

Minimum requirements:

- show that the passkey remains fully privileged
- show that the `agent + backend` runtime path is restricted by policy
- summarize the generic contract allowlist in a compact form
- summarize the official-USDC policy, including:
  - budget period
  - budget ceiling
  - allowed official-USDC operations

The frontend is not the policy enforcement point. It is a human confirmation surface that helps the wallet owner understand what rights are being delegated before completing provisioning.

## Persistence Model

The wallet request now stores an immutable policy object as part of the request lifecycle.

The backend must also persist budget consumption events per wallet so it can decide whether another USDC authorization fits in the configured rolling window.

V1 should store enough data to answer:

- what policy was configured
- which budget-consuming authorizations have been granted
- how much each authorization consumed
- which of those authorizations still fall inside the active rolling interval

The backend is the source of truth for that state.

## Enforcement Model

### Non-USDC Calls

A non-USDC runtime call is allowed only when:

- `value == 0`
- target contract is in `contractAllowlist`
- selector is in the target contract's allowed selector set

Otherwise it is denied.

### USDC Calls

A USDC runtime call is allowed only when:

- `usdcPolicy` exists
- the method is in the supported V1 set
- the operation is explicitly enabled in `usdcPolicy.allowedOperations`
- there is enough remaining budget

Otherwise it is denied.

### Typed Data

All typed data are denied by default.

Only official-USDC typed data with supported V1 shapes are eligible for approval, and only when the corresponding USDC operation is explicitly enabled.

## Error Model

Recommended backend error families:

- `policy_missing`
- `policy_denied`
- `contract_not_allowed`
- `method_not_allowed`
- `native_value_not_allowed`
- `usdc_policy_missing`
- `usdc_contract_forbidden_in_contract_allowlist`
- `typed_data_not_supported`
- `typed_data_not_usdc_official`
- `usdc_operation_not_allowed`
- `usdc_budget_exceeded`
- `batch_not_supported`
- `user_operation_initcode_not_allowed`
- `user_operation_call_mismatch`
- `deploy_not_allowed`
- `deploy_already_completed`

## Testing Strategy

Minimum V1 coverage should include:

- schema validation for policy creation inputs
- CLI normalization of allowlisted methods and USDC flags
- create-route rejection when no mechanism is configured
- create-route rejection when official USDC is placed in the generic allowlist
- backend allow/deny tests for non-USDC user operations
- backend allow/deny tests for official-USDC transactions
- backend allow/deny tests for official-USDC typed data
- budget exhaustion behavior across repeated approvals and signatures
- explicit rejection of unsupported typed data and unsupported USDC methods
- deployment route isolation from normal runtime calls
- at least one full end-to-end policy success case on the real local stack
- at least one full end-to-end policy denial case on the real local stack
- at least one full end-to-end USDC budget exhaustion case on the real local stack

The end-to-end policy coverage should reuse the existing real-system test topology:

- Docker Postgres
- forked Base Sepolia Anvil
- local backend
- real CLI commands
- real runtime signing path

The policy implementation is not complete until the real stack demonstrates:

- one explicitly authorized action succeeds
- one forbidden action is denied by backend policy
- one over-budget official-USDC action is denied after earlier consumption

## README Impact

Once implemented, the root `README.md` must be updated to reflect:

- `deny-by-default` runtime permissions
- the passkey vs `agent + backend` split
- the two policy mechanisms
- the official-USDC partition rule
- the new `create` CLI options
- the fact that typed data are denied by default except for a narrow supported official-USDC subset
