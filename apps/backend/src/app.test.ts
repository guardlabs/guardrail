import { describe, expect, it } from "vitest";
import {
  type DeploymentState,
  PROJECT_WALLET_MODE,
  buildDefaultWalletConfig,
  getBackendSignerAuthorizationTypedData,
  hashBackendSignerPayload,
  type FundingState,
  type OwnerPublicArtifacts,
  type RegularValidatorInitArtifact,
  type WalletContext,
} from "@conduit/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { StoredWalletRequest, WalletRequestRepository } from "./repository.js";
import type { WalletProvisioningService } from "./wallet.js";

const testConfig: AppConfig = {
  port: 3000,
  databaseUrl: "postgresql://test:test@127.0.0.1:5432/conduit_test",
  publicBackendUrl: "http://127.0.0.1:3000",
  frontendBaseUrl: "http://127.0.0.1:5173",
  minFundingWei: "500000000000000",
  requestTtlHours: 24,
  supportedChainIds: [84532],
  bundlerUrlsByChain: {},
  rpcUrlsByChain: {},
};

function createTestRepository(): WalletRequestRepository {
  const requests = new Map<string, StoredWalletRequest>();

  return {
    async create(request) {
      requests.set(request.walletId, request);
    },
    async findById(walletId) {
      return requests.get(walletId) ?? null;
    },
    async findByIdAndTokenHash(walletId, provisioningTokenHash) {
      const request = requests.get(walletId);
      if (!request || request.provisioningTokenHash !== provisioningTokenHash) {
        return null;
      }
      return request;
    },
    async updateProvisioning({
      walletId,
      provisioningTokenHash,
      ownerPublicArtifacts,
      regularValidatorInitArtifact,
      counterfactualWalletAddress,
      funding,
      deployment,
      status,
      walletContext,
      updatedAt,
    }) {
      const request = requests.get(walletId);
      if (!request || request.provisioningTokenHash !== provisioningTokenHash) {
        return null;
      }

      const updatedRequest: StoredWalletRequest = {
        ...request,
        ownerPublicArtifacts,
        regularValidatorInitArtifact,
        counterfactualWalletAddress,
        funding,
        deployment,
        status,
        walletContext,
        updatedAt,
      };
      requests.set(walletId, updatedRequest);
      return updatedRequest;
    },
    async updateFunding({ walletId, funding, deployment, status, walletContext, updatedAt }) {
      const request = requests.get(walletId);
      if (!request) {
        return null;
      }

      const updatedRequest: StoredWalletRequest = {
        ...request,
        funding,
        deployment,
        status,
        walletContext: walletContext ?? request.walletContext,
        updatedAt,
      };
      requests.set(walletId, updatedRequest);
      return updatedRequest;
    },
    async recordUsedSigningRequestId({ walletId, requestId, updatedAt }) {
      const request = requests.get(walletId);
      if (!request) {
        return "not_found";
      }

      if (request.usedSigningRequestIds.includes(requestId)) {
        return "duplicate";
      }

      requests.set(walletId, {
        ...request,
        usedSigningRequestIds: [...request.usedSigningRequestIds, requestId],
        updatedAt,
      });

      return "ok";
    },
  };
}

function createWalletContext(input: {
  walletAddress: string;
  owner: OwnerPublicArtifacts;
  agentAddress: string;
  backendAddress: string;
}) {
  return {
    walletAddress: input.walletAddress,
    chainId: 84532,
    kernelVersion: "3.1",
    entryPointVersion: "0.7",
    owner: input.owner,
    agentAddress: input.agentAddress,
    backendAddress: input.backendAddress,
    weightedValidator: buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: input.agentAddress,
      backendAddress: input.backendAddress,
    }).regularValidator,
  } satisfies WalletContext;
}

