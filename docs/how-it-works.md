# How It Works

[Docs index](README.md) | [Runtime policy](runtime-policy.md) | [CLI reference](cli.md)

Guardrail is the Guard Labs wallet-control product for agents that need to act without controlling a fully privileged wallet key.

## Ownership Split

The ownership model is split:

- the human stays the owner through a passkey
- the agent can trigger runtime actions
- the backend must still approve runtime actions before they execute

This makes the model safer than handing the agent a hot EOA private key. If the local agent key leaks, it is still not enough to drain the wallet or execute arbitrary actions.

The backend signer is still signing material, but in this model it is not meant to be an independently sufficient wallet secret. Guardrail only grants runtime access when the runtime validator sees both the local agent signature and the backend signature.

## High-Level Flow

1. The CLI creates a wallet request and generates an agent key locally.
2. The backend creates a matching Guardrail co-signer and returns a provisioning link.
3. A human opens the hosted frontend, creates a passkey, and becomes the wallet owner.
4. Once the wallet is ready, the agent can trigger actions autonomously.
5. Each runtime action still requires backend approval under the configured policy.

On the hosted path, the CLI talks to `https://api.guardlabs.ai` by default. `--backend-url` is only needed for local or self-hosted backends.

## Technical Shape

Guardrail currently builds on [Kernel](https://github.com/zerodevapp/kernel), the modular ERC-4337 smart account, and uses [ZeroDev](https://zerodev.app/) plus the [ZeroDev SDK](https://docs.zerodev.app/).

The wallet uses two validator layers:

- a human passkey as the `sudo` validator
- a weighted ECDSA validator for runtime use

In the current setup, the runtime validator is `2-of-2`:

- one signer is the agent key
- one signer is the Guardrail backend
- both signatures are required on the runtime path

The provisioning frontend shows the attached runtime policy before the human creates the passkey owner.

## Deployment Pairing

The official hosted frontend is intentionally paired with the official backend. Provisioning links only carry the wallet request and token. They do not carry a backend override.

If you deploy your own backend, deploy your own frontend with the matching backend URL and origin settings.

## Supported Chains

Guardrail currently targets Base and Base Sepolia:

- Base: chain id `8453`
- Base Sepolia: chain id `84532`
