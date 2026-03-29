import type { Command } from "commander";
import {
  createWalletRequestInputSchema,
  evmAddressSchema,
  getOutgoingBudgetScopeValidationErrors,
  createWalletRequestResponseSchema,
  getSupportedChainById,
  getWalletRequestResponseSchema,
  hexStringSchema,
  selectorSchema,
  type ContractPermission,
  type OutgoingBudgetFlow,
  type OutgoingBudgetPeriod,
  type CreateWalletRequestResponse,
  type WalletRequest,
} from "@agent-wallet/shared";
import { resolveBackendUrl } from "./backend.js";
import { fetchJson } from "./http.js";
import {
  callReadyWalletTransaction,
  hydrateReadyWalletRequest,
} from "./kernel.js";
import { readLocalWalletRequest, saveLocalWalletRequest } from "./local-store.js";
import { generateSessionKeyPair } from "./session-key.js";
import { parseUnits } from "viem";

const DEFAULT_AWAIT_INTERVAL_MS = 5000;

function hasOutgoingBudgetConfiguration(options: {
  usdcOutgoingLimit?: string;
  usdcOutgoingPeriod?: OutgoingBudgetPeriod;
  usdcOutgoingFlow?: OutgoingBudgetFlow[];
  usdcOutgoingCounterparty?: string[];
}) {
  return Boolean(
    options.usdcOutgoingLimit ||
      options.usdcOutgoingPeriod ||
      options.usdcOutgoingFlow?.length ||
      options.usdcOutgoingCounterparty?.length,
  );
}

function parseContractPermission(value: string): ContractPermission {
  const [targetContract, selectorsText, ...rest] = value.split(":");

  if (!targetContract || !selectorsText || rest.length > 0) {
    throw new Error(
      `Invalid --contract-permission "${value}". Expected <address>:<selector>[,<selector>...]`,
    );
  }

  const selectors = selectorsText
    .split(",")
    .filter(Boolean)
    .map((selector) => selectorSchema.parse(selector));

  if (selectors.length === 0) {
    throw new Error(
      `Invalid --contract-permission "${value}". At least one selector is required.`,
    );
  }

  return {
    targetContract: evmAddressSchema.parse(targetContract),
    allowedMethods: selectors,
  };
}

function rewriteProvisioningUrlBackend(
  provisioningUrl: string,
  backendUrl: string,
) {
  const url = new URL(provisioningUrl);
  url.searchParams.set("backendUrl", backendUrl);
  return url.toString();
}

function buildNextSteps(
  walletId: string,
  backendUrl: string,
  provisioningUrl: string,
) {
  return {
    recommendedPollIntervalMs: DEFAULT_AWAIT_INTERVAL_MS,
    walletAddressStatus: "owner_bound" as const,
    humanActionUrl: provisioningUrl,
    humanAction:
      "Ask the human to open the provisioning URL and create the wallet with the passkey owner.",
    walletAddressCommand: `agent-wallet status ${walletId} --backend-url ${backendUrl}`,
    statusCommand: `agent-wallet status ${walletId} --backend-url ${backendUrl}`,
    awaitCommand: `agent-wallet await ${walletId} --backend-url ${backendUrl}`,
    guidance: [
      "Ask the human to open the provisioning URL and create the wallet with the passkey owner.",
      "Then call the CLI wallet-address command again to refresh status and obtain the wallet address.",
      "When the wallet address is available, ask the human to fund it on the request chain.",
      "After funding, continue waiting until the request reaches ready.",
    ],
  };
}

function resolveCommandBackendUrl(
  command: Command,
  options: { backendUrl?: string },
) {
  const commandOptions = command.optsWithGlobals() as { backendUrl?: string };
  return options.backendUrl ?? commandOptions.backendUrl;
}

function parseContractPermissions(contractPermissions?: string[]) {
  return contractPermissions?.map(parseContractPermission);
}

export async function executeCreate(options: {
  chainId: string;
  contractPermissions?: string[];
  usdcOutgoingLimit?: string;
  usdcOutgoingPeriod?: OutgoingBudgetPeriod;
  usdcOutgoingFlow?: OutgoingBudgetFlow[];
  usdcOutgoingCounterparty?: string[];
  backendUrl?: string;
}) {
  const backendUrl = resolveBackendUrl(options.backendUrl);
  const sessionKeyPair = generateSessionKeyPair();
  const chainId = Number(options.chainId);
  const supportedChain = getSupportedChainById(chainId);

  if (hasOutgoingBudgetConfiguration(options) && !options.usdcOutgoingLimit) {
    throw new Error(
      "USDC outgoing budget configuration requires --usdc-outgoing-limit.",
    );
  }

  if (options.usdcOutgoingLimit && !supportedChain) {
    throw new Error(`Unsupported chain ${chainId} for USDC outgoing budgets.`);
  }

  const outgoingBudgets =
    options.usdcOutgoingLimit && supportedChain
      ? [
          {
            type: "erc20" as const,
            tokenAddress: supportedChain.officialUsdcAddress,
            limitBaseUnits: parseUnits(
              options.usdcOutgoingLimit,
              supportedChain.officialUsdcDecimals,
            ).toString(),
            period: options.usdcOutgoingPeriod ?? "week",
            allowedFlows:
              options.usdcOutgoingFlow?.length
                ? options.usdcOutgoingFlow
                : ["transfer"],
            allowedCounterparties: options.usdcOutgoingCounterparty,
          },
        ]
      : undefined;
  const contractPermissions = parseContractPermissions(options.contractPermissions);

  const payload = createWalletRequestInputSchema.parse({
    chainId,
    contractPermissions,
    outgoingBudgets,
    sessionPublicKey: sessionKeyPair.publicKey,
  });
  const validationErrors = getOutgoingBudgetScopeValidationErrors(payload);

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(" "));
  }

  const backendResponse = await fetchJson<CreateWalletRequestResponse>(
    `${backendUrl}/v1/wallets`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const response = createWalletRequestResponseSchema.parse({
    ...backendResponse,
    provisioningUrl: rewriteProvisioningUrlBackend(
      backendResponse.provisioningUrl,
      backendUrl,
    ),
    nextSteps: buildNextSteps(
      "wal_placeholder",
      backendUrl,
      rewriteProvisioningUrlBackend(backendResponse.provisioningUrl, backendUrl),
    ),
  });

  const nextSteps = buildNextSteps(
    response.walletId,
    backendUrl,
    response.provisioningUrl,
  );

  const localPath = await saveLocalWalletRequest({
    walletId: response.walletId,
    backendBaseUrl: backendUrl,
    provisioningUrl: response.provisioningUrl,
    chainId: payload.chainId,
    contractPermissions: payload.contractPermissions,
    outgoingBudgets: payload.outgoingBudgets,
    sessionPublicKey: sessionKeyPair.publicKey,
    sessionPrivateKey: sessionKeyPair.privateKey,
    createdAt: new Date().toISOString(),
    lastKnownStatus: response.status,
  });

  return {
    ...response,
    nextSteps,
    sessionPublicKey: sessionKeyPair.publicKey,
    localStatePath: localPath,
  };
}

