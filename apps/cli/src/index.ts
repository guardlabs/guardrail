#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import {
  createWalletRequestInputSchema,
  selectorSchema,
} from "@agent-wallet/shared";
import { resolveBackendUrl } from "./backend.js";

function collectValues(value: string, previous: string[]) {
  return [...previous, value];
}

function addBackendOption(command: Command) {
  command.addOption(
    new Option("--backend-url <url>", "Override the default orchestrator backend URL"),
  );
}

export function buildProgram() {
  const program = new Command();

  program
    .name("agent-wallet")
    .description("Provision and manage an agent-scoped smart wallet")
    .showHelpAfterError()
    .showSuggestionAfterError(true);

  addBackendOption(program);

  program
    .command("create")
    .description("Create a wallet provisioning request")
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
  agent-wallet create --chain-id 8453 --target-contract 0x1111111111111111111111111111111111111111 --allowed-method 0xa9059cbb --backend-url https://agent-wallet.example.com
      `.trimEnd(),
    )
    .hook("preAction", (command) => {
      addBackendOption(command);
    })
    .action((options) => {
      const selectors = [
        ...(options.allowedMethod ? [options.allowedMethod] : []),
        ...((options.allowedMethods as string[] | undefined) ?? []),
      ];

      const payload = createWalletRequestInputSchema.parse({
        chainId: Number(options.chainId),
        targetContract: options.targetContract,
        allowedMethods: selectors,
        sessionPublicKey: "0x04bootstrap",
      });

      const backendUrl = resolveBackendUrl(options.backendUrl);

      console.log(
        JSON.stringify(
          {
            command: "create",
            backendUrl,
            validatedRequest: payload,
            status: "not_implemented",
          },
          null,
          2,
        ),
      );
    });

  program
    .command("status")
    .description("Inspect a wallet provisioning request")
    .argument("<request-id>", "Wallet request id")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet status wr_123 --backend-url https://agent-wallet.example.com
      `.trimEnd(),
    )
    .hook("preAction", (command) => {
      addBackendOption(command);
    })
    .action((requestId, options) => {
      console.log(
        JSON.stringify(
          {
            command: "status",
            requestId,
            backendUrl: resolveBackendUrl(options.backendUrl),
            status: "not_implemented",
          },
          null,
          2,
        ),
      );
    });

  program
    .command("await")
    .description("Poll until a wallet request is ready or failed")
    .argument("<request-id>", "Wallet request id")
    .option("--interval-ms <ms>", "Polling interval in milliseconds", "5000")
    .addHelpText(
      "after",
      `
Example:
  agent-wallet await wr_123 --interval-ms 3000 --backend-url https://agent-wallet.example.com
      `.trimEnd(),
    )
    .hook("preAction", (command) => {
      addBackendOption(command);
    })
    .action((requestId, options) => {
      console.log(
        JSON.stringify(
          {
            command: "await",
            requestId,
            intervalMs: Number(options.intervalMs),
            backendUrl: resolveBackendUrl(options.backendUrl),
            status: "not_implemented",
          },
          null,
          2,
        ),
      );
    });

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
