# @guardlabs/guardrail-cli

CLI for provisioning and using Guardrail, the Guard Labs wallet-control product for agents.

## Usage

Run without installing globally:

```bash
npx @guardlabs/guardrail-cli create --chain-id 84532
```

Or install it globally:

```bash
npm install -g @guardlabs/guardrail-cli
guardrail --help
```

The installed command name is `guardrail`.

By default, the CLI targets the hosted Guard Labs backend at `https://api.guardlabs.ai`.
Use `--backend-url` only when you want to target a local or self-hosted backend.

Examples in this README omit `--backend-url` for the hosted path. Add it back only for custom deployments.

## Quickstart

Create a wallet request with an official USDC budget limited to `$10` per trailing 24 hours:

```bash
npx @guardlabs/guardrail-cli create \
  --chain-id 84532 \
  --usdc-period daily \
  --usdc-max 10 \
  --usdc-allow transfer,approve,increaseAllowance,permit,transferWithAuthorization
```

Wait for readiness:

```bash
npx @guardlabs/guardrail-cli await wal_xxx
```

Use the ready wallet:

```bash
npx @guardlabs/guardrail-cli call wal_xxx \
  --to 0x1111111111111111111111111111111111111111 \
  --data 0xa9059cbb \
  --value-wei 0
```

## Supported Chains

- `8453`: Base
- `84532`: Base Sepolia

## Docs

Full documentation lives in the repository:

- GitHub: https://github.com/guardlabs/guardrail
- Docs index: https://github.com/guardlabs/guardrail/blob/main/docs/README.md
- Quickstart: https://github.com/guardlabs/guardrail/blob/main/docs/quickstart.md
- CLI reference: https://github.com/guardlabs/guardrail/blob/main/docs/cli.md
