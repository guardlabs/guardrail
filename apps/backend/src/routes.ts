import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  GUARDRAIL_DEFAULT_BACKEND_URL,
  GUARDRAIL_WALLET_MODE,
  backendDeployWalletRequestSchema,
  backendSignResponseSchema,
  backendSignTypedDataRequestSchema,
  backendSignUserOperationRequestSchema,
  buildDefaultWalletConfig,
  canTransitionStatus,
  createWalletRequestInputSchema,
  createWalletRequestResponseSchema,
  getBackendSignerAuthorizationTypedData,
  getWalletRequestResponseSchema,
  hashBackendSignerRequestBody,
  publishOwnerArtifactsInputSchema,
  resolveProvisioningResponseSchema,
  type BackendSignerMethod,
  type BackendUserOperationSignaturePayload,
  type CreateWalletRequestInput,
} from "@guardlabs/guardrail-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, type Address, type Hex } from "viem";
import type { AppConfig } from "./config.js";
import type { ChainRelayService, RelayTarget } from "./chain-relay.js";
import type {
  StoredWalletRequest,
  WalletRequestRepository,
} from "./repository.js";
import { toPublicWalletRequest } from "./repository.js";
import {
  createInitialRuntimePolicyState,
  evaluateDeployWalletPolicy,
  evaluateTypedDataPolicy,
  evaluateUserOperationPolicy,
  getRuntimePolicyConsumptionWindowStart,
} from "./runtime-policy.js";
import type { WalletProvisioningService } from "./wallet.js";

function createWalletId() {
  return `wal_${randomUUID().replaceAll("-", "")}`;
}

function createProvisioningToken() {
  return randomBytes(24).toString("hex");
}

function hashProvisioningToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createExpiresAt(now: Date, ttlHours: number) {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

function isExpired(expiresAt: string) {
  return new Date(expiresAt).getTime() <= Date.now();
}

function createProvisioningUrl(input: {
  frontendBaseUrl: string;
  walletId: string;
  token: string;
}) {
  const url = new URL(input.frontendBaseUrl);
  url.searchParams.set("walletId", input.walletId);
  url.searchParams.set("token", input.token);
  return url.toString();
}

function createBackendSignerAccount(agentAddress: string) {
  const normalizedAgentAddress = agentAddress.toLowerCase();

  while (true) {
    const backendPrivateKey = generatePrivateKey();
    const backendAccount = privateKeyToAccount(backendPrivateKey);

    if (backendAccount.address.toLowerCase() < normalizedAgentAddress) {
      return {
        backendPrivateKey,
        backendAccount,
      };
    }
  }
}

function buildInitialRequest(
  payload: CreateWalletRequestInput,
  config: AppConfig,
): { request: StoredWalletRequest; provisioningToken: string } {
  const now = new Date();
  const provisioningToken = createProvisioningToken();
  const walletId = createWalletId();
  const timestamp = now.toISOString();
  const { backendPrivateKey, backendAccount } = createBackendSignerAccount(
    payload.agentAddress,
  );
  const walletConfig = buildDefaultWalletConfig({
    chainId: payload.chainId,
    agentAddress: payload.agentAddress,
    backendAddress: backendAccount.address,
  });

  return {
    provisioningToken,
    request: {
      walletId,
      walletMode: GUARDRAIL_WALLET_MODE,
      status: "created",
      walletConfig,
      policy: payload.policy,
      agentAddress: payload.agentAddress,
      backendAddress: backendAccount.address,
      backendPrivateKey,
      provisioningTokenHash: hashProvisioningToken(provisioningToken),
      funding: {
        status: "unverified",
        minimumRequiredWei: config.minFundingWei,
      },
      deployment: {
        status: "undeployed",
      },
      runtimePolicyState: createInitialRuntimePolicyState(),
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: createExpiresAt(now, config.requestTtlHours),
    },
  };
}

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
    recommendedPollIntervalMs: 5000,
    walletAddressStatus: "owner_bound" as const,
    humanActionUrl: provisioningUrl,
    humanAction:
      "Ask the human to open the provisioning URL and create the owner passkey for Guardrail.",
    walletAddressCommand: `guardrail status ${walletId}${backendFlag}`,
    statusCommand: `guardrail status ${walletId}${backendFlag}`,
    awaitCommand: `guardrail await ${walletId}${backendFlag}`,
    guidance: [
      "Ask the human to open the provisioning URL and create the owner passkey for Guardrail.",
      "Wait for the wallet address to appear once the passkey owner is bound.",
      "Fund the wallet on the target chain so the backend can mark it ready.",
      "Continue waiting until the request reaches ready before sending runtime operations.",
    ],
  };
}