export async function executeStatus(options: {
  walletId: string;
  backendUrl?: string;
}) {
  const backendUrl = resolveBackendUrl(options.backendUrl);

  return getWalletRequestResponseSchema.parse(
    await fetchJson<WalletRequest>(
      `${backendUrl}/v1/wallets/${options.walletId}`,
      {
        method: "GET",
      },
    ),
  );
}

export async function executeRefreshFunding(options: {
  walletId: string;
  backendUrl?: string;
}) {
  const backendUrl = resolveBackendUrl(options.backendUrl);

  return getWalletRequestResponseSchema.parse(
    await fetchJson<WalletRequest>(
      `${backendUrl}/v1/wallets/${options.walletId}/refresh-funding`,
      {
        method: "POST",
      },
    ),
  );
}

export async function executeAwait(options: {
  walletId: string;
  intervalMs: number;
  backendUrl?: string;
}) {
  process.stderr.write(
    `Waiting for wallet ${options.walletId}. Polling every ${options.intervalMs}ms until ready.\n`,
  );

  while (true) {
    let current = await executeStatus(options);

    if (current.status === "failed") {
      return current;
    }

    if (current.status === "ready") {
      const localRequest = await readLocalWalletRequest(options.walletId);
      const hydratedWallet = await hydrateReadyWalletRequest({
        walletRequest: current,
        localRequest,
      });
      const localStatePath = await saveLocalWalletRequest({
        ...localRequest,
        lastKnownStatus: current.status,
        walletAddress: hydratedWallet.walletAddress,
        serializedPermissionAccount:
          hydratedWallet.serializedPermissionAccount,
      });

      return {
        ...current,
        localStatePath,
      };
    }

    if (current.status === "owner_bound") {
      current = await executeRefreshFunding(options);

      if (current.status === "ready") {
        const localRequest = await readLocalWalletRequest(options.walletId);
        const hydratedWallet = await hydrateReadyWalletRequest({
          walletRequest: current,
          localRequest,
        });
        const localStatePath = await saveLocalWalletRequest({
          ...localRequest,
          lastKnownStatus: current.status,
          walletAddress: hydratedWallet.walletAddress,
          serializedPermissionAccount:
            hydratedWallet.serializedPermissionAccount,
        });

        return {
          ...current,
          localStatePath,
        };
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, options.intervalMs);
    });
  }
}

export async function executeCall(options: {
  walletId: string;
  to: string;
  data: string;
  valueWei: string;
}) {
  const localRequest = await readLocalWalletRequest(options.walletId);
  const to = evmAddressSchema.parse(options.to);
  const data = hexStringSchema.parse(options.data) as `0x${string}`;
  const valueWei = options.valueWei.trim();
  BigInt(valueWei);

  const result = await callReadyWalletTransaction({
    localRequest,
    call: {
      to: to as `0x${string}`,
      data,
      valueWei,
    },
  });

  return {
    walletId: options.walletId,
    walletAddress: result.walletAddress,
    targetContract: to,
    data,
    valueWei,
    transactionHash: result.transactionHash,
  };
}

export function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function registerCreateCommand(command: Command) {
  command.action(async (options) => {
    const result = await executeCreate({
      chainId: options.chainId,
      contractPermissions: options.contractPermission,
      usdcOutgoingLimit: options.usdcOutgoingLimit,
      usdcOutgoingPeriod: options.usdcOutgoingPeriod,
      usdcOutgoingFlow: options.usdcOutgoingFlow,
      usdcOutgoingCounterparty: options.usdcOutgoingCounterparty,
      backendUrl: resolveCommandBackendUrl(command, options),
    });

    printJson(result);
  });
}

export function registerStatusCommand(command: Command) {
  command.action(async (walletId, options) => {
    const result = await executeStatus({
      walletId,
      backendUrl: resolveCommandBackendUrl(command, options),
    });

    printJson(result);
  });
}

export function registerAwaitCommand(command: Command) {
  command.action(async (walletId, options) => {
    const result = await executeAwait({
      walletId,
      intervalMs: Number(options.intervalMs),
      backendUrl: resolveCommandBackendUrl(command, options),
    });

    printJson(result);
  });
}

export function registerCallCommand(command: Command) {
  command.action(async (walletId, options) => {
    const result = await executeCall({
      walletId,
      to: options.to,
      data: options.data,
      valueWei: options.valueWei,
    });

    printJson(result);
  });
}
