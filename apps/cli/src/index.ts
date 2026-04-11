#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import {
  GUARDRAIL_DEFAULT_BACKEND_URL,
  supportedChains,
} from "@guardlabs/guardrail-core";
import {
  registerAwaitCommand,
  registerCallCommand,
  registerCreateCommand,
  registerSignTypedDataCommand,
  registerStatusCommand,
  registerX402FetchCommand,
  registerX402SignCommand,
} from "./commands.js";
import { loadEnvFiles } from "./env.js";

loadEnvFiles();

function addBackendOption(command: Command) {
  command.addOption(
    new Option(
      "--backend-url <url>",
      `override the default orchestrator backend URL (default: ${GUARDRAIL_DEFAULT_BACKEND_URL})`,
    ),
  );
}

function formatSupportedChains() {
  return supportedChains
    .map((chain) => `${chain.id} (${chain.name})`)
    .join(", ");
}

export function buildProgram() {
  const program = new Command();
  const supportedChainsText = formatSupportedChains();

  program
    .name("guardrail")
    .description(
      `provision and manage wallet guardrails for agents\n\nsupported chains:\n  ${supportedChainsText}`,
    )
    .showHelpAfterError()
    .showSuggestionAfterError(true);

  addBackendOption(program);

  const createCommand = program
    .command("create")
    .summary("create a wallet provisioning request")
    .description(
      `create a wallet provisioning request\n\nsupported chains:\n  ${supportedChainsText}`,
    )
    .requiredOption("--chain-id <chainId>", "eip-155 chain id")
    .option(
      "--allow-call <address:methods...>",
      "allow a non-USDC contract call by address and selectors or Solidity signatures",
      (value, previous: string[] = []) => [...previous, value],
      [],
    )
    .option(
      "--usdc-period <period>",
      "official USDC budget period: daily, weekly, or monthly",
    )
    .option(
      "--usdc-max <amount>",
      "official USDC budget ceiling in human-readable USDC",
    )
    .option(
      "--usdc-allow <operations>",
      "comma-separated official USDC operations to allow",
    )
    .addHelpText(
      "after",
      `
Example:
  guardrail create --chain-id 84532 --allow-call 0x1111111111111111111111111111111111111111:transfer(address,uint256)
      `.trimEnd(),
    );
  addBackendOption(createCommand);
  registerCreateCommand(createCommand);

  const statusCommand = program
    .command("status")
    .description("inspect a wallet")
    .argument("<wallet-id>", "wallet id")
    .addHelpText(
      "after",
      `
Example:
  guardrail status wal_123
      `.trimEnd(),
    );
  addBackendOption(statusCommand);
  registerStatusCommand(statusCommand);

  const awaitCommand = program
    .command("await")
    .description("poll until a wallet is ready or failed")
    .argument("<wallet-id>", "wallet id")
    .option("--interval-ms <ms>", "polling interval in milliseconds", "5000")
    .addHelpText(
      "after",
      `
Example:
  guardrail await wal_123 --interval-ms 3000
      `.trimEnd(),
    );
  addBackendOption(awaitCommand);
  registerAwaitCommand(awaitCommand);

  const callCommand = program
    .command("call")
    .description("execute a contract call from a ready wallet")
    .argument("<wallet-id>", "wallet id")
    .requiredOption("--to <address>", "target contract address")
    .requiredOption("--data <hex>", "encoded calldata")
    .option("--value-wei <wei>", "native value attached to the call", "0")
    .addHelpText(
      "after",
      `
Example:
  guardrail call wal_123 --to 0x1111111111111111111111111111111111111111 --data 0xa9059cbb --value-wei 0
      `.trimEnd(),
    );
  registerCallCommand(callCommand);

  const signTypedDataCommand = program
    .command("sign-typed-data")
    .description("sign arbitrary EIP-712 typed data from a ready wallet")
    .argument("<wallet-id>", "wallet id")
    .option(
      "--typed-data-file <path>",
      "path to a JSON file containing the typed data",
    )
    .option(
      "--typed-data-json <json>",
      "inline JSON string containing the typed data",
    )
    .addHelpText(
      "after",
      `
Example:
  guardrail sign-typed-data wal_123 --typed-data-file /tmp/typed-data.json
      `.trimEnd(),
    );
  registerSignTypedDataCommand(signTypedDataCommand);

  const x402SignCommand = program
    .command("x402-sign")
    .description(
      "build an x402 PAYMENT-SIGNATURE header for an exact/eip3009 requirement using a ready Guardrail wallet signer",
    )
    .argument("<wallet-id>", "wallet id")
    .requiredOption(
      "--payment-required-header <base64>",
      "base64 PAYMENT-REQUIRED header returned by the resource server",
    )
    .addHelpText(
      "after",
      `
Example:
  guardrail x402-sign wal_123 --payment-required-header eyJ4NDAyVmVyc2lvbiI6Mn0=
      `.trimEnd(),
    );
  registerX402SignCommand(x402SignCommand);

  const x402FetchCommand = program
    .command("x402-fetch")
    .description(
      "fetch a URL and automatically complete the x402 challenge when required",
    )
    .argument("<wallet-id>", "wallet id")
    .argument("<url>", "protected or unprotected resource URL")
    .addHelpText(
      "after",
      `
Example:
  guardrail x402-fetch wal_123 http://127.0.0.1:4010/x402/premium-data
      `.trimEnd(),
    );
  registerX402FetchCommand(x402FetchCommand);

  return program;
}

export async function runCli(argv = process.argv) {
  const program = buildProgram();

  await program.parseAsync(argv);
}

export function isCliEntrypoint(
  moduleUrl: string,
  argvPath: string | undefined,
) {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