function assertSupportedChain(chainId: number, config: AppConfig) {
  if (!config.supportedChainIds.includes(chainId)) {
    throw new Error(
      `Unsupported chainId ${chainId}. Configured chains: ${config.supportedChainIds.join(", ")}`,
    );
  }
}

const ALLOWED_RPC_RELAY_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_gasPrice",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

const ALLOWED_BUNDLER_RELAY_METHODS = new Set([
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_sendUserOperation",
]);

function extractRelayMethods(payload: unknown): string[] | null {
  const requests = Array.isArray(payload) ? payload : [payload];

  if (requests.length === 0) {
    return null;
  }

  const methods: string[] = [];

  for (const request of requests) {
    if (
      !request ||
      typeof request !== "object" ||
      !("method" in request) ||
      typeof request.method !== "string"
    ) {
      return null;
    }

    methods.push(request.method);
  }

  return methods;
}

function isAllowedRelayMethod(target: RelayTarget, method: string) {
  if (target === "rpc") {
    return ALLOWED_RPC_RELAY_METHODS.has(method);
  }

  return ALLOWED_BUNDLER_RELAY_METHODS.has(method);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summarizeHexSelector(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return null;
  }

  return value.slice(0, Math.min(value.length, 10));
}

function summarizeHexBytes(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return null;
  }

  return Math.max(0, (value.length - 2) / 2);
}

