# CLI Reference

[Docs index](README.md) | [Quickstart](quickstart.md) | [x402 payments](x402.md) | [Local development](local-development.md)

The CLI is the main operator entry point for agents.

## Main Commands

Create a wallet request:

```bash
conduit-wallet create --chain-id 84532
```

Inspect a wallet:

```bash
conduit-wallet status wal_123
```

Wait until a wallet is ready:

```bash
conduit-wallet await wal_123 --interval-ms 3000
```

Execute a call:

```bash
conduit-wallet call wal_123 --to 0x1111111111111111111111111111111111111111 --data 0xa9059cbb --value-wei 0
```

Sign typed data:

```bash
conduit-wallet sign-typed-data wal_123 --typed-data-file /tmp/typed-data.json
```

Complete x402 payment flows:

```bash
conduit-wallet x402-sign wal_123 --payment-required-header eyJ4NDAyVmVyc2lvbiI6Mn0=
conduit-wallet x402-fetch wal_123 https://api.example.com/premium-data
```

See [x402 payments](x402.md) for the end-to-end flow and what these commands are doing.

## Create Command Policy Options

Runtime policy is required at wallet creation.

Non-USDC contract policy:

```bash
conduit-wallet create \
  --chain-id 84532 \
  --allow-call '0x1111111111111111111111111111111111111111:transfer(address,uint256)'
```

Official USDC policy:

```bash
conduit-wallet create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

Rules:

- you must provide either `--allow-call` or the full `--usdc-*` set
- `--usdc-period`, `--usdc-max`, and `--usdc-allow` must be provided together
- the official USDC contract must not appear in `--allow-call`

See [Runtime policy](runtime-policy.md) for the semantics behind these flags.
