# Conduit Wallet Design

Date: 2026-03-25
Status: Approved for planning

## Summary

`conduit-wallet` provisions a smart wallet for an agent-triggered Web3 task. A skill running through a local CLI asks for a wallet scoped to a specific chain, target contract, and allowed methods. A human receives a URL, opens it in the browser, creates a passkey that becomes the durable owner/admin of the smart wallet, funds the counterfactual wallet address, and enables the wallet to be activated on first use. The agent generates and keeps its own session private key locally; only the session public key is shared with the orchestration backend.

The system is intentionally split into three independent blocks:

- the CLI on the agent server
- the frontend in the human browser
- an orchestration backend used only during provisioning

The backend may be hosted by the default project operator or by third parties. After the wallet is activated, the backend must no longer be required to use or administer the wallet. A compatible frontend and the human passkey must be sufficient to manage the wallet later.

## Goals

- Let a skill request a wallet for a precise on-chain task.
- Scope the agent to a chain, target contract, and allowed methods.
- Keep the human as the durable wallet owner via passkey.
- Keep the agent autonomous after provisioning through a session key.
- Minimize backend trust and secret handling.
- Allow the backend orchestrator to be replaceable by third-party hosts.
- Ensure wallet administration remains possible even if the original project stops operating.

## Non-Goals

- General-purpose multi-chain orchestration in V1.
- Rich dashboard or account portal in V1.
- Backend custody of agent session keys.
- Backend dependency for post-provisioning wallet management.

## Key Decisions

### Ownership and Permissions

- The human passkey is the durable owner/admin of the smart wallet.
- The agent receives a delegated session key with permissions enforced at the smart wallet level.
- The V1 permission scope is `target contract + allowed methods`.
- The human must be able to evolve or revoke permissions later using the passkey.

### Deployment Model

- The skill provides `chain`, `target_contract`, and `allowed_methods`.
- The chain is explicit per request.
- The V1 uses `Kernel + ZeroDev`.
- The wallet can remain counterfactual before first use.
- Deployment and effective permission installation may happen at the first permitted `UserOperation`.

### Trust Boundary

- The browser creates the human passkey locally.
- The agent CLI generates the session keypair locally.
- The backend never sees the passkey secret.
- The backend never sees the session private key.
- The backend may store only public artifacts and orchestration state.

### Backend Role

- The backend is an orchestrator and rendezvous point between the CLI and the browser.
- The backend is not required for ongoing wallet use after activation.
- The backend stores minimal request state in PostgreSQL.
- The backend does not run a permanent funding watcher.
- Funding may be detected by the browser or the CLI and revalidated on demand by the backend during polling or finalization.

## System Components

### 1. Agent CLI

Runs on the agent server and is the only interface used by skills.

Responsibilities:

- accept wallet creation input from skills
- generate the session keypair locally
- send only public request data to the backend
- return the human-facing URL
- poll the backend for provisioning status
- keep the session private key local
- use the session private key for autonomous post-provisioning actions

The CLI is intentionally thin on product state. It owns secrets local to the agent, but the canonical request record lives on the backend.

### 2. Human Frontend

Runs in the browser via a URL returned by the backend.

Responsibilities:

- consume a provisioning link (a backend URI + wallet id)
- create the human passkey locally
- derive the owner public identity needed by the smart wallet
- display the counterfactual wallet address
- guide the human to fund the address
- publish only the public artifacts required to complete provisioning

The frontend should be open-source and redeployable by third parties. It should be able to point to any compatible backend orchestrator.

### 3. Orchestration Backend

Acts as the bridge between the CLI and the browser.

Responsibilities:

- create and persist a `WalletRequest`
- serve the human flow URL
- accept public artifacts from the browser flow
- return status and final public artifacts to the polling CLI
- revalidate funding on demand when needed
- prepare or finalize the smart wallet configuration against `Kernel + ZeroDev`

The backend should stay deliberately small. It is allowed to orchestrate provisioning, but it must not become a custody layer or a long-term dependency for wallet administration.