function summarizeUserOperationCandidate(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const summary: Record<string, unknown> = {};

  if (typeof value.sender === "string") {
    summary.sender = value.sender;
  }

  if (
    typeof value.nonce === "string" ||
    (typeof value.nonce === "number" && Number.isFinite(value.nonce))
  ) {
    summary.nonce = String(value.nonce);
  }

  if (typeof value.factory === "string") {
    summary.factory = value.factory;
  }

  const factoryDataSelector = summarizeHexSelector(value.factoryData);
  if (factoryDataSelector && factoryDataSelector !== "0x") {
    summary.factoryDataSelector = factoryDataSelector;
  }

  const initCodeSelector = summarizeHexSelector(value.initCode);
  if (initCodeSelector && initCodeSelector !== "0x") {
    summary.initCodeSelector = initCodeSelector;
  }

  const callDataSelector = summarizeHexSelector(value.callData);
  if (callDataSelector && callDataSelector !== "0x") {
    summary.callDataSelector = callDataSelector;
  }

  const signatureBytes = summarizeHexBytes(value.signature);
  if (signatureBytes !== null) {
    summary.signatureBytes = signatureBytes;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function summarizeRelayRequestPayload(payload: unknown) {
  const requests = Array.isArray(payload) ? payload : [payload];

  return requests.flatMap((request) => {
    if (!isRecord(request)) {
      return [];
    }

    const summary: Record<string, unknown> = {};

    if ("id" in request) {
      summary.id = request.id;
    }

    if (typeof request.method === "string") {
      summary.method = request.method;
    }

    const params = Array.isArray(request.params) ? request.params : [];
    const userOperationSummary = summarizeUserOperationCandidate(params[0]);

    if (userOperationSummary) {
      Object.assign(summary, userOperationSummary);
    }

    return [summary];
  });
}

function summarizeRelayResponsePayload(payload: unknown) {
  const responses = Array.isArray(payload) ? payload : [payload];

  return responses.flatMap((response) => {
    if (!isRecord(response)) {
      return [];
    }

    const summary: Record<string, unknown> = {};

    if ("id" in response) {
      summary.id = response.id;
    }

    if (isRecord(response.error)) {
      summary.kind = "error";

      if ("code" in response.error) {
        summary.errorCode = response.error.code;
      }

      if (typeof response.error.message === "string") {
        summary.errorMessage = response.error.message;
      }

      if (isRecord(response.error.data)) {
        if (typeof response.error.data.reason === "string") {
          summary.errorReason = response.error.data.reason;
        }

        if (typeof response.error.data.revertData === "string") {
          summary.errorRevertData = response.error.data.revertData;
        }
      }
    } else {
      summary.kind = "result";

      if (isRecord(response.result)) {
        summary.resultKeys = Object.keys(response.result).slice(0, 5);
      } else if ("result" in response) {
        summary.resultType =
          response.result === null ? "null" : typeof response.result;
      }
    }

    return [summary];
  });
}

async function verifyBackendSignerAuthorization(input: {
  request: StoredWalletRequest;
  auth: {
    walletAddress: string;
    backendSignerAddress: string;
    method: BackendSignerMethod;
    bodyHash: string;
    requestId: string;
    expiresAt: string;
    agentSignature: string;
  };
  body: Record<string, unknown>;
}) {
  if (!input.request.walletContext) {
    return {
      ok: false as const,
      statusCode: 409,
      error: "wallet_not_ready",
      message: "Wallet is not ready for backend signing.",
    };
  }

  if (input.request.status !== "ready") {
    return {
      ok: false as const,
      statusCode: 409,
      error: "wallet_not_ready",
      message: "Wallet is not ready for backend signing.",
    };
  }

  if (
    input.auth.walletAddress.toLowerCase() !==
    input.request.walletContext.walletAddress.toLowerCase()
  ) {
    return {
      ok: false as const,
      statusCode: 400,
      error: "wallet_address_mismatch",
      message:
        "Backend signer authorization walletAddress does not match the ready wallet.",
    };
  }

  if (
    input.auth.backendSignerAddress.toLowerCase() !==
    input.request.backendAddress.toLowerCase()
  ) {
    return {
      ok: false as const,
      statusCode: 400,
      error: "backend_signer_mismatch",
      message:
        "Backend signer authorization backendSignerAddress does not match the wallet.",
    };
  }

  if (new Date(input.auth.expiresAt).getTime() <= Date.now()) {
    return {
      ok: false as const,
      statusCode: 401,
      error: "authorization_expired",
      message: "Backend signer authorization has expired.",
    };
  }

  const expectedBodyHash = hashBackendSignerRequestBody(
    input.auth.method,
    input.body as never,
  );

  if (expectedBodyHash.toLowerCase() !== input.auth.bodyHash.toLowerCase()) {
    return {
      ok: false as const,
      statusCode: 400,
      error: "body_hash_mismatch",
      message:
        "Backend signer authorization bodyHash does not match the requested payload.",
    };
  }

  const verified = await verifyTypedData({
    address: input.request.agentAddress as Address,
    ...getBackendSignerAuthorizationTypedData({
      walletAddress: input.auth.walletAddress as Address,
      backendSignerAddress: input.auth.backendSignerAddress as Address,
      method: input.auth.method,
      bodyHash: input.auth.bodyHash as Hex,
      requestId: input.auth.requestId,
      expiresAt: input.auth.expiresAt,
    }),
    signature: input.auth.agentSignature as Hex,
  });

  if (!verified) {
    return {
      ok: false as const,
      statusCode: 401,
      error: "invalid_agent_signature",
      message: "Backend signer authorization signature is invalid.",
    };
  }

  return {
    ok: true as const,
  };
}

function signBackendUserOperationPayload(input: {
  backendPrivateKey: Hex;
  signaturePayload: BackendUserOperationSignaturePayload;
}) {
  const backendAccount = privateKeyToAccount(input.backendPrivateKey);

  if (input.signaturePayload.kind === "weighted_validator_approve") {
    return backendAccount.signTypedData(
      input.signaturePayload.typedData as never,
    );
  }

  return backendAccount.signMessage({
    message: {
      raw: input.signaturePayload.message.raw as Hex,
    },
  });
}

function logInfo(
  app: FastifyInstance,
  event: string,
  message: string,
  fields: Record<string, unknown>,
) {
  app.log.info(
    {
      event,
      ...fields,
    },
    message,
  );
}

function logDebug(
  app: FastifyInstance,
  event: string,
  message: string,
  fields: Record<string, unknown>,
) {
  app.log.debug(
    {
      event,
      ...fields,
    },
    message,
  );
}

async function listRelevantUsdcConsumptions(input: {
  repository: WalletRequestRepository;
  request: StoredWalletRequest;
  now: Date;
}) {
  const usdcPolicy = input.request.policy.usdcPolicy;

  if (!usdcPolicy) {
    return [];
  }

  return input.repository.listRuntimePolicyConsumptionsSince({
    walletId: input.request.walletId,
    asset: "usdc",
    createdAtGte: getRuntimePolicyConsumptionWindowStart(
      usdcPolicy.period,
      input.now,
    ).toISOString(),
  });
}

async function finalizeBackendSigning<T>(input: {
  app: FastifyInstance;
  repository: WalletRequestRepository;
  walletRequest: StoredWalletRequest;
  route: string;
  requestId: string;
  method: BackendSignerMethod;
  createdAt: string;
  consumption?: {
    asset: "usdc";
    operation: string;
    amountMinor: string;
  };
  handler: () => Promise<T>;
}) {
  const outcome = await input.repository.runBackendSigningOperation({
    walletId: input.walletRequest.walletId,
    requestId: input.requestId,
    method: input.method,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    consumption: input.consumption
      ? {
          walletId: input.walletRequest.walletId,
          requestId: input.requestId,
          asset: input.consumption.asset,
          operation: input.consumption.operation,
          amountMinor: input.consumption.amountMinor,
          createdAt: input.createdAt,
        }
      : undefined,
    handler: input.handler,
  });

  if (outcome.status !== "ok") {
    if (outcome.status === "not_found") {
      return {
        ok: false as const,
        reply: {
          statusCode: 404,
          body: {
            error: "request_not_found",
          },
        },
      };
    }

    logDebug(
      input.app,
      "backend_signer_request_replayed",
      `Rejected replayed ${input.route} request.`,
      {
        walletId: input.walletRequest.walletId,
        route: input.route,
        requestId: input.requestId,
      },
    );
    return {
      ok: false as const,
      reply: {
        statusCode: 409,
        body: {
          error: "request_replayed",
          message: "This backend signer requestId has already been used.",
        },
      },
    };
  }

  return {
    ok: true as const,
    result: outcome.result,
  };
}

export function registerRoutes(
  app: FastifyInstance,
  repository: WalletRequestRepository,
  config: AppConfig,
  walletProvisioningService: WalletProvisioningService,
  chainRelayService: ChainRelayService,
) {
  async function relayChainRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    target: RelayTarget,
  ) {
    const params = request.params as { chainId: string };
    const chainId = Number(params.chainId);
    const methods = extractRelayMethods(request.body);
    const route = target === "rpc" ? "rpc-relay" : "bundler-relay";

    if (
      !Number.isInteger(chainId) ||
      !config.supportedChainIds.includes(chainId)
    ) {
      return reply.status(404).send({
        error: "unsupported_chain",
      });
    }

    if (!methods) {
      return reply.status(400).send({
        error: "invalid_relay_request",
        message: "Relay requests must include a JSON-RPC method.",
      });
    }

    const disallowedMethod = methods.find(
      (method) => !isAllowedRelayMethod(target, method),
    );

    if (disallowedMethod) {
      return reply.status(403).send({
        error: `${target}_method_not_allowed`,
        message: `JSON-RPC method ${disallowedMethod} is not allowed on the ${target} relay.`,
      });
    }

    const requestSummary = summarizeRelayRequestPayload(request.body);

    try {
      const payload = await chainRelayService.relay({
        chainId,
        target,
        payload: request.body,
      });

      logDebug(
        app,
        "chain_relay_forwarded",
        "Forwarded allowed chain relay request.",
        {
          route,
          chainId,
          target,
          methods,
          requestSummary,
          responseSummary: summarizeRelayResponsePayload(payload),
        },
      );

      return reply.send(payload);
    } catch (error) {
      logDebug(app, "chain_relay_failed", "Chain relay request failed.", {
        route,
        chainId,
        target,
        methods,
        requestSummary,
        relayError: error instanceof Error ? error.message : String(error),
      });

      return reply.status(502).send({
        error: `${target}_relay_failed`,
        message:
          error instanceof Error
            ? error.message
            : `Failed to relay ${target} request`,
      });
    }
  }

  app.post("/v1/chains/:chainId/rpc", async (request, reply) =>
    relayChainRequest(request, reply, "rpc"),
  );

  app.post("/v1/chains/:chainId/bundler", async (request, reply) =>
    relayChainRequest(request, reply, "bundler"),
  );

  app.post("/v1/wallets", async (request, reply) => {
    const payload = createWalletRequestInputSchema.parse(request.body);

    try {
      assertSupportedChain(payload.chainId, config);
    } catch (error) {
      return reply.status(400).send({
        error: "unsupported_chain",
        message: error instanceof Error ? error.message : "Unsupported chain",
      });
    }

    const { request: nextRequest, provisioningToken } = buildInitialRequest(
      payload,
      config,
    );

    await repository.create(nextRequest);

    const provisioningUrl = createProvisioningUrl({
      frontendBaseUrl: config.frontendBaseUrl,
      walletId: nextRequest.walletId,
      token: provisioningToken,
    });

    const response = createWalletRequestResponseSchema.parse({
      walletMode: nextRequest.walletMode,
      walletId: nextRequest.walletId,
      status: nextRequest.status,
      agentAddress: nextRequest.agentAddress,
      backendAddress: nextRequest.backendAddress,
      walletConfig: nextRequest.walletConfig,
      policy: nextRequest.policy,
      provisioningUrl,
      deployment: nextRequest.deployment,
      expiresAt: nextRequest.expiresAt,
      nextSteps: buildNextSteps(
        nextRequest.walletId,
        config.publicBackendUrl,
        provisioningUrl,
      ),
    });

    logInfo(
      app,
      "wallet_request_created",
      "Created wallet provisioning request.",
      {
        walletId: nextRequest.walletId,
        chainId: nextRequest.walletConfig.chainId,
        status: nextRequest.status,
        agentAddress: nextRequest.agentAddress,
        backendAddress: nextRequest.backendAddress,
      },
    );

    return reply.status(201).send(response);
  });

  app.get("/v1/wallets/:walletId", async (request, reply) => {
    const params = request.params as { walletId: string };
    const walletRequest = await repository.findById(params.walletId);

    if (!walletRequest) {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    return reply.send(
      getWalletRequestResponseSchema.parse(
        toPublicWalletRequest(walletRequest),
      ),
    );
  });

  app.post("/v1/wallets/:walletId/refresh-funding", async (request, reply) => {
    const params = request.params as { walletId: string };
    const walletRequest = await repository.findById(params.walletId);

    if (!walletRequest) {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    if (
      (walletRequest.status !== "owner_bound" &&
        walletRequest.status !== "ready") ||
      !walletRequest.ownerPublicArtifacts ||
      !walletRequest.regularValidatorInitArtifact ||
      !walletRequest.counterfactualWalletAddress
    ) {
      return reply.status(409).send({
        error: "funding_refresh_not_allowed",
      });
    }

    const previousStatus = walletRequest.status;
    const previousFundingStatus = walletRequest.funding.status;

    const refreshedWallet = await walletProvisioningService.refreshFunding({
      owner: walletRequest.ownerPublicArtifacts,
      regularValidatorInitArtifact: walletRequest.regularValidatorInitArtifact,
      walletConfig: walletRequest.walletConfig,
      agentAddress: walletRequest.agentAddress,
      backendAddress: walletRequest.backendAddress,
      counterfactualWalletAddress: walletRequest.counterfactualWalletAddress,
    });

    const updatedRequest = await repository.updateFunding({
      walletId: walletRequest.walletId,
      funding: refreshedWallet.funding,
      deployment: refreshedWallet.deployment,
      status: refreshedWallet.status,
      walletContext: refreshedWallet.walletContext,
      updatedAt: new Date().toISOString(),
    });

    if (!updatedRequest) {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    logInfo(
      app,
      "wallet_funding_refreshed",
      "Refreshed wallet funding and deployment state.",
      {
        walletId: updatedRequest.walletId,
        previousStatus,
        status: updatedRequest.status,
        previousFundingStatus,
        fundingStatus: updatedRequest.funding.status,
        deploymentStatus: updatedRequest.deployment.status,
        walletAddress:
          updatedRequest.walletContext?.walletAddress ??
          updatedRequest.counterfactualWalletAddress,
      },
    );

    if (updatedRequest.status !== previousStatus) {
      logInfo(
        app,
        "wallet_status_updated",
        "Wallet status changed after funding refresh.",
        {
          walletId: updatedRequest.walletId,
          previousStatus,
          status: updatedRequest.status,
          walletAddress:
            updatedRequest.walletContext?.walletAddress ??
            updatedRequest.counterfactualWalletAddress,
        },
      );
    }

    return reply.send(
      getWalletRequestResponseSchema.parse(
        toPublicWalletRequest(updatedRequest),
      ),
    );
  });

  app.post(
    "/v1/wallets/:walletId/backend-sign-typed-data",
    async (request, reply) => {
      const params = request.params as { walletId: string };
      const walletRequest = await repository.findById(params.walletId);

      if (!walletRequest) {
        return reply.status(404).send({
          error: "request_not_found",
        });
      }

      const parsedRequest = backendSignTypedDataRequestSchema.parse(
        request.body,
      );

      const verification = await verifyBackendSignerAuthorization({
        request: walletRequest,
        auth: parsedRequest.auth,
        body: {
          typedData: parsedRequest.typedData,
          signaturePayload: parsedRequest.signaturePayload,
        },
      });

      if (!verification.ok) {
        logDebug(
          app,
          "backend_signer_authorization_denied",
          "Denied backend typed-data authorization.",
          {
            walletId: walletRequest.walletId,
            route: "backend-sign-typed-data",
            requestId: parsedRequest.auth.requestId,
            authError: verification.error,
          },
        );
        return reply.status(verification.statusCode).send({
          error: verification.error,
          message: verification.message,
        });
      }

      const now = new Date();
      const recentUsdcConsumptions = await listRelevantUsdcConsumptions({
        repository,
        request: walletRequest,
        now,
      });

      const policyDecision = evaluateTypedDataPolicy({
        request: walletRequest,
        recentUsdcConsumptions,
        typedData: parsedRequest.typedData,
        signaturePayload: parsedRequest.signaturePayload,
        now,
      });

      if (!policyDecision.ok) {
        logDebug(
          app,
          "runtime_policy_denied",
          "Denied typed-data request by runtime policy.",
          {
            walletId: walletRequest.walletId,
            route: "backend-sign-typed-data",
            requestId: parsedRequest.auth.requestId,
            method: parsedRequest.auth.method,
            policyError: policyDecision.error,
          },
        );
        return reply.status(policyDecision.statusCode).send({
          error: policyDecision.error,
          message: policyDecision.message,
        });
      }

      const signingResult = await finalizeBackendSigning({
        app,
        repository,
        walletRequest,
        route: "backend-sign-typed-data",
        requestId: parsedRequest.auth.requestId,
        method: parsedRequest.auth.method,
        createdAt: now.toISOString(),
        consumption: policyDecision.consumption,
        handler: async () => {
          const backendAccount = privateKeyToAccount(
            walletRequest.backendPrivateKey as Hex,
          );

          return backendAccount.signTypedData(
            parsedRequest.signaturePayload.typedData as never,
          );
        },
      });

      if (!signingResult.ok) {
        return reply
          .status(signingResult.reply.statusCode)
          .send(signingResult.reply.body);
      }

      logInfo(
        app,
        "backend_signature_granted",
        "Granted backend typed-data signature.",
        {
          walletId: walletRequest.walletId,
          route: "backend-sign-typed-data",
          requestId: parsedRequest.auth.requestId,
          method: parsedRequest.auth.method,
          primaryType: parsedRequest.typedData.primaryType,
        },
      );

      return reply.send(
        backendSignResponseSchema.parse({
          signature: signingResult.result,
        }),
      );
    },
  );

  app.post(
    "/v1/wallets/:walletId/backend-sign-user-operation",
    async (request, reply) => {
      const params = request.params as { walletId: string };
      const walletRequest = await repository.findById(params.walletId);

      if (!walletRequest) {
        return reply.status(404).send({
          error: "request_not_found",
        });
      }

      const parsedRequest = backendSignUserOperationRequestSchema.parse(
        request.body,
      );

      const verification = await verifyBackendSignerAuthorization({
        request: walletRequest,
        auth: parsedRequest.auth,
        body: {
          operation: parsedRequest.operation,
          userOperation: parsedRequest.userOperation,
          signaturePayload: parsedRequest.signaturePayload,
        },
      });

      if (!verification.ok) {
        logDebug(
          app,
          "backend_signer_authorization_denied",
          "Denied backend user-operation authorization.",
          {
            walletId: walletRequest.walletId,
            route: "backend-sign-user-operation",
            requestId: parsedRequest.auth.requestId,
            authError: verification.error,
          },
        );
        return reply.status(verification.statusCode).send({
          error: verification.error,
          message: verification.message,
        });
      }

      const now = new Date();
      const recentUsdcConsumptions = await listRelevantUsdcConsumptions({
        repository,
        request: walletRequest,
        now,
      });

      const policyDecision = evaluateUserOperationPolicy({
        request: walletRequest,
        recentUsdcConsumptions,
        operation: parsedRequest.operation,
        userOperation: parsedRequest.userOperation,
        signaturePayload: parsedRequest.signaturePayload,
        now,
      });

      if (!policyDecision.ok) {
        logDebug(
          app,
          "runtime_policy_denied",
          "Denied user-operation request by runtime policy.",
          {
            walletId: walletRequest.walletId,
            route: "backend-sign-user-operation",
            requestId: parsedRequest.auth.requestId,
            method: parsedRequest.auth.method,
            policyError: policyDecision.error,
            contractAddress: parsedRequest.operation.to,
          },
        );
        return reply.status(policyDecision.statusCode).send({
          error: policyDecision.error,
          message: policyDecision.message,
        });
      }

      const signingResult = await finalizeBackendSigning({
        app,
        repository,
        walletRequest,
        route: "backend-sign-user-operation",
        requestId: parsedRequest.auth.requestId,
        method: parsedRequest.auth.method,
        createdAt: now.toISOString(),
        consumption: policyDecision.consumption,
        handler: () =>
          signBackendUserOperationPayload({
            backendPrivateKey: walletRequest.backendPrivateKey as Hex,
            signaturePayload: parsedRequest.signaturePayload,
          }),
      });

      if (!signingResult.ok) {
        return reply
          .status(signingResult.reply.statusCode)
          .send(signingResult.reply.body);
      }

      logInfo(
        app,
        "backend_signature_granted",
        "Granted backend user-operation signature.",
        {
          walletId: walletRequest.walletId,
          route: "backend-sign-user-operation",
          requestId: parsedRequest.auth.requestId,
          method: parsedRequest.auth.method,
          contractAddress: parsedRequest.operation.to,
        },
      );

      return reply.send(
        backendSignResponseSchema.parse({
          signature: signingResult.result,
        }),
      );
    },
  );

  app.post(
    "/v1/wallets/:walletId/backend-deploy-wallet",
    async (request, reply) => {
      const params = request.params as { walletId: string };
      const walletRequest = await repository.findById(params.walletId);

      if (!walletRequest) {
        return reply.status(404).send({
          error: "request_not_found",
        });
      }

      const parsedRequest = backendDeployWalletRequestSchema.parse(
        request.body,
      );

      const verification = await verifyBackendSignerAuthorization({
        request: walletRequest,
        auth: parsedRequest.auth,
        body: {
          userOperation: parsedRequest.userOperation,
          signaturePayload: parsedRequest.signaturePayload,
        },
      });

      if (!verification.ok) {
        logDebug(
          app,
          "backend_signer_authorization_denied",
          "Denied backend deploy authorization.",
          {
            walletId: walletRequest.walletId,
            route: "backend-deploy-wallet",
            requestId: parsedRequest.auth.requestId,
            authError: verification.error,
          },
        );
        return reply.status(verification.statusCode).send({
          error: verification.error,
          message: verification.message,
        });
      }

      const policyDecision = evaluateDeployWalletPolicy({
        request: walletRequest,
        userOperation: parsedRequest.userOperation,
        signaturePayload: parsedRequest.signaturePayload,
      });

      if (!policyDecision.ok) {
        logDebug(
          app,
          "runtime_policy_denied",
          "Denied wallet deploy request by runtime policy.",
          {
            walletId: walletRequest.walletId,
            route: "backend-deploy-wallet",
            requestId: parsedRequest.auth.requestId,
            method: parsedRequest.auth.method,
            policyError: policyDecision.error,
          },
        );
        return reply.status(policyDecision.statusCode).send({
          error: policyDecision.error,
          message: policyDecision.message,
        });
      }

      const now = new Date().toISOString();
      const signingResult = await finalizeBackendSigning({
        app,
        repository,
        walletRequest,
        route: "backend-deploy-wallet",
        requestId: parsedRequest.auth.requestId,
        method: parsedRequest.auth.method,
        createdAt: now,
        handler: () =>
          signBackendUserOperationPayload({
            backendPrivateKey: walletRequest.backendPrivateKey as Hex,
            signaturePayload: parsedRequest.signaturePayload,
          }),
      });

      if (!signingResult.ok) {
        return reply
          .status(signingResult.reply.statusCode)
          .send(signingResult.reply.body);
      }

      logInfo(
        app,
        "backend_signature_granted",
        "Granted backend deploy signature.",
        {
          walletId: walletRequest.walletId,
          route: "backend-deploy-wallet",
          requestId: parsedRequest.auth.requestId,
          method: parsedRequest.auth.method,
        },
      );

      return reply.send(
        backendSignResponseSchema.parse({
          signature: signingResult.result,
        }),
      );
    },
  );

  app.get("/v1/provisioning/:walletId", async (request, reply) => {
    const params = request.params as { walletId: string };
    const query = request.query as { t?: string };

    if (!query.t) {
      return reply.status(400).send({
        error: "missing_token",
      });
    }

    const walletRequest = await repository.findByIdAndTokenHash(
      params.walletId,
      hashProvisioningToken(query.t),
    );

    if (!walletRequest) {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    if (isExpired(walletRequest.expiresAt)) {
      return reply.status(410).send({
        error: "provisioning_token_expired",
        message: "The provisioning token has expired.",
      });
    }

    return reply.send(
      resolveProvisioningResponseSchema.parse({
        walletMode: walletRequest.walletMode,
        walletId: walletRequest.walletId,
        status: walletRequest.status,
        walletConfig: walletRequest.walletConfig,
        policy: walletRequest.policy,
        agentAddress: walletRequest.agentAddress,
        backendAddress: walletRequest.backendAddress,
        ownerPublicArtifacts: walletRequest.ownerPublicArtifacts,
        regularValidatorInitArtifact:
          walletRequest.regularValidatorInitArtifact,
        counterfactualWalletAddress:
          walletRequest.counterfactualWalletAddress ?? null,
        funding: walletRequest.funding,
        deployment: walletRequest.deployment,
        expiresAt: walletRequest.expiresAt,
      }),
    );
  });

  app.post(
    "/v1/provisioning/:walletId/owner-artifacts",
    async (request, reply) => {
      const params = request.params as { walletId: string };
      const query = request.query as { t?: string };

      if (!query.t) {
        return reply.status(400).send({
          error: "missing_token",
        });
      }

      const body = publishOwnerArtifactsInputSchema.parse(request.body);
      const existingRequest = await repository.findByIdAndTokenHash(
        params.walletId,
        hashProvisioningToken(query.t),
      );

      if (!existingRequest) {
        return reply.status(404).send({
          error: "request_not_found",
        });
      }

      if (isExpired(existingRequest.expiresAt)) {
        return reply.status(410).send({
          error: "provisioning_token_expired",
          message: "The provisioning token has expired.",
        });
      }

      if (
        existingRequest.status !== "owner_bound" &&
        !canTransitionStatus(existingRequest.status, "owner_bound")
      ) {
        return reply.status(409).send({
          error: "invalid_status_transition",
        });
      }

      const preparedWallet =
        await walletProvisioningService.finalizeProvisioning({
          owner: body.owner,
          regularValidatorInitArtifact: body.regularValidatorInitArtifact,
          walletConfig: existingRequest.walletConfig,
          agentAddress: existingRequest.agentAddress,
          backendAddress: existingRequest.backendAddress,
          counterfactualWalletAddress: body.counterfactualWalletAddress,
        });

      const updatedRequest = await repository.updateProvisioning({
        walletId: params.walletId,
        provisioningTokenHash: hashProvisioningToken(query.t),
        ownerPublicArtifacts: preparedWallet.ownerPublicArtifacts,
        regularValidatorInitArtifact:
          preparedWallet.regularValidatorInitArtifact,
        counterfactualWalletAddress: preparedWallet.counterfactualWalletAddress,
        funding: preparedWallet.funding,
        deployment: preparedWallet.deployment,
        status: preparedWallet.status,
        walletContext: preparedWallet.walletContext,
        updatedAt: new Date().toISOString(),
      });

      if (!updatedRequest) {
        return reply.status(404).send({
          error: "request_not_found",
        });
      }

      logInfo(
        app,
        "owner_artifacts_published",
        "Published owner artifacts for wallet provisioning.",
        {
          walletId: updatedRequest.walletId,
          status: updatedRequest.status,
          previousStatus: existingRequest.status,
          walletAddress:
            updatedRequest.walletContext?.walletAddress ??
            updatedRequest.counterfactualWalletAddress,
        },
      );

      if (updatedRequest.status !== existingRequest.status) {
        logInfo(
          app,
          "wallet_status_updated",
          "Wallet status changed after owner binding.",
          {
            walletId: updatedRequest.walletId,
            previousStatus: existingRequest.status,
            status: updatedRequest.status,
            walletAddress:
              updatedRequest.walletContext?.walletAddress ??
              updatedRequest.counterfactualWalletAddress,
          },
        );
      }

      return reply.send(
        getWalletRequestResponseSchema.parse(
          toPublicWalletRequest(updatedRequest),
        ),
      );
    },
  );
}
