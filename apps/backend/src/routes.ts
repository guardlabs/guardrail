import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  PROJECT_WALLET_MODE,
  backendSignMessageRequestSchema,
  backendSignResponseSchema,
  backendSignTypedDataRequestSchema,
  buildDefaultWalletConfig,
  canTransitionStatus,
  createWalletRequestInputSchema,
  createWalletRequestResponseSchema,
  getBackendSignerAuthorizationTypedData,
  getWalletRequestResponseSchema,
  hashBackendSignerPayload,
  publishOwnerArtifactsInputSchema,
  resolveProvisioningResponseSchema,
  type BackendSignerMessagePayload,
  type BackendSignerTypedDataPayload,
  type CreateWalletRequestInput,
} from "@agent-wallet/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, type Address, type Hex } from "viem";
import type { AppConfig } from "./config.js";
import type { ChainRelayService, RelayTarget } from "./chain-relay.js";
import type { StoredWalletRequest, WalletRequestRepository } from "./repository.js";
import { toPublicWalletRequest } from "./repository.js";
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

function createProvisioningUrl(input: {
  frontendBaseUrl: string;
  backendBaseUrl: string;
  walletId: string;
  token: string;
}) {
  const url = new URL(input.frontendBaseUrl);
  url.searchParams.set("walletId", input.walletId);
  url.searchParams.set("token", input.token);
  url.searchParams.set("backendUrl", input.backendBaseUrl);
  return url.toString();
}

