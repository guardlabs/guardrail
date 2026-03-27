import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  canTransitionStatus,
  createWalletRequestInputSchema,
  createWalletRequestResponseSchema,
  getWalletRequestResponseSchema,
  publishOwnerArtifactsInputSchema,
  resolveProvisioningResponseSchema,
  type CreateWalletRequestInput,
} from "@agent-wallet/shared";
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

  return {
    provisioningToken,
    request: {
      walletId,
      status: "created",
      scope: {
        chainId: payload.chainId,
        targetContract: payload.targetContract,
        allowedMethods: payload.allowedMethods,
      },
      sessionPublicKey: payload.sessionPublicKey,
      provisioningTokenHash: hashProvisioningToken(provisioningToken),
      funding: {
        status: "unverified",
        minimumRequiredWei: config.minFundingWei,
      },
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

function assertSupportedChain(chainId: number, config: AppConfig) {
  if (!config.supportedChainIds.includes(chainId)) {
    throw new Error(
      `Unsupported chainId ${chainId}. Configured chains: ${config.supportedChainIds.join(", ")}`,
    );
  }
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
      walletId: nextRequest.walletId,
      status: nextRequest.status,
      provisioningUrl,
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
      walletRequest.status !== "owner_bound" ||
      !walletRequest.ownerPublicArtifacts ||
      !walletRequest.counterfactualWalletAddress ||
      !walletRequest.walletContext
    ) {
      return reply.status(409).send({
        error: "funding_refresh_not_allowed",
      });
    }

    const refreshedWallet = await walletProvisioningService.refreshFunding({
      owner: walletRequest.ownerPublicArtifacts,
      scope: walletRequest.scope,
      sessionPublicKey: walletRequest.sessionPublicKey,
      counterfactualWalletAddress: walletRequest.counterfactualWalletAddress,
      serializedPermissionAccount:
        walletRequest.walletContext.serializedPermissionAccount,
    });

    const updatedRequest = await repository.updateFunding({
      walletId: walletRequest.walletId,
      funding: refreshedWallet.funding,
      status: refreshedWallet.status,
      updatedAt: new Date().toISOString(),
    });

    if (!updatedRequest) {
      return reply.status(404).send({
        error: "request_not_found",
      });
    }

    return reply.send(getWalletRequestResponseSchema.parse(toPublicWalletRequest(updatedRequest)));
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
        walletId: walletRequest.walletId,
        status: walletRequest.status,
        scope: walletRequest.scope,
        sessionPublicKey: walletRequest.sessionPublicKey,
        ownerPublicArtifacts: walletRequest.ownerPublicArtifacts,
        counterfactualWalletAddress: walletRequest.counterfactualWalletAddress ?? null,
        funding: walletRequest.funding,
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
      scope: existingRequest.scope,
      sessionPublicKey: existingRequest.sessionPublicKey,
      counterfactualWalletAddress: body.counterfactualWalletAddress,
      serializedPermissionAccount: body.serializedPermissionAccount,
    });

    const updatedRequest = await repository.updateProvisioning({
      walletId: params.walletId,
      provisioningTokenHash: hashProvisioningToken(query.t),
      ownerPublicArtifacts: preparedWallet.ownerPublicArtifacts,
      counterfactualWalletAddress: preparedWallet.counterfactualWalletAddress,
      funding: preparedWallet.funding,
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
