# @conduit-wallet/cli

CLI for provisioning and using Conduit Wallet agent wallets.

## Usage

Run without installing globally:

```bash
npx @conduit-wallet/cli create --chain-id 84532
```

Or install it globally:

```bash
npm install -g @conduit-wallet/cli
conduit-wallet --help
```

The installed command name is `conduit-wallet`.

## Quickstart

Create a wallet request with an official USDC budget limited to `$10` per trailing 24 hours:

```bash
npx @conduit-wallet/cli create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

Wait for readiness:

```bash
npx @conduit-wallet/cli await wal_xxx
```

Use the ready wallet:

```bash
npx @conduit-wallet/cli call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

## Supported Chains

- `8453`: Base
- `84532`: Base Sepolia

## Docs

Full documentation lives in the repository:

- GitHub: https://github.com/nmalzieu/conduit
- Docs index: https://github.com/nmalzieu/conduit/blob/main/docs/README.md
- Quickstart: https://github.com/nmalzieu/conduit/blob/main/docs/quickstart.md
- CLI reference: https://github.com/nmalzieu/conduit/blob/main/docs/cli.md
