#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { selectorSchema, supportedChains } from "@agent-wallet/shared";
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
    .requiredOption("--target-contract <address>", "Scoped target contract")
    .addOption(
      new Option(
        "--allowed-method <selector>",
        "Allowed method selector. Repeat the flag to authorize multiple methods",
      ).argParser((value) => selectorSchema.parse(value)),
    )
    .addOption(
      new Option(
        "--allowed-methods <selectors...>",
        "Allowed method selectors as a space-separated list",
      ),
    )
    .option("--operator-api-key <key>", "Operator API key")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet create --chain-id 84532 --target-contract 0x1111111111111111111111111111111111111111 --allowed-method 0xa9059cbb --backend-url http://127.0.0.1:3000
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