function createTestWalletProvisioningService(result: {
  funding: FundingState;
  deployment?: DeploymentState;
  walletContext?: WalletContext;
}): WalletProvisioningService {
  return {
    async finalizeProvisioning(input) {
      return {
        ownerPublicArtifacts: input.owner,
        regularValidatorInitArtifact: input.regularValidatorInitArtifact,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding: result.funding,
        deployment: result.deployment ?? {
          status: "undeployed",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
        walletContext:
          result.walletContext ??
          createWalletContext({
            walletAddress: input.counterfactualWalletAddress,
            owner: input.owner,
            agentAddress: input.agentAddress,
            backendAddress: input.backendAddress,
          }),
        status: result.funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
    async refreshFunding(input) {
      return {
        ownerPublicArtifacts: input.owner,
        regularValidatorInitArtifact: input.regularValidatorInitArtifact,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding: result.funding,
        deployment: result.deployment ?? {
          status: "undeployed",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
        walletContext:
          result.walletContext ??
          createWalletContext({
            walletAddress: input.counterfactualWalletAddress,
            owner: input.owner,
            agentAddress: input.agentAddress,
            backendAddress: input.backendAddress,
          }),
        status: result.funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
  };
}

function extractProvisioningToken(provisioningUrl: string) {
  const url = new URL(provisioningUrl);
  const token = url.searchParams.get("token");

  if (!token) {
    throw new Error("Missing provisioning token in test URL.");
  }

  return token;
}

function createRegularValidatorInitArtifact(): RegularValidatorInitArtifact {
  return {
    validatorAddress: "0x3333333333333333333333333333333333333333",
    enableData: "0x1234",
    pluginEnableSignature: "0x5678",
  };
}

describe("backend app mode B", () => {
  it("serves a health endpoint", async () => {
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "conduit-wallet-backend",
    });

    await app.close();
  });

  it("creates and reads a mode B wallet request", async () => {
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "insufficient",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "1",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const createdWallet = createResponse.json() as {
      walletId: string;
      backendAddress: string;
      walletConfig: { chainId: number };
      provisioningUrl: string;
    };

    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/wallets/${createdWallet.walletId}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      walletMode: PROJECT_WALLET_MODE,
      walletId: createdWallet.walletId,
      status: "created",
      agentAddress: agentAccount.address,
      backendAddress: createdWallet.backendAddress,
      walletConfig: {
        chainId: 84532,
      },
    });
    expect(createdWallet.provisioningUrl).toContain(`walletId=${createdWallet.walletId}`);

    await app.close();
  });

  it("moves a request to ready when passkey binding and funding succeed", async () => {
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const repository = createTestRepository();
    const app = buildApp({
      config: testConfig,
      repository,
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "verified",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "600000000000000",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };
    const token = extractProvisioningToken(createdWallet.provisioningUrl);

    const ownerArtifactsResponse = await app.inject({
      method: "POST",
      url: `/v1/provisioning/${createdWallet.walletId}/owner-artifacts?t=${encodeURIComponent(token)}`,
      payload: {
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact: createRegularValidatorInitArtifact(),
      },
    });

    expect(ownerArtifactsResponse.statusCode).toBe(200);
    expect(ownerArtifactsResponse.json()).toMatchObject({
      status: "ready",
      counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
      regularValidatorInitArtifact: createRegularValidatorInitArtifact(),
      walletContext: {
        walletAddress: "0x2222222222222222222222222222222222222222",
        agentAddress: agentAccount.address,
      },
    });

    await app.close();
  });

  it("rejects loading provisioning details when the provisioning token has expired", async () => {
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const app = buildApp({
      config: {
        ...testConfig,
        requestTtlHours: -1,
      },
      repository: createTestRepository(),
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "verified",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "600000000000000",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };
    const token = extractProvisioningToken(createdWallet.provisioningUrl);

    const provisioningResponse = await app.inject({
      method: "GET",
      url: `/v1/provisioning/${createdWallet.walletId}?t=${encodeURIComponent(token)}`,
    });

    expect(provisioningResponse.statusCode).toBe(410);
    expect(provisioningResponse.json()).toMatchObject({
      error: "provisioning_token_expired",
    });

    await app.close();
  });

  it("rejects publishing owner artifacts when the provisioning token has expired", async () => {
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const app = buildApp({
      config: {
        ...testConfig,
        requestTtlHours: -1,
      },
      repository: createTestRepository(),
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "verified",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "600000000000000",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };
    const token = extractProvisioningToken(createdWallet.provisioningUrl);

    const ownerArtifactsResponse = await app.inject({
      method: "POST",
      url: `/v1/provisioning/${createdWallet.walletId}/owner-artifacts?t=${encodeURIComponent(token)}`,
      payload: {
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact: createRegularValidatorInitArtifact(),
      },
    });

    expect(ownerArtifactsResponse.statusCode).toBe(410);
    expect(ownerArtifactsResponse.json()).toMatchObject({
      error: "provisioning_token_expired",
    });

    await app.close();
  });

  it("authenticates backend signing requests and rejects replayed requestIds", async () => {
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "verified",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "600000000000000",
          checkedAt: "2026-03-29T12:00:00.000Z",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
      backendAddress: string;
    };
    const token = extractProvisioningToken(createdWallet.provisioningUrl);

    const ownerArtifactsResponse = await app.inject({
      method: "POST",
      url: `/v1/provisioning/${createdWallet.walletId}/owner-artifacts?t=${encodeURIComponent(token)}`,
      payload: {
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact: createRegularValidatorInitArtifact(),
      },
    });

    const readyWallet = ownerArtifactsResponse.json() as {
      walletContext: {
        walletAddress: string;
      };
      backendAddress: string;
    };
    const payload = {
      message: {
        kind: "raw" as const,
        raw: "0x1234",
      },
    };
    const authPayload = {
      walletAddress: readyWallet.walletContext.walletAddress,
      backendSignerAddress: readyWallet.backendAddress,
      method: "sign_message" as const,
      bodyHash: hashBackendSignerPayload("sign_message", payload),
      requestId: "req_replay_guard",
      expiresAt: "2026-03-30T18:00:00.000Z",
    };
    const agentSignature = await agentAccount.signTypedData(
      getBackendSignerAuthorizationTypedData(authPayload),
    );

    const signResponse = await app.inject({
      method: "POST",
      url: `/v1/wallets/${createdWallet.walletId}/backend-sign`,
      payload: {
        auth: {
          ...authPayload,
          agentSignature,
        },
        payload,
      },
    });

    expect(signResponse.statusCode).toBe(200);
    expect(signResponse.json().signature).toMatch(/^0x[a-f0-9]+$/);

    const replayedResponse = await app.inject({
      method: "POST",
      url: `/v1/wallets/${createdWallet.walletId}/backend-sign`,
      payload: {
        auth: {
          ...authPayload,
          agentSignature,
        },
        payload,
      },
    });

    expect(replayedResponse.statusCode).toBe(409);
    expect(replayedResponse.json()).toMatchObject({
      error: "request_replayed",
    });

    await app.close();
  });
});
