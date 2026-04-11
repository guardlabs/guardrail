# Quickstart

[Docs index](README.md) | [Runtime policy](runtime-policy.md) | [CLI reference](cli.md) | [x402 payments](x402.md)

These examples use the published package name and the official Guard Labs domain shape.

The official hosted frontend is paired with the official backend. If you deploy your own backend, deploy your own frontend too.

The CLI defaults to the hosted backend at `https://api.guardlabs.ai`, so the examples below do not pass `--backend-url`. Add `--backend-url <your-backend>` only when you want to target a local or self-hosted deployment.

The examples below use Base Sepolia (`84532`) for safe testing. Base Mainnet (`8453`) is also supported by the same flow once production endpoints are configured.

## 1. Create A Wallet Request

This example creates a wallet that can only use official USDC and is capped at `$10` over the trailing 24 hours.

```bash
npx @guardlabs/guardrail-cli create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

The command returns:

- a `walletId`
- a provisioning URL for the human owner
- local wallet state stored on disk
- the agent signer address

## 2. Share The Provisioning Link

Send the provisioning URL to the human operator:

```text
https://guardlabs.ai/?walletId=wal_xxx&token=token_xxx
```

The human opens the hosted frontend, creates the passkey, and becomes the durable wallet owner.

## 3. Wait For Readiness

```bash
npx @guardlabs/guardrail-cli await wal_xxx
```

This waits until the wallet is ready for runtime use.

## 4. Check Official USDC Balance

```bash
npx @guardlabs/guardrail-cli usdc-balance wal_xxx
```

This reads `balanceOf` on the official USDC contract for the wallet's configured chain.

## 5. Use The Wallet

```bash
npx @guardlabs/guardrail-cli call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

The runtime call still goes through Guardrail policy checks before the backend co-signs it.

## Optional Commands

Check status:

```bash
npx @guardlabs/guardrail-cli status wal_xxx
```

Check the official USDC balance:

```bash
npx @guardlabs/guardrail-cli usdc-balance wal_xxx
```

Sign typed data:

```bash
npx @guardlabs/guardrail-cli sign-typed-data wal_xxx \
  --typed-data-file ./typed-data.json
```

Complete an x402 challenge:

```bash
npx @guardlabs/guardrail-cli x402-fetch wal_xxx \
  https://api.example.com/premium-data
```

For how the USDC budget actually works, see [Runtime policy](runtime-policy.md).

For the paid-resource flow built on top of the same wallet, see [x402 payments](x402.md).
