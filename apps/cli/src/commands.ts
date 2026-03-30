import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  PROJECT_WALLET_MODE,
  bytes32HexSchema,
  createWalletRequestInputSchema,
  createWalletRequestResponseSchema,
  evmAddressSchema,
  getWalletRequestResponseSchema,
  getSupportedChainById,
  hexStringSchema,
  type CreateWalletRequestResponse,
  type WalletRequest,
} from "@conduit/shared";
import { bytesToHex, parseUnits, type TypedData, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolveBackendUrl } from "./backend.js";
import { fetchJson } from "./http.js";
import {
  callReadyWalletTransaction,
  ensureReadyWalletDeployed,
  hydrateReadyWalletRequest,
  signReadyWalletTypedData,
} from "./kernel.js";
import { readLocalWalletRequest, saveLocalWalletRequest } from "./local-store.js";

const DEFAULT_AWAIT_INTERVAL_MS = 5000;
const OFFICIAL_USDC_EIP712_DOMAIN_NAME = "USDC";
const OFFICIAL_USDC_EIP712_DOMAIN_VERSION = "2";

const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

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
      "Ask the human to open the provisioning URL and create the passkey owner for the Conduit Wallet.",
    walletAddressCommand: `conduit-wallet status ${walletId} --backend-url ${backendUrl}`,
    statusCommand: `conduit-wallet status ${walletId} --backend-url ${backendUrl}`,
    awaitCommand: `conduit-wallet await ${walletId} --backend-url ${backendUrl}`,
    guidance: [
      "Ask the human to open the provisioning URL and create the Conduit Wallet passkey owner.",
      "Wait for the wallet address to appear once the owner is bound.",
      "Fund the wallet on the target chain.",
      "Continue waiting until the request reaches ready.",
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

function parseUint256(value: string, label: string) {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer.`);
  }

  return BigInt(normalized);
}

function buildDefaultAuthorizationNonce() {
  return bytesToHex(randomBytes(32));
}

function parseTypedDataJson(raw: string): TypedDataDefinition<TypedData, string> {
  const parsed = JSON.parse(raw) as {
    domain?: Record<string, unknown>;
    types?: Record<string, Array<{ name: string; type: string }>>;
    primaryType?: string;
    message?: Record<string, unknown>;
  };

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.domain ||
    typeof parsed.domain !== "object" ||
    !parsed.types ||
    typeof parsed.types !== "object" ||
    !parsed.primaryType ||
    typeof parsed.primaryType !== "string" ||
    !parsed.message ||
    typeof parsed.message !== "object"
  ) {
    throw new Error(
      "Typed data JSON must include domain, types, primaryType, and message objects.",
    );
  }

  return parsed as unknown as TypedDataDefinition<TypedData, string>;
}

export function buildOfficialUsdcTransferWithAuthorizationTypedData(input: {
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  amountUsdc: string;
  validAfter: string;
  validBefore: string;
  nonce?: string;
}) {
  const supportedChain = getSupportedChainById(input.chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${input.chainId}.`);
  }

  return {
    domain: {
      name: OFFICIAL_USDC_EIP712_DOMAIN_NAME,
      version: OFFICIAL_USDC_EIP712_DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: supportedChain.officialUsdcAddress,
    },
    primaryType: "TransferWithAuthorization",
    types: transferWithAuthorizationTypes,
    message: {
      from: input.from,
      to: evmAddressSchema.parse(input.to),
      value: parseUnits(input.amountUsdc.trim(), supportedChain.officialUsdcDecimals).toString(),
      validAfter: parseUint256(input.validAfter, "validAfter").toString(),
      validBefore: parseUint256(input.validBefore, "validBefore").toString(),
      nonce: bytes32HexSchema.parse(input.nonce ?? buildDefaultAuthorizationNonce()),
    },
  } as const;
}

