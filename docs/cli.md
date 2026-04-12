# CLI Reference

[Docs index](README.md) | [Quickstart](quickstart.md) | [x402 payments](x402.md) | [Local development](local-development.md)

The CLI is the main operator entry point for agents.

Published package: `@guardlabs/guardrail-cli`

Installed binary: `guardrail`

Default backend: `https://api.guardlabs.ai`

Use `--backend-url` only when you want to target a local or self-hosted backend.

Examples in this guide omit `--backend-url` for the hosted path and only add it back when illustrating local development or custom deployments.

## Main Commands

Create a wallet request:

```bash
guardrail create --chain-id 84532
```

Inspect a wallet:

```bash
guardrail status wal_123
```

Wait until a wallet is ready:

```bash
guardrail await wal_123 --interval-ms 3000
```

When a wallet reaches `ready`, `guardrail await` includes `localStatePath` plus an `agentMemoryReminder` field in its JSON output so agent runtimes can persist the wallet details into durable client memory. This means persistent cross-session memory, not a day-only log.

Execute a call:

```bash
guardrail call wal_123 --to 0x1111111111111111111111111111111111111111 --data 0xa9059cbb --value-wei 0
```

If the smart wallet is still undeployed, `guardrail call` deploys it automatically first.

Read the official USDC balance:

```bash
guardrail usdc-balance wal_123
```

Sign typed data:

```bash
guardrail sign-typed-data wal_123 --typed-data-file /tmp/typed-data.json
```

Complete x402 payment flows:

```bash
guardrail x402-sign wal_123 --payment-required-header eyJ4NDAyVmVyc2lvbiI6Mn0=
guardrail x402-fetch wal_123 https://api.example.com/premium-data
```

See [x402 payments](x402.md) for the end-to-end flow and what these commands are doing.

## Official USDC Balance

Use `usdc-balance` to read the balance of the official USDC contract for the wallet's configured chain.

```bash
guardrail usdc-balance wal_123
```

What it does:

- reads the wallet's chain from local Guardrail state
- refreshes the wallet state with the backend so the wallet address is up to date
- queries `balanceOf` on the official USDC contract for that chain
- returns both the raw minor-unit balance and the human-readable USDC amount

Constraints:

- the wallet must already have a wallet address, so the owner provisioning step must be complete
- the command follows the wallet's configured chain and official USDC address automatically
- use `--backend-url` only when you need to target a local or self-hosted backend instead of the hosted default

## Create Command Policy Options

Runtime policy is required at wallet creation.

## Create Command Parameters

### `--chain-id`

The EIP-155 chain id for the wallet request.

Example:

```bash
guardrail create --chain-id 84532
```

Current support:

- `8453`: Base
- `84532`: Base Sepolia

The selected chain controls the wallet configuration and the official USDC contract used by the dedicated USDC policy.

### `--allow-call`

Adds a non-USDC runtime allowlist entry.

Format:

```text
--allow-call <address>:<methodOrSelector>[,<methodOrSelector>...]
```

What it means:

- `<address>` is the target contract address
- each method can be either a raw `0x` selector or a Solidity signature such as `transfer(address,uint256)`
- the CLI normalizes these method entries into selectors
- you can pass `--allow-call` multiple times for multiple contracts
- repeated entries for the same contract are merged into one allowlist

Example:

```bash
guardrail create \
  --chain-id 84532 \
  --allow-call '0x1111111111111111111111111111111111111111:transfer(address,uint256),approve(address,uint256)'
```

Important constraints:

- `--allow-call` is for non-USDC contracts
- the official USDC contract must not appear here
- native `ETH` value is still not allowed on the runtime path in this version

### `--usdc-period`

Defines the sliding budget window for official USDC spending.

Allowed values:

- `daily`: trailing 24 hours
- `weekly`: trailing 7 days
- `monthly`: trailing 30 days

This is a trailing window, not a calendar reset.

### `--usdc-max`

Defines the maximum official USDC amount allowed inside the selected budget window.

It is written in human-readable USDC units:

- `10` means `10` USDC
- `0.5` means `0.5` USDC

The CLI converts this to USDC minor units internally using the chain's official USDC decimals.

### `--usdc-allow`

Defines which official USDC operations the backend may co-sign on the runtime path.

Format:

```text
--usdc-allow <comma-separated-operations>
```

Supported operations in the current product shape:

- `transfer`
- `approve`
- `increaseAllowance`
- `permit`
- `transferWithAuthorization`

Example:

```bash
guardrail create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

What this means:

- only official USDC uses this policy
- only the listed operations are allowed
- the authorized amount for those operations consumes the configured USDC budget
- anything outside this allowlist is denied by the backend

### Required Combinations

- you must provide at least one runtime policy mechanism
- that means either `--allow-call`, or the full `--usdc-period + --usdc-max + --usdc-allow` set
- if you provide one `--usdc-*` flag, you must provide all three

In practice:

- `--chain-id` selects the chain and wallet environment
- `--allow-call` authorizes specific non-USDC contract methods
- `--usdc-period`, `--usdc-max`, and `--usdc-allow` define the dedicated official USDC policy

Non-USDC contract policy:

```bash
guardrail create \
  --chain-id 84532 \
  --allow-call '0x1111111111111111111111111111111111111111:transfer(address,uint256)'
```

Official USDC policy:

```bash
guardrail create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

Rules:

- you must provide either `--allow-call` or the full `--usdc-*` set
- `--usdc-period`, `--usdc-max`, and `--usdc-allow` must be provided together
- the official USDC contract must not appear in `--allow-call`

See [Runtime policy](runtime-policy.md) for how the backend applies these flags at runtime.
