# Quickstart

[Docs index](README.md) | [Runtime policy](runtime-policy.md) | [CLI reference](cli.md) | [x402 payments](x402.md)

These examples use placeholder package and hosted URLs until the public deployment is finalized.

The official hosted frontend is paired with the official backend. If you deploy your own backend, deploy your own frontend too.

## 1. Create A Wallet Request

This example creates a wallet that can only use official USDC and is capped at `$10` over the trailing 24 hours.

```bash
npx @your-scope/conduit-wallet create \
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
https://app.example.com/?walletId=wal_xxx&token=token_xxx
```

The human opens the hosted frontend, creates the passkey, and becomes the durable wallet owner.

## 3. Wait For Readiness

```bash
npx @your-scope/conduit-wallet await wal_xxx
```

This waits until the wallet is ready for runtime use.

## 4. Use The Wallet

```bash
npx @your-scope/conduit-wallet call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

The runtime call still goes through Conduit policy checks before the backend co-signs it.

## Optional Commands

Check status:

```bash
npx @your-scope/conduit-wallet status wal_xxx
```

Sign typed data:

```bash
npx @your-scope/conduit-wallet sign-typed-data wal_xxx \
  --typed-data-file ./typed-data.json
```

Complete an x402 challenge:

```bash
npx @your-scope/conduit-wallet x402-fetch wal_xxx \
  https://api.example.com/premium-data
```

For how the USDC budget actually works, see [Runtime policy](runtime-policy.md).

For the paid-resource flow built on top of the same wallet, see [x402 payments](x402.md).
