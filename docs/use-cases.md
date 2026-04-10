# Use Cases

[Docs index](README.md) | [Quickstart](quickstart.md) | [How it works](how-it-works.md)

Guardrail is most useful when an agent genuinely needs wallet capabilities, but should not be trusted with a fully exportable hot key.

## Paid API And Resource Access

An agent needs to fetch protected data or use a paid API without asking a human to manually approve every payment.

Why Guardrail fits:

- the agent can complete the runtime payment flow on its own
- the wallet can still be limited to a narrow policy such as official USDC only
- the backend co-signer can refuse anything outside the configured budget or allowed operations

This is the most direct fit for the current x402 support. See [x402 payments](x402.md).

## Task-Scoped Agent Wallets

An agent or skill needs a wallet dedicated to one workflow, one customer, one environment, or one narrow class of calls.

Why Guardrail fits:

- each wallet can be created with a dedicated runtime policy
- the agent gets usable wallet rails without becoming the full owner
- blast radius stays predictable if the local agent key leaks

Examples:

- one wallet per autonomous research agent
- one wallet per integration or customer environment
- one wallet per billing, settlement, or fulfillment flow

## Long-Running Agents With Durable Ownership

Some agent workflows need to survive process restarts, handoffs, or longer-lived operation windows.

Why Guardrail fits:

- the human passkey remains the durable owner path
- the local agent key is not the root of trust
- policy changes can be handled on the owner path later without rebuilding the core trust model

## When Guardrail Is Probably Not Worth It

Guardrail is probably too much machinery if:

- the agent never needs to touch funds or sign anything
- a short-lived burner key is already acceptable for the risk level
- you do not need policy enforcement or durable ownership separation

## Current Product Shape

Right now, the strongest story is:

1. create a dedicated wallet for an autonomous workflow
2. attach a narrow runtime policy
3. let the human own it through a passkey
4. let the agent operate inside that policy

That is the core product shape the current CLI, homepage, and provisioning flow are designed around.
