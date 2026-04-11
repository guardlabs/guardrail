import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  GUARDRAIL_DEFAULT_BACKEND_URL,
  GUARDRAIL_WALLET_MODE,
  bytes4HexSchema,
  bytes32HexSchema,
  createWalletRequestInputSchema,
  createWalletRequestResponseSchema,
  evmAddressSchema,
  getWalletRequestResponseSchema,
  getSupportedChainById,
  hexStringSchema,
  walletPolicySchema,
  x402PaymentPayloadSchema,
  x402PaymentRequiredSchema,
  x402PaymentRequirementsSchema,
  x402SettlementResponseSchema,
  type CreateWalletRequestResponse,
  type WalletRequest,
} from "@guardlabs/guardrail-core";
import {
  bytesToHex,
  createPublicClient,
  formatUnits,
  http,
  parseUnits,
  toFunctionSelector,
  type TypedData,
  type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolveBackendUrl } from "./backend.js";
import { fetchJson } from "./http.js";
import {
  callReadyWalletTransaction,
  ensureReadyWalletDeployed,
  hydrateReadyWalletRequest,
  signReadyWalletTypedData,
} from "./kernel.js";
import {
  readLocalWalletRequest,
  saveLocalWalletRequest,
} from "./local-store.js";

const DEFAULT_AWAIT_INTERVAL_MS = 5000;
const OFFICIAL_USDC_EIP712_DOMAIN_NAME = "USDC";
const OFFICIAL_USDC_EIP712_DOMAIN_VERSION = "2";
const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

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