## Data Model

### WalletRequest

Minimal PostgreSQL-backed record used during provisioning.

Suggested fields:

- `id`
- `status`
- `chain`
- `target_contract`
- `allowed_methods`
- `session_public_key`
- `owner_public_artifacts`
- `counterfactual_wallet_address`
- `created_at`
- `updated_at`
- `error_code`
- `error_message`

The backend should not store:

- passkey private material
- session private keys
- agent secrets

### Status Lifecycle

- `created`
- `link_opened`
- `owner_bound`
- `funded`
- `ready`
- `activated`
- `failed`

Notes:

- `allowed_methods` and `target_contract` are immutable once the request is created.
- `funded` should be interpreted as verified enough to proceed, not as the result of a permanent watcher.
- `activated` means the wallet has been effectively initialized/deployed and the session permissions are enforceable on-chain.

## End-to-End Flow

1. A skill asks the local CLI for a wallet with `chain`, `target_contract`, and `allowed_methods`.
2. The CLI generates a session keypair locally.
3. The CLI sends a create request to the backend with:
   - chain
   - target contract
   - allowed methods
   - session public key
4. The backend creates a `WalletRequest` in PostgreSQL and returns a human-facing URL.
5. The agent passes that URL to the human.
6. The human opens the URL in the browser.
7. The frontend creates a passkey locally and derives the public owner identity needed by the smart wallet flow.
8. The frontend computes or displays the counterfactual wallet address and instructs the human to fund it.
9. The backend stores the public owner artifacts and updated request state.
10. The CLI polls the backend for request status.
11. The backend may verify funding on demand during polling or during the transition to `ready`.
12. Once funding and public configuration are sufficient, the request becomes `ready`.
13. The first permitted `UserOperation` deploys or initializes the wallet if needed and makes the session permissions effective on-chain.
14. The agent continues using its local session private key for autonomous actions within the allowed scope.

## Portability and Hosting Model

- The project may operate a default orchestrator backend.
- Other operators must be able to host a compatible orchestrator backend.
- The CLI and frontend should be configurable to point to a custom backend.
- The frontend and backend should be open-source so a third party can redeploy them if the original project disappears.
- Existing wallets must remain manageable without the original backend once they are activated.

This means provisioning is a service, but ownership and long-term wallet administration are not captive to that service.

## Security Properties

- The passkey secret remains in the browser environment.
- The session private key remains on the agent server.
- The backend sees only the session public key and public owner artifacts.
- Policy enforcement must happen at the smart wallet level, not in backend logic.
- The backend is not trusted with durable wallet control.

## Error Handling

The V1 must handle at least:

- browser flow abandoned after link open
- owner artifacts created but no funding received
- insufficient funding for activation
- invalid or unsupported method scope
- mismatch between requested chain/contract scope and final provisioning attempt
- failed wallet activation at first `UserOperation`
- agent or CLI restart during polling

The system should support resuming a request from the persisted `WalletRequest` state.

## Testing Strategy

Minimum coverage for V1:

- create a `WalletRequest` from the CLI
- ensure the session private key never leaves the CLI boundary
- complete the browser flow and persist only public owner artifacts
- resume polling after CLI interruption
- verify on-demand funding checks
- activate the wallet on first permitted `UserOperation`
- confirm contract and method restrictions are installed correctly
- verify the human can later manage or revoke permissions with the passkey without relying on the original provisioning backend

## Open Questions

- Exact wallet reuse model beyond the initial likely `per occasion` flow.
- Final representation of `allowed_methods` in request and policy payloads.
- Exact `Kernel + ZeroDev` activation path for deploying and installing permissions atomically on the first permitted operation.
- The minimal compatibility contract that third-party orchestrator hosts must implement for the CLI and frontend.

## References

- ZeroDev SDK docs: https://docs.zerodev.app/sdk/v5_3_x/
- ZeroDev permissions/session keys example: https://7702.zerodev.app/
- Kernel repository: https://github.com/zerodevapp/kernel
