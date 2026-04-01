# Runtime Policy

[Docs index](README.md) | [Quickstart](quickstart.md) | [How it works](how-it-works.md)

Conduit is deny-by-default on the `agent + backend` runtime path.

The passkey remains the human-controlled admin path. Runtime actions only succeed when they fit the wallet policy and the backend is willing to co-sign them.

## Policy Types

Conduit currently supports two policy mechanisms:

- `--allow-call <address>:<methodOrSelector>[,<methodOrSelector>...]` for non-USDC contract calls
- `--usdc-period`, `--usdc-max`, and `--usdc-allow` together for official USDC

The official USDC contract is reserved for the `--usdc-*` policy and is rejected from the generic allowlist.

## USDC Example: `$10` Daily Limit

```bash
npx @your-scope/conduit-wallet create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

This means:

- only official USDC runtime operations are allowed
- the total authorized amount is capped at `10` USDC over the trailing 24 hours
- the budget is a sliding window, not a midnight reset

## What Counts As Spending

For official USDC, Conduit counts the authorized USDC amount on these operations:

- `transfer`
- `approve`
- `increaseAllowance`
- `Permit`
- `TransferWithAuthorization`

That amount is recorded immediately when the backend approves the action.

Examples:

- a `transfer` of `4` USDC consumes `4` USDC of budget
- an `approve` of `3` USDC consumes `3` USDC of budget
- a `Permit` for `6` USDC consumes `6` USDC of budget even though it is typed data, not a direct token transfer
- a `TransferWithAuthorization` for `2` USDC consumes `2` USDC of budget

So if the wallet already used `4` USDC and then asks for a `Permit` of `6` USDC, the daily budget is full. Another `1` USDC action is denied until enough earlier consumption falls outside the trailing 24-hour window.

## What Does Not Count

- native `ETH` value is not allowed on the runtime path in this version
- arbitrary typed data are denied by default
- unsupported USDC methods are denied
- non-USDC calls do not use the USDC budget; they require explicit `--allow-call` rules instead

## Sliding Windows

Conduit supports three USDC budget windows:

- `daily`: trailing 24 hours
- `weekly`: trailing 7 days
- `monthly`: trailing 30 days

The enforcement is based on exact trailing windows, not calendar resets.

## Trust Model

The important distinction is:

- the human passkey does not go through backend runtime policy checks
- the agent runtime path always depends on backend co-signing

That is what prevents a leaked local agent key from draining the wallet by itself.
