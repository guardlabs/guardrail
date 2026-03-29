import { describe, expect, it, vi } from "vitest";
import type { FundingState, OwnerPublicArtifacts, WalletContext } from "@agent-wallet/shared";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { StoredWalletRequest, WalletRequestRepository } from "./repository.js";
import type { WalletProvisioningService } from "./wallet.js";

const testConfig: AppConfig = {
  port: 3000,
  databaseUrl: "postgresql://test:test@127.0.0.1:5432/agent_wallet_test",
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
      counterfactualWalletAddress,
      funding,
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
        counterfactualWalletAddress,
        funding,
        status,
        walletContext,
        updatedAt,
      };
      requests.set(walletId, updatedRequest);
      return updatedRequest;
    },
    async updateFunding({ walletId, funding, status, updatedAt }) {
      const request = requests.get(walletId);
      if (!request) {
        return null;
      }

      const updatedRequest: StoredWalletRequest = {
        ...request,
        funding,
        status,
        updatedAt,
      };
      requests.set(walletId, updatedRequest);
      return updatedRequest;
    },
  };
}

function createTestWalletProvisioningService(result: {
  funding: FundingState;
  walletContext?: WalletContext;
}) : WalletProvisioningService {
  return {
    async finalizeProvisioning(input) {
      return {
        ownerPublicArtifacts: input.owner,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding: result.funding,
        walletContext: result.walletContext ?? {
          walletAddress: input.counterfactualWalletAddress,
          chainId: input.scope.chainId,
          kernelVersion: "3.1",
          sessionPublicKey: input.sessionPublicKey,
          owner: input.owner,
          scope: input.scope,
          policyDigest: "0x12345678",
          serializedPermissionAccount: input.serializedPermissionAccount,
        },
        status: result.funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
    async refreshFunding(input) {
      return {
        ownerPublicArtifacts: input.owner,
        counterfactualWalletAddress: input.counterfactualWalletAddress,
        funding: result.funding,
        walletContext: result.walletContext ?? {
          walletAddress: input.counterfactualWalletAddress,
          chainId: input.scope.chainId,
          kernelVersion: "3.1",
          sessionPublicKey: input.sessionPublicKey,
          owner: input.owner,
          scope: input.scope,
          policyDigest: "0x12345678",
          serializedPermissionAccount: input.serializedPermissionAccount,
        },
        status: result.funding.status === "verified" ? "ready" : "owner_bound",
      };
    },
  };
}

describe("backend app", () => {
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
      service: "agent-wallet-backend",
    });

    await app.close();
  });

  it("creates and reads a wallet request", async () => {
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "insufficient",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "1",
          checkedAt: "2026-03-25T12:00:00.000Z",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        chainId: 84532,
        contractPermissions: [
          {
            targetContract: "0x1111111111111111111111111111111111111111",
            allowedMethods: ["0xa9059cbb"],
          },
        ],
        sessionPublicKey: "0x1234",
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };

    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/wallets/${createdWallet.walletId}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      walletId: createdWallet.walletId,
      status: "created",
      scope: {
        chainId: 84532,
      },
    });
    expect(createdWallet.provisioningUrl).toContain(`walletId=${createdWallet.walletId}`);

    await app.close();
  });

  it("moves a request to ready when wallet preparation and funding succeed", async () => {
    const repository = createTestRepository();
    const app = buildApp({
      config: testConfig,
      repository,
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "verified",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "600000000000000",
          checkedAt: "2026-03-25T12:00:00.000Z",
        },
        walletContext: {
          walletAddress: "0x2222222222222222222222222222222222222222",
          chainId: 84532,
          kernelVersion: "3.1",
          sessionPublicKey: "0x1234",
          owner: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          scope: {
            chainId: 84532,
            contractPermissions: [
              {
                targetContract: "0x1111111111111111111111111111111111111111",
                allowedMethods: ["0xa9059cbb"],
              },
            ],
          },
          policyDigest: "0x12345678",
          serializedPermissionAccount: "approval_123",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        chainId: 84532,
        contractPermissions: [
          {
            targetContract: "0x1111111111111111111111111111111111111111",
            allowedMethods: ["0xa9059cbb"],
          },
        ],
        sessionPublicKey: "0x1234",
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };
    const provisioningUrl = new URL(createdWallet.provisioningUrl);
    const token = provisioningUrl.searchParams.get("token");

    expect(token).toBeTruthy();

    const bindResponse = await app.inject({
      method: "POST",
      url: `/v1/provisioning/${createdWallet.walletId}/owner-artifacts?t=${token}`,
      payload: {
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        serializedPermissionAccount: "approval_123",
      },
    });

    expect(bindResponse.statusCode).toBe(200);
    expect(bindResponse.json()).toMatchObject({
      walletId: createdWallet.walletId,
      status: "ready",
      funding: {
        status: "verified",
        minimumRequiredWei: testConfig.minFundingWei,
      },
      walletContext: {
        walletAddress: "0x2222222222222222222222222222222222222222",
      },
    });

    await app.close();
  });

  it("keeps a request in owner_bound when funding is insufficient", async () => {
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      walletProvisioningService: createTestWalletProvisioningService({
        funding: {
          status: "insufficient",
          minimumRequiredWei: testConfig.minFundingWei,
          balanceWei: "1000",
          checkedAt: "2026-03-25T12:00:00.000Z",
        },
        walletContext: {
          walletAddress: "0x3333333333333333333333333333333333333333",
          chainId: 84532,
          kernelVersion: "3.1",
          sessionPublicKey: "0x1234",
          owner: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          scope: {
            chainId: 84532,
            contractPermissions: [
              {
                targetContract: "0x1111111111111111111111111111111111111111",
                allowedMethods: ["0xa9059cbb"],
              },
            ],
          },
          policyDigest: "0x12345678",
          serializedPermissionAccount: "approval_123",
        },
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        chainId: 84532,
        contractPermissions: [
          {
            targetContract: "0x1111111111111111111111111111111111111111",
            allowedMethods: ["0xa9059cbb"],
          },
        ],
        sessionPublicKey: "0x1234",
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };
    const provisioningUrl = new URL(createdWallet.provisioningUrl);
    const token = provisioningUrl.searchParams.get("token");

    expect(token).toBeTruthy();

    const bindResponse = await app.inject({
      method: "POST",
      url: `/v1/provisioning/${createdWallet.walletId}/owner-artifacts?t=${token}`,
      payload: {
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x3333333333333333333333333333333333333333",
        serializedPermissionAccount: "approval_123",
      },
    });

    expect(bindResponse.statusCode).toBe(200);
    expect(bindResponse.json()).toMatchObject({
      walletId: createdWallet.walletId,
      status: "owner_bound",
      funding: {
        status: "insufficient",
        minimumRequiredWei: testConfig.minFundingWei,
      },
      walletContext: {
        walletAddress: "0x3333333333333333333333333333333333333333",
      },
    });

    await app.close();
  });

  it("refreshes funding and promotes an owner_bound request to ready", async () => {
    const repository = createTestRepository();
    let fundingStatus: FundingState = {
      status: "insufficient",
      minimumRequiredWei: testConfig.minFundingWei,
      balanceWei: "0",
      checkedAt: "2026-03-25T12:00:00.000Z",
    };

    const app = buildApp({
      config: testConfig,
      repository,
      walletProvisioningService: {
        async finalizeProvisioning(input) {
          return {
            ownerPublicArtifacts: input.owner,
            counterfactualWalletAddress: input.counterfactualWalletAddress,
            funding: fundingStatus,
            walletContext: {
              walletAddress: input.counterfactualWalletAddress,
              chainId: input.scope.chainId,
              kernelVersion: "3.1",
              sessionPublicKey: input.sessionPublicKey,
              owner: input.owner,
              scope: input.scope,
              policyDigest: "0x12345678",
              serializedPermissionAccount: input.serializedPermissionAccount,
            },
            status: "owner_bound",
          };
        },
        async refreshFunding(input) {
          return {
            ownerPublicArtifacts: input.owner,
            counterfactualWalletAddress: input.counterfactualWalletAddress,
            funding: fundingStatus,
            walletContext: {
              walletAddress: input.counterfactualWalletAddress,
              chainId: input.scope.chainId,
              kernelVersion: "3.1",
              sessionPublicKey: input.sessionPublicKey,
              owner: input.owner,
              scope: input.scope,
              policyDigest: "0x12345678",
              serializedPermissionAccount: input.serializedPermissionAccount,
            },
            status: fundingStatus.status === "verified" ? "ready" : "owner_bound",
          };
        },
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        chainId: 84532,
        contractPermissions: [
          {
            targetContract: "0x1111111111111111111111111111111111111111",
            allowedMethods: ["0xa9059cbb"],
          },
        ],
        sessionPublicKey: "0x1234",
      },
    });

    const createdWallet = createResponse.json() as {
      walletId: string;
      provisioningUrl: string;
    };
    const provisioningUrl = new URL(createdWallet.provisioningUrl);
    const token = provisioningUrl.searchParams.get("token");

    expect(token).toBeTruthy();

    await app.inject({
      method: "POST",
      url: `/v1/provisioning/${createdWallet.walletId}/owner-artifacts?t=${token}`,
      payload: {
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x4444444444444444444444444444444444444444",
        serializedPermissionAccount: "approval_123",
      },
    });

    fundingStatus = {
      status: "verified",
      minimumRequiredWei: testConfig.minFundingWei,
      balanceWei: "700000000000000",
      checkedAt: "2026-03-25T12:05:00.000Z",
    };

    const refreshResponse = await app.inject({
      method: "POST",
      url: `/v1/wallets/${createdWallet.walletId}/refresh-funding`,
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json()).toMatchObject({
      walletId: createdWallet.walletId,
      status: "ready",
      funding: {
        status: "verified",
        balanceWei: "700000000000000",
        minimumRequiredWei: testConfig.minFundingWei,
      },
    });

    await app.close();
  });

  it("proxies supported chain JSON-RPC requests through the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: "0x1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = buildApp({
      config: {
        ...testConfig,
        rpcUrlsByChain: {
          84532: "https://rpc.example.test/base-sepolia",
        },
      },
      repository: createTestRepository(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chains/84532/rpc",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: "0x1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rpc.example.test/base-sepolia",
      expect.objectContaining({
        method: "POST",
      }),
    );

    await app.close();
  });

  it("rejects chain proxy requests for unsupported chains", async () => {
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chains/1/rpc",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      },
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