export async function executeCreate(options: {
  chainId: string;
  backendUrl?: string;
}) {
  const backendUrl = resolveBackendUrl(options.backendUrl);
  const chainId = Number(options.chainId);
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${chainId}.`);
  }

  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);
  const payload = createWalletRequestInputSchema.parse({
    walletMode: PROJECT_WALLET_MODE,
    chainId,
    agentAddress: agentAccount.address,
  });

  const backendResponse = await fetchJson<CreateWalletRequestResponse>(
    `${backendUrl}/v1/wallets`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const provisioningUrl = rewriteProvisioningUrlBackend(
    backendResponse.provisioningUrl,
    backendUrl,
  );
  const response = createWalletRequestResponseSchema.parse({
    ...backendResponse,
    provisioningUrl,
    nextSteps: buildNextSteps("wal_placeholder", backendUrl, provisioningUrl),
  });
  const nextSteps = buildNextSteps(
    response.walletId,
    backendUrl,
    response.provisioningUrl,
  );

  const localPath = await saveLocalWalletRequest({
    walletMode: PROJECT_WALLET_MODE,
    walletId: response.walletId,
    backendBaseUrl: backendUrl,
    provisioningUrl: response.provisioningUrl,
    chainId: response.walletConfig.chainId,
    walletConfig: response.walletConfig,
    agentAddress: response.agentAddress,
    agentPrivateKey,
    backendAddress: response.backendAddress,
    createdAt: new Date().toISOString(),
    lastKnownStatus: response.status,
    deployment: response.deployment,
  });

  return {
    ...response,
    nextSteps,
    agentAddress: agentAccount.address,
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

async function persistWalletProgress(walletId: string, current: WalletRequest) {
  const localRequest = await readLocalWalletRequest(walletId);

  return saveLocalWalletRequest({
    ...localRequest,
    walletConfig: current.walletConfig,
    backendAddress: current.backendAddress,
    walletAddress: current.walletContext?.walletAddress ?? current.counterfactualWalletAddress,
    ownerPublicArtifacts: current.ownerPublicArtifacts,
    regularValidatorInitArtifact: current.regularValidatorInitArtifact,
    lastKnownStatus: current.status,
    deployment: current.deployment,
  });
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
        walletConfig: current.walletConfig,
        backendAddress: current.backendAddress,
        ownerPublicArtifacts: current.ownerPublicArtifacts,
        regularValidatorInitArtifact: current.regularValidatorInitArtifact,
        lastKnownStatus: current.status,
        walletAddress: hydratedWallet.walletAddress,
        deployment: current.deployment,
      });

      return {
        ...current,
        localStatePath,
      };
    }

    if (current.status === "owner_bound") {
      await persistWalletProgress(options.walletId, current);
      current = await executeRefreshFunding(options);
      await persistWalletProgress(options.walletId, current);

      if (current.status === "ready") {
        const localRequest = await readLocalWalletRequest(options.walletId);
        const hydratedWallet = await hydrateReadyWalletRequest({
          walletRequest: current,
          localRequest,
        });
        const localStatePath = await saveLocalWalletRequest({
          ...localRequest,
          walletConfig: current.walletConfig,
          backendAddress: current.backendAddress,
          ownerPublicArtifacts: current.ownerPublicArtifacts,
          regularValidatorInitArtifact: current.regularValidatorInitArtifact,
          lastKnownStatus: current.status,
          walletAddress: hydratedWallet.walletAddress,
          deployment: current.deployment,
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

  try {
    const refreshed = await executeRefreshFunding({
      walletId: options.walletId,
      backendUrl: localRequest.backendBaseUrl,
    });
    await persistWalletProgress(options.walletId, refreshed);
  } catch {
    await saveLocalWalletRequest({
      ...localRequest,
      walletAddress: result.walletAddress,
      deployment: {
        status: "deployed",
      },
    });
  }

  return {
    walletId: options.walletId,
    walletAddress: result.walletAddress,
    targetContract: to,
    data,
    valueWei,
    transactionHash: result.transactionHash,
  };
}

export async function executeSignTypedData(options: {
  walletId: string;
  typedDataJson?: string;
  typedDataFile?: string;
}) {
  let localRequest = await readLocalWalletRequest(options.walletId);

  if (!options.typedDataJson && !options.typedDataFile) {
    throw new Error("Provide either typedDataJson or typedDataFile.");
  }

  await ensureReadyWalletDeployed({
    localRequest,
  });
  const refreshed = await executeRefreshFunding({
    walletId: options.walletId,
    backendUrl: localRequest.backendBaseUrl,
  });
  await persistWalletProgress(options.walletId, refreshed);
  localRequest = await readLocalWalletRequest(options.walletId);

  const typedDataSource = options.typedDataJson ?? (await readFile(options.typedDataFile!, "utf8"));
  const typedData = parseTypedDataJson(typedDataSource);
  const signedTypedData = await signReadyWalletTypedData({
    localRequest,
    typedData,
  });

  return {
    walletId: options.walletId,
    walletAddress: signedTypedData.walletAddress,
    typedData,
    signature: signedTypedData.signature,
  };
}

export function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function registerCreateCommand(command: Command) {
  command.action(async (options) => {
    const result = await executeCreate({
      chainId: options.chainId,
      backendUrl: resolveCommandBackendUrl(command, options),
    });

    printJson(result);
  });
}

export function registerStatusCommand(command: Command) {
  command.action(async (walletId, options) => {
    printJson(
      await executeStatus({
        walletId,
        backendUrl: resolveCommandBackendUrl(command, options),
      }),
    );
  });
}

export function registerAwaitCommand(command: Command) {
  command.action(async (walletId, options) => {
    printJson(
      await executeAwait({
        walletId,
        backendUrl: resolveCommandBackendUrl(command, options),
        intervalMs: Number(options.intervalMs ?? DEFAULT_AWAIT_INTERVAL_MS),
      }),
    );
  });
}

export function registerCallCommand(command: Command) {
  command.action(async (walletId, options) => {
    printJson(
      await executeCall({
        walletId,
        to: options.to,
        data: options.data,
        valueWei: options.valueWei,
      }),
    );
  });
}

export function registerSignTypedDataCommand(command: Command) {
  command.action(async (walletId, options) => {
    printJson(
      await executeSignTypedData({
        walletId,
        typedDataJson: options.typedDataJson,
        typedDataFile: options.typedDataFile,
      }),
    );
  });
}