function buildInitialRequest(
  payload: CreateWalletRequestInput,
  config: AppConfig,
): { request: StoredWalletRequest; provisioningToken: string } {
  const now = new Date();
  const provisioningToken = createProvisioningToken();
  const walletId = createWalletId();
  const timestamp = now.toISOString();
  const backendPrivateKey = generatePrivateKey();
  const backendAccount = privateKeyToAccount(backendPrivateKey);
  const walletConfig = buildDefaultWalletConfig({
    chainId: payload.chainId,
    agentAddress: payload.agentAddress,
    backendAddress: backendAccount.address,
  });

  return {
    provisioningToken,
    request: {
      walletId,
      walletMode: PROJECT_WALLET_MODE,
      status: "created",
      walletConfig,
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
      usedSigningRequestIds: [],
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
  return {
    recommendedPollIntervalMs: 5000,
    walletAddressStatus: "owner_bound" as const,
    humanActionUrl: provisioningUrl,
    humanAction:
      "Ask the human to open the provisioning URL and create the passkey owner for the weighted wallet.",
    walletAddressCommand: `agent-wallet status ${walletId} --backend-url ${backendUrl}`,
    statusCommand: `agent-wallet status ${walletId} --backend-url ${backendUrl}`,
    awaitCommand: `agent-wallet await ${walletId} --backend-url ${backendUrl}`,
    guidance: [
      "Ask the human to open the provisioning URL and create the passkey owner.",
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

function normalizeBackendSignMessage(
  payload: BackendSignerMessagePayload,
): string | { raw: Hex } {
  if (payload.message.kind === "text") {
    return payload.message.text;
  }

  return {
    raw: payload.message.raw as Hex,
  };
}

async function verifyBackendSignerAuthorization(input: {
  request: StoredWalletRequest;
  auth: {
    walletAddress: string;
    backendSignerAddress: string;
    method: "sign_message" | "sign_typed_data";
    bodyHash: string;
    requestId: string;
    expiresAt: string;
    agentSignature: string;
  };
  payload: BackendSignerMessagePayload | BackendSignerTypedDataPayload;
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
      message: "Backend signer authorization walletAddress does not match the ready wallet.",
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
      message: "Backend signer authorization backendSignerAddress does not match the wallet.",
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

  const expectedBodyHash = hashBackendSignerPayload(input.auth.method, input.payload);

  if (expectedBodyHash.toLowerCase() !== input.auth.bodyHash.toLowerCase()) {
    return {
      ok: false as const,
      statusCode: 400,
      error: "body_hash_mismatch",
      message: "Backend signer authorization bodyHash does not match the requested payload.",
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

    if (!Number.isInteger(chainId) || !config.supportedChainIds.includes(chainId)) {
      return reply.status(404).send({
        error: "unsupported_chain",
      });
    }

    try {
      const payload = await chainRelayService.relay({
        chainId,
        target,
        payload: request.body,
      });

      return reply.send(payload);
    } catch (error) {
      return reply.status(502).send({
        error: `${target}_relay_failed`,
        message: error instanceof Error ? error.message : `Failed to relay ${target} request`,
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
      backendBaseUrl: config.publicBackendUrl,
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
      provisioningUrl,
      deployment: nextRequest.deployment,
      expiresAt: nextRequest.expiresAt,
      nextSteps: buildNextSteps(
        nextRequest.walletId,
        config.publicBackendUrl,
        provisioningUrl,
      ),
    });

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

    return reply.send(getWalletRequestResponseSchema.parse(toPublicWalletRequest(walletRequest)));
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
      (walletRequest.status !== "owner_bound" && walletRequest.status !== "ready") ||
      !walletRequest.ownerPublicArtifacts ||
      !walletRequest.regularValidatorInitArtifact ||
      !walletRequest.counterfactualWalletAddress
    ) {
      return reply.status(409).send({
        error: "funding_refresh_not_allowed",
      });
    }

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

    return reply.send(getWalletRequestResponseSchema.parse(toPublicWalletRequest(updatedRequest)));
  });

  app.post("/v1/wallets/:walletId/backend-sign", async (request, reply) => {
    const params = request.params as { walletId: string };
    const walletRequest = await repository.findById(params.walletId);

    if (!walletRequest) {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    const rawBody = request.body as { auth?: { method?: unknown } };
    const authMethod = rawBody.auth?.method;
    const parsedRequest =
      authMethod === "sign_typed_data"
        ? backendSignTypedDataRequestSchema.parse(request.body)
        : backendSignMessageRequestSchema.parse(request.body);

    const verification = await verifyBackendSignerAuthorization({
      request: walletRequest,
      auth: parsedRequest.auth,
      payload: parsedRequest.payload,
    });

    if (!verification.ok) {
      return reply.status(verification.statusCode).send({
        error: verification.error,
        message: verification.message,
      });
    }

    const replay = await repository.recordUsedSigningRequestId({
      walletId: walletRequest.walletId,
      requestId: parsedRequest.auth.requestId,
      updatedAt: new Date().toISOString(),
    });

    if (replay === "not_found") {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    if (replay === "duplicate") {
      return reply.status(409).send({
        error: "request_replayed",
        message: "This backend signer requestId has already been used.",
      });
    }

    const backendAccount = privateKeyToAccount(walletRequest.backendPrivateKey as Hex);

    const signature =
      parsedRequest.auth.method === "sign_typed_data"
        ? await backendAccount.signTypedData(parsedRequest.payload as never)
        : await backendAccount.signMessage({
            message: normalizeBackendSignMessage(
              parsedRequest.payload as BackendSignerMessagePayload,
            ),
          });

    return reply.send(
      backendSignResponseSchema.parse({
        signature,
      }),
    );
  });

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

    return reply.send(
      resolveProvisioningResponseSchema.parse({
        walletMode: walletRequest.walletMode,
        walletId: walletRequest.walletId,
        status: walletRequest.status,
        walletConfig: walletRequest.walletConfig,
        agentAddress: walletRequest.agentAddress,
        backendAddress: walletRequest.backendAddress,
        ownerPublicArtifacts: walletRequest.ownerPublicArtifacts,
        regularValidatorInitArtifact: walletRequest.regularValidatorInitArtifact,
        counterfactualWalletAddress: walletRequest.counterfactualWalletAddress ?? null,
        funding: walletRequest.funding,
        deployment: walletRequest.deployment,
        expiresAt: walletRequest.expiresAt,
      }),
    );
  });

  app.post("/v1/provisioning/:walletId/owner-artifacts", async (request, reply) => {
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

    if (
      existingRequest.status !== "owner_bound" &&
      !canTransitionStatus(existingRequest.status, "owner_bound")
    ) {
      return reply.status(409).send({
        error: "invalid_status_transition",
      });
    }

    const preparedWallet = await walletProvisioningService.finalizeProvisioning({
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
      regularValidatorInitArtifact: preparedWallet.regularValidatorInitArtifact,
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

    return reply.send(getWalletRequestResponseSchema.parse(toPublicWalletRequest(updatedRequest)));
  });
}

export const INTERNALS = {
  assertSupportedChain,
  buildInitialRequest,
  createProvisioningUrl,
  createWalletId,
  hashProvisioningToken,
};
