#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import {
  evmAddressSchema,
  outgoingBudgetFlowSchema,
  outgoingBudgetPeriodSchema,
  supportedChains,
} from "@agent-wallet/shared";
import {
  registerAwaitCommand,
  registerCallCommand,
  registerCreateCommand,
  registerStatusCommand,
} from "./commands.js";
import { loadEnvFiles } from "./env.js";

loadEnvFiles();

function addBackendOption(command: Command) {
  command.addOption(
    new Option("--backend-url <url>", "Override the default orchestrator backend URL"),
  );
}

function formatSupportedChains() {
  return supportedChains.map((chain) => `${chain.id} (${chain.name})`).join(", ");
}

function collectOptionValue(value: string, previous: string[] = []) {
  return [...previous, value];
}

export function buildProgram() {
  const program = new Command();
  const supportedChainsText = formatSupportedChains();

  program
    .name("agent-wallet")
    .description(
      `Provision and manage an agent-scoped smart wallet\n\nSupported chains:\n  ${supportedChainsText}`,
    )
    .showHelpAfterError()
    .showSuggestionAfterError(true);

  addBackendOption(program);

  const createCommand = program
    .command("create")
    .description(
      `Create a wallet provisioning request\n\nSupported chains:\n  ${supportedChainsText}`,
    )
    .requiredOption("--chain-id <chainId>", "EIP-155 chain id")
    .addOption(
      new Option(
        "--contract-permission <address:selectors>",
        "Repeatable contract permission in the form <targetContract>:<selector>[,<selector>...]",
      ).argParser(collectOptionValue),
    )
    .option(
      "--usdc-outgoing-limit <amount>",
      "Optional cumulative USDC limit expressed in whole-token units.",
    )
    .addOption(
      new Option(
        "--usdc-outgoing-period <period>",
        "Outgoing-budget period when --usdc-outgoing-limit is set",
      )
        .choices(outgoingBudgetPeriodSchema.options)
        .default("week"),
    )
    .addOption(
      new Option(
        "--usdc-outgoing-flow <flow>",
        "Repeatable outgoing flow covered by the USDC budget",
      )
        .choices(outgoingBudgetFlowSchema.options)
        .argParser(collectOptionValue),
    )
    .addOption(
      new Option(
        "--usdc-outgoing-counterparty <address>",
        "Optional repeatable whitelist entry for USDC transfer recipients and approve spenders",
      ).argParser((value, previous: string[] = []) => [
        ...previous,
        evmAddressSchema.parse(value),
      ]),
    )
    .option("--operator-api-key <key>", "Operator API key")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet create --chain-id 84532 --contract-permission 0x1111111111111111111111111111111111111111:0xa9059cbb --usdc-outgoing-limit 25 --usdc-outgoing-flow transfer --backend-url http://127.0.0.1:3000
      `.trimEnd(),
    );
  addBackendOption(createCommand);
  registerCreateCommand(createCommand);

  const statusCommand = program
    .command("status")
    .description("Inspect a wallet")
    .argument("<wallet-id>", "Wallet id")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet status wal_123 --backend-url http://127.0.0.1:3000
      `.trimEnd(),
    );
  addBackendOption(statusCommand);
  registerStatusCommand(statusCommand);

  const awaitCommand = program
    .command("await")
    .description("Poll until a wallet is ready or failed")
    .argument("<wallet-id>", "Wallet id")
    .option("--interval-ms <ms>", "Polling interval in milliseconds", "5000")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet await wal_123 --interval-ms 3000 --backend-url http://127.0.0.1:3000
      `.trimEnd(),
    );
  addBackendOption(awaitCommand);
  registerAwaitCommand(awaitCommand);

  const callCommand = program
    .command("call")
    .description("Execute a contract call from a ready wallet")
    .argument("<wallet-id>", "Wallet id")
    .requiredOption("--to <address>", "Target contract address")
    .requiredOption("--data <hex>", "Encoded calldata")
    .option("--value-wei <wei>", "Native value attached to the call", "0")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet call wal_123 --to 0x1111111111111111111111111111111111111111 --data 0xa9059cbb --value-wei 0
      `.trimEnd(),
    );
  registerCallCommand(callCommand);

  return program;
}

export async function runCli(argv = process.argv) {
  const program = buildProgram();

  await program.parseAsync(argv);
}

const entrypointPath = process.argv[1];

if (entrypointPath && fileURLToPath(import.meta.url) === entrypointPath) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