function buildNextSteps(
  walletId: string,
  backendUrl: string,
  provisioningUrl: string,
) {
  const backendFlag =
    backendUrl.replace(/\/+$/, "") === GUARDRAIL_DEFAULT_BACKEND_URL
      ? ""
      : ` --backend-url ${backendUrl}`;

  return {
    recommendedPollIntervalMs: DEFAULT_AWAIT_INTERVAL_MS,
    walletAddressStatus: "owner_bound" as const,
    humanActionUrl: provisioningUrl,
    humanAction:
      "Ask the human to open the provisioning URL and create the owner passkey for Guardrail.",
    walletAddressCommand: `guardrail status ${walletId}${backendFlag}`,
    statusCommand: `guardrail status ${walletId}${backendFlag}`,
    awaitCommand: `guardrail await ${walletId}${backendFlag}`,
    guidance: [
      "Ask the human to open the provisioning URL and create the owner passkey for Guardrail.",
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

function normalizeBytes4Selector(value: string) {
  return bytes4HexSchema.parse(value.trim().toLowerCase()) as `0x${string}`;
}

function normalizeMethodOrSelector(value: string) {
  const normalized = value.trim();

  if (bytes4HexSchema.safeParse(normalized).success) {
    return normalizeBytes4Selector(normalized);
  }

  if (!normalized.includes("(") || !normalized.endsWith(")")) {
    throw new Error(
      `Unsupported method "${value}". Expected a Solidity signature or 0x-prefixed 4-byte selector.`,
    );
  }

  return normalizeBytes4Selector(toFunctionSelector(normalized));
}

function splitMethodList(value: string) {
  const methods: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of value) {
    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      if (depth === 0) {
        throw new Error(
          `Invalid method list "${value}". Parentheses are unbalanced.`,
        );
      }

      depth -= 1;
      current += character;
      continue;
    }

    if (character === "," && depth === 0) {
      const normalized = current.trim();

      if (normalized) {
        methods.push(normalized);
      }

      current = "";
      continue;
    }

    current += character;
  }

  if (depth !== 0) {
    throw new Error(
      `Invalid method list "${value}". Parentheses are unbalanced.`,
    );
  }

  const normalized = current.trim();

  if (normalized) {
    methods.push(normalized);
  }

  return methods;
}

function buildCreateWalletPolicy(input: {
  chainId: number;
  allowCall?: string[];
  usdcPeriod?: string;
  usdcMax?: string;
  usdcAllow?: string;
}) {
  const supportedChain = getSupportedChainById(input.chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${input.chainId}.`);
  }

  const hasUsdcInput =
    input.usdcPeriod !== undefined ||
    input.usdcMax !== undefined ||
    input.usdcAllow !== undefined;
  const hasCompleteUsdcInput =
    input.usdcPeriod !== undefined &&
    input.usdcMax !== undefined &&
    input.usdcAllow !== undefined;

  if (hasUsdcInput && !hasCompleteUsdcInput) {
    throw new Error(
      "USDC policy requires all three options: --usdc-period, --usdc-max, and --usdc-allow.",
    );
  }

  const contractAllowlist =
    input.allowCall
      ?.map((entry) => {
        const separatorIndex = entry.indexOf(":");

        if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
          throw new Error(
            `Invalid --allow-call value "${entry}". Expected <address>:<methodOrSelector>[,<methodOrSelector>...].`,
          );
        }

        const contractAddress = evmAddressSchema.parse(
          entry.slice(0, separatorIndex).trim(),
        );
        const rawMethods = splitMethodList(entry.slice(separatorIndex + 1));

        if (rawMethods.length === 0) {
          throw new Error(
            `Invalid --allow-call value "${entry}". No methods were provided.`,
          );
        }

        return {
          contractAddress,
          allowedSelectors: [
            ...new Set(rawMethods.map(normalizeMethodOrSelector)),
          ],
        };
      })
      .reduce<
        Array<{
          contractAddress: string;
          allowedSelectors: Array<`0x${string}`>;
        }>
      >((entries, entry) => {
        const existing = entries.find(
          (candidate) =>
            candidate.contractAddress.toLowerCase() ===
            entry.contractAddress.toLowerCase(),
        );

        if (!existing) {
          entries.push(entry);
          return entries;
        }

        existing.allowedSelectors = [
          ...new Set([...existing.allowedSelectors, ...entry.allowedSelectors]),
        ];
        return entries;
      }, []) ?? undefined;

  if (
    contractAllowlist?.some(
      (entry) =>
        entry.contractAddress.toLowerCase() ===
        supportedChain.officialUsdcAddress.toLowerCase(),
    )
  ) {
    throw new Error(
      "Official USDC must not appear in the generic allowlist. Use the dedicated USDC policy instead.",
    );
  }

  const usdcPolicy = hasCompleteUsdcInput
    ? {
        period: input.usdcPeriod,
        maxAmountMinor: parseUnits(
          input.usdcMax!.trim(),
          supportedChain.officialUsdcDecimals,
        ).toString(),
        allowedOperations: [
          ...new Set(
            input
              .usdcAllow!.split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
      }
    : undefined;

  if (!contractAllowlist?.length && !usdcPolicy) {
    throw new Error(
      "Provide at least one runtime policy mechanism with --allow-call or the full USDC policy options.",
    );
  }

  return walletPolicySchema.parse({
    contractAllowlist: contractAllowlist?.length
      ? contractAllowlist
      : undefined,
    usdcPolicy,
  });
}

function buildDefaultAuthorizationNonce() {
  return bytesToHex(randomBytes(32));
}

function parseTypedDataJson(
  raw: string,
): TypedDataDefinition<TypedData, string> {
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

function encodeBase64Json(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeBase64Json(raw: string) {
  return JSON.parse(
    Buffer.from(raw.trim(), "base64").toString("utf8"),
  ) as unknown;
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  if (raw.length === 0) {
    return null;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  return raw;
}

function parseEip155Network(network: string) {
  const match = /^eip155:(\d+)$/.exec(network.trim());

  if (!match) {
    throw new Error(
      `Unsupported network "${network}". Expected eip155:<chainId>.`,
    );
  }

  return Number(match[1]);
}

function buildTransferWithAuthorizationTypedData(input: {
  chainId: number;
  verifyingContract: `0x${string}`;
  name: string;
  version: string;
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce?: string;
}) {
  return {
    domain: {
      name: input.name,
      version: input.version,
      chainId: input.chainId,
      verifyingContract: evmAddressSchema.parse(
        input.verifyingContract,
      ) as `0x${string}`,
    },
    primaryType: "TransferWithAuthorization",
    types: transferWithAuthorizationTypes,
    message: {
      from: input.from,
      to: evmAddressSchema.parse(input.to),
      value: parseUint256(input.value, "value").toString(),
      validAfter: parseUint256(input.validAfter, "validAfter").toString(),
      validBefore: parseUint256(input.validBefore, "validBefore").toString(),
      nonce: bytes32HexSchema.parse(
        input.nonce ?? buildDefaultAuthorizationNonce(),
      ),
    },
  } as const;
}

function selectX402ExactEip3009Requirement(
  accepts: Array<ReturnType<typeof x402PaymentRequirementsSchema.parse>>,
  chainId: number,
) {
  const selected = accepts.find((candidate) => {
    const candidateChainId = parseEip155Network(candidate.network);

    return (
      candidate.scheme === "exact" &&
      candidateChainId === chainId &&
      (candidate.extra.assetTransferMethod ?? "eip3009") === "eip3009"
    );
  });

  if (!selected) {
    throw new Error(
      `No exact/eip3009 x402 payment requirement matched local chain ${chainId}.`,
    );
  }

  return selected;
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

  return buildTransferWithAuthorizationTypedData({
    chainId: input.chainId,
    verifyingContract: supportedChain.officialUsdcAddress as `0x${string}`,
    name: OFFICIAL_USDC_EIP712_DOMAIN_NAME,
    version: OFFICIAL_USDC_EIP712_DOMAIN_VERSION,
    from: input.from,
    to: input.to,
    value: parseUnits(
      input.amountUsdc.trim(),
      supportedChain.officialUsdcDecimals,
    ).toString(),
    validAfter: input.validAfter,
    validBefore: input.validBefore,
    nonce: input.nonce,
  });
}

export async function executeCreate(options: {
  chainId: string;
  backendUrl?: string;
  allowCall?: string[];
  usdcPeriod?: string;
  usdcMax?: string;
  usdcAllow?: string;
}) {
  const backendUrl = resolveBackendUrl(options.backendUrl);
  const chainId = Number(options.chainId);
  const supportedChain = getSupportedChainById(chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${chainId}.`);
  }

  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);
  const policy = buildCreateWalletPolicy({
    chainId,
    allowCall: options.allowCall,
    usdcPeriod: options.usdcPeriod,
    usdcMax: options.usdcMax,
    usdcAllow: options.usdcAllow,
  });
  const payload = createWalletRequestInputSchema.parse({
    walletMode: GUARDRAIL_WALLET_MODE,
    chainId,
    agentAddress: agentAccount.address,
    policy,
  });

  const backendResponse = await fetchJson<CreateWalletRequestResponse>(
    `${backendUrl}/v1/wallets`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const response = createWalletRequestResponseSchema.parse({
    ...backendResponse,
    nextSteps: buildNextSteps(
      "wal_placeholder",
      backendUrl,
      backendResponse.provisioningUrl,
    ),
  });
  const nextSteps = buildNextSteps(
    response.walletId,
    backendUrl,
    response.provisioningUrl,
  );

  const localPath = await saveLocalWalletRequest({
    walletMode: GUARDRAIL_WALLET_MODE,
    walletId: response.walletId,
    backendBaseUrl: backendUrl,
    provisioningUrl: response.provisioningUrl,
    chainId: response.walletConfig.chainId,
    walletConfig: response.walletConfig,
    policy: response.policy,
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
    walletAddress:
      current.walletContext?.walletAddress ??
      current.counterfactualWalletAddress,
    ownerPublicArtifacts: current.ownerPublicArtifacts,
    regularValidatorInitArtifact: current.regularValidatorInitArtifact,
    lastKnownStatus: current.status,
    deployment: current.deployment,
  });
}

async function syncLocalWalletRequest(options: {
  walletId: string;
  backendUrl?: string;
}) {
  let localRequest = await readLocalWalletRequest(options.walletId);
  let current = await executeStatus({
    walletId: options.walletId,
    backendUrl: options.backendUrl ?? localRequest.backendBaseUrl,
  });

  await persistWalletProgress(options.walletId, current);

  if (current.status === "owner_bound") {
    current = await executeRefreshFunding({
      walletId: options.walletId,
      backendUrl: options.backendUrl ?? localRequest.backendBaseUrl,
    });
    await persistWalletProgress(options.walletId, current);
  }

  localRequest = await readLocalWalletRequest(options.walletId);

  return {
    localRequest,
    current,
  };
}

async function loadReadyRuntimeLocalRequest(options: {
  walletId: string;
  backendUrl?: string;
}) {
  const { localRequest, current } = await syncLocalWalletRequest(options);

  if (current.status !== "ready") {
    throw new Error(
      `Wallet ${options.walletId} is not ready for runtime operations.`,
    );
  }

  return localRequest;
}

async function readOfficialUsdcBalance(input: {
  chainId: number;
  backendBaseUrl: string;
  walletAddress: `0x${string}`;
}) {
  const supportedChain = getSupportedChainById(input.chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${input.chainId}.`);
  }

  const publicClient = createPublicClient({
    chain: supportedChain.viemChain,
    transport: http(
      `${input.backendBaseUrl.replace(/\/+$/, "")}/v1/chains/${input.chainId}/rpc`,
    ),
  });

  return publicClient.readContract({
    address: supportedChain.officialUsdcAddress as `0x${string}`,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf",
    args: [input.walletAddress],
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
  let localRequest = await loadReadyRuntimeLocalRequest({
    walletId: options.walletId,
  });
  const to = evmAddressSchema.parse(options.to);
  const data = hexStringSchema.parse(options.data) as `0x${string}`;
  const valueWei = options.valueWei.trim();
  BigInt(valueWei);

  await ensureReadyWalletDeployed({
    localRequest,
  });
  const refreshedBeforeCall = await executeRefreshFunding({
    walletId: options.walletId,
    backendUrl: localRequest.backendBaseUrl,
  });
  await persistWalletProgress(options.walletId, refreshedBeforeCall);
  localRequest = await readLocalWalletRequest(options.walletId);

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

export async function executeUsdcBalance(options: {
  walletId: string;
  backendUrl?: string;
}) {
  const { localRequest, current } = await syncLocalWalletRequest({
    walletId: options.walletId,
    backendUrl: options.backendUrl,
  });
  const supportedChain = getSupportedChainById(localRequest.chainId);

  if (!supportedChain) {
    throw new Error(`Unsupported chain ${localRequest.chainId}.`);
  }

  const walletAddress =
    localRequest.walletAddress ??
    current.walletContext?.walletAddress ??
    current.counterfactualWalletAddress;

  if (!walletAddress) {
    throw new Error(
      `Wallet ${options.walletId} does not have a wallet address yet. Complete owner provisioning first.`,
    );
  }

  const balanceMinor = await readOfficialUsdcBalance({
    chainId: localRequest.chainId,
    backendBaseUrl: options.backendUrl ?? localRequest.backendBaseUrl,
    walletAddress: walletAddress as `0x${string}`,
  });

  return {
    walletId: options.walletId,
    walletStatus: current.status,
    chainId: supportedChain.id,
    chainName: supportedChain.name,
    walletAddress,
    officialUsdcAddress: supportedChain.officialUsdcAddress,
    officialUsdcDecimals: supportedChain.officialUsdcDecimals,
    balanceMinor: balanceMinor.toString(),
    balanceUsdc: formatUnits(balanceMinor, supportedChain.officialUsdcDecimals),
  };
}

export async function executeSignTypedData(options: {
  walletId: string;
  typedDataJson?: string;
  typedDataFile?: string;
}) {
  let localRequest = await loadReadyRuntimeLocalRequest({
    walletId: options.walletId,
  });

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

  const typedDataSource =
    options.typedDataJson ?? (await readFile(options.typedDataFile!, "utf8"));
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

export async function executeX402Sign(options: {
  walletId: string;
  paymentRequiredHeader: string;
}) {
  let localRequest = await loadReadyRuntimeLocalRequest({
    walletId: options.walletId,
  });
  const paymentRequired = x402PaymentRequiredSchema.parse(
    decodeBase64Json(options.paymentRequiredHeader),
  );
  const accepted = selectX402ExactEip3009Requirement(
    paymentRequired.accepts,
    localRequest.chainId,
  );
  const requirementChainId = parseEip155Network(accepted.network);

  if (requirementChainId !== localRequest.chainId) {
    throw new Error(
      `x402 requirement chain ${requirementChainId} does not match local chain ${localRequest.chainId}.`,
    );
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

  if (!localRequest.walletAddress) {
    throw new Error(
      "Local wallet state is missing the deployed wallet address.",
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const validAfter = Math.max(0, nowSeconds - 5).toString();
  const validBefore = (nowSeconds + accepted.maxTimeoutSeconds).toString();
  const typedData = buildTransferWithAuthorizationTypedData({
    chainId: requirementChainId,
    verifyingContract: accepted.asset as `0x${string}`,
    name: accepted.extra.name,
    version: accepted.extra.version,
    from: localRequest.walletAddress as `0x${string}`,
    to: accepted.payTo as `0x${string}`,
    value: accepted.amount,
    validAfter,
    validBefore,
  });
  const signedTypedData = await signReadyWalletTypedData({
    localRequest,
    typedData,
  });
  const paymentPayload = x402PaymentPayloadSchema.parse({
    x402Version: paymentRequired.x402Version,
    resource: paymentRequired.resource,
    accepted,
    payload: {
      signature: signedTypedData.signature,
      authorization: typedData.message,
    },
  });

  return {
    walletId: options.walletId,
    walletAddress: signedTypedData.walletAddress,
    payerAddress: signedTypedData.walletAddress,
    paymentRequired,
    paymentPayload,
    paymentSignatureHeader: encodeBase64Json(paymentPayload),
  };
}

export async function executeX402Fetch(
  options: {
    walletId: string;
    url: string;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    x402Signer?: typeof executeX402Sign;
  } = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const x402Signer = dependencies.x402Signer ?? executeX402Sign;
  const firstResponse = await fetchImpl(options.url, {
    method: "GET",
  });
  const paymentRequiredHeader = firstResponse.headers.get("payment-required");

  if (firstResponse.status !== 402 || !paymentRequiredHeader) {
    return {
      walletId: options.walletId,
      url: options.url,
      status: firstResponse.status,
      ok: firstResponse.ok,
      x402Paid: false,
      contentType: firstResponse.headers.get("content-type"),
      body: await parseResponseBody(firstResponse),
    };
  }

  const paymentRequired = x402PaymentRequiredSchema.parse(
    decodeBase64Json(paymentRequiredHeader),
  );
  const signatureResult = await x402Signer({
    walletId: options.walletId,
    paymentRequiredHeader,
  });
  const paidResponse = await fetchImpl(options.url, {
    method: "GET",
    headers: {
      "PAYMENT-SIGNATURE": signatureResult.paymentSignatureHeader,
    },
  });
  const paymentResponseHeader = paidResponse.headers.get("payment-response");

  return {
    walletId: options.walletId,
    url: options.url,
    status: paidResponse.status,
    ok: paidResponse.ok,
    x402Paid: true,
    walletAddress: signatureResult.walletAddress,
    contentType: paidResponse.headers.get("content-type"),
    paymentRequired,
    paymentResponse: paymentResponseHeader
      ? x402SettlementResponseSchema.parse(
          decodeBase64Json(paymentResponseHeader),
        )
      : undefined,
    body: await parseResponseBody(paidResponse),
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
      allowCall: options.allowCall,
      usdcPeriod: options.usdcPeriod,
      usdcMax: options.usdcMax,
      usdcAllow: options.usdcAllow,
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

export function registerUsdcBalanceCommand(command: Command) {
  command.action(async (walletId, options) => {
    printJson(
      await executeUsdcBalance({
        walletId,
        backendUrl: resolveCommandBackendUrl(command, options),
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

export function registerX402SignCommand(command: Command) {
  command.action(async (walletId, options) => {
    printJson(
      await executeX402Sign({
        walletId,
        paymentRequiredHeader: options.paymentRequiredHeader,
      }),
    );
  });
}

export function registerX402FetchCommand(command: Command) {
  command.action(async (walletId, url) => {
    printJson(
      await executeX402Fetch({
        walletId,
        url,
      }),
    );
  });
}
