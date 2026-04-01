import { describe, expect, it, vi } from "vitest";
import {
  type DeploymentState,
  PROJECT_WALLET_MODE,
  buildDefaultWalletConfig,
  getBackendSignerAuthorizationTypedData,
  hashBackendSignerRequestBody,
  type FundingState,
  type OwnerPublicArtifacts,
  type RegularValidatorInitArtifact,
  type WalletContext,
} from "@conduit/shared";
import { hashTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { ChainRelayService } from "./chain-relay.js";
import type {
  StoredWalletRequest,
  WalletRequestRepository,
} from "./repository.js";
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
  const signingRequests = new Set<string>();
  const consumptions = new Map<
    string,
    Array<{
      walletId: string;
      asset: "usdc";
      operation: string;
      amountMinor: string;
      requestId: string;
      createdAt: string;
    }>
  >();

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
    async updateFunding({
      walletId,
      funding,
      deployment,
      status,
      walletContext,
      updatedAt,
    }) {
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
    async runBackendSigningOperation({
      walletId,
      requestId,
      consumption,
      handler,
      updatedAt,
    }) {
      const request = requests.get(walletId);
      if (!request) {
        return {
          status: "not_found" as const,
        };
      }

      if (signingRequests.has(requestId)) {
        return {
          status: "duplicate" as const,
        };
      }

      signingRequests.add(requestId);
      const previousConsumptions = consumptions.get(walletId) ?? [];
      const updatedRequest: StoredWalletRequest = {
        ...request,
        updatedAt,
      };
      requests.set(walletId, updatedRequest);

      if (consumption) {
        consumptions.set(walletId, [...previousConsumptions, consumption]);
      }

      try {
        const result = await handler();

        return {
          status: "ok" as const,
          result,
        };
      } catch (error) {
        signingRequests.delete(requestId);
        requests.set(walletId, request);
        consumptions.set(walletId, previousConsumptions);
        throw error;
      }
    },
    async updateRuntimePolicyState({
      walletId,
      runtimePolicyState,
      updatedAt,
    }) {
      const request = requests.get(walletId);
      if (!request) {
        return null;
      }

      const updatedRequest: StoredWalletRequest = {
        ...request,
        runtimePolicyState,
        updatedAt,
      };
      requests.set(walletId, updatedRequest);
      return updatedRequest;
    },
    async listRuntimePolicyConsumptionsSince({
      walletId,
      asset,
      createdAtGte,
    }) {
      return (consumptions.get(walletId) ?? []).filter(
        (entry) =>
          entry.asset === asset &&
          new Date(entry.createdAt).getTime() >=
            new Date(createdAtGte).getTime(),
      );
    },
    async createRuntimePolicyConsumption(input) {
      const next = consumptions.get(input.walletId) ?? [];
      consumptions.set(input.walletId, [...next, input]);
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

function createTestChainRelayService() {
  const calls: Array<{
    chainId: number;
    target: "rpc" | "bundler";
    payload: unknown;
  }> = [];

  const service: ChainRelayService = {
    async relay(input) {
      calls.push(input);

      return {
        ok: true,
        target: input.target,
      };
    },
  };

  return {
    service,
    calls,
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

function createFutureIsoDate(minutesFromNow: number) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

function createRuntimePolicy() {
  return {
    contractAllowlist: [
      {
        contractAddress: "0x4444444444444444444444444444444444444444",
        allowedSelectors: ["0xa9059cbb"],
      },
    ],
    usdcPolicy: {
      period: "daily" as const,
      maxAmountMinor: "1000000000",
      allowedOperations: [
        "transfer",
        "approve",
        "increaseAllowance",
        "permit",
        "transferWithAuthorization",
      ],
    },
  };
}

function expectLogEvent(
  spy: ReturnType<typeof vi.spyOn>,
  event: string,
  expectedFields: Record<string, unknown>,
) {
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      event,
      ...expectedFields,
    }),
    expect.any(String),
  );
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
    const infoSpy = vi.spyOn(app.log, "info");

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
        policy: createRuntimePolicy(),
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const createdWallet = createResponse.json() as {
      walletId: string;
      backendAddress: string;
      walletConfig: { chainId: number };
      policy: {
        contractAllowlist: Array<{
          contractAddress: string;
          allowedSelectors: string[];
        }>;
      };
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
      policy: createRuntimePolicy(),
    });
    expect(
      createdWallet.backendAddress.toLowerCase() <
        agentAccount.address.toLowerCase(),
    ).toBe(true);
    expect(createdWallet.provisioningUrl).toContain(
      `walletId=${createdWallet.walletId}`,
    );
    expectLogEvent(infoSpy, "wallet_request_created", {
      walletId: createdWallet.walletId,
      chainId: 84532,
      status: "created",
    });

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
    const infoSpy = vi.spyOn(app.log, "info");

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
        policy: {
          usdcPolicy: {
            period: "daily",
            maxAmountMinor: "1000000000",
            allowedOperations: ["transferWithAuthorization"],
          },
        },
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
        counterfactualWalletAddress:
          "0x2222222222222222222222222222222222222222",
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
    expectLogEvent(infoSpy, "wallet_status_updated", {
      walletId: createdWallet.walletId,
      status: "ready",
      previousStatus: "created",
    });

    await app.close();
  });

  it("relays allowed RPC methods used by the CLI runtime", async () => {
    const chainRelay = createTestChainRelayService();
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      chainRelayService: chainRelay.service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chains/84532/rpc",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      target: "rpc",
    });
    expect(chainRelay.calls).toEqual([
      {
        chainId: 84532,
        target: "rpc",
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [],
        },
      },
    ]);

    await app.close();
  });

  it("rejects RPC relay methods outside the CLI allowlist", async () => {
    const chainRelay = createTestChainRelayService();
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      chainRelayService: chainRelay.service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chains/84532/rpc",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: ["0xdeadbeef"],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "rpc_method_not_allowed",
    });
    expect(chainRelay.calls).toEqual([]);

    await app.close();
  });

  it("relays allowed bundler methods used by the CLI runtime", async () => {
    const chainRelay = createTestChainRelayService();
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      chainRelayService: chainRelay.service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chains/84532/bundler",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendUserOperation",
        params: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      target: "bundler",
    });
    expect(chainRelay.calls).toEqual([
      {
        chainId: 84532,
        target: "bundler",
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendUserOperation",
          params: [],
        },
      },
    ]);

    await app.close();
  });

  it("rejects malformed relay payloads without a JSON-RPC method", async () => {
    const chainRelay = createTestChainRelayService();
    const app = buildApp({
      config: testConfig,
      repository: createTestRepository(),
      chainRelayService: chainRelay.service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chains/84532/rpc",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        params: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_relay_request",
    });
    expect(chainRelay.calls).toEqual([]);

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
        policy: createRuntimePolicy(),
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
        policy: createRuntimePolicy(),
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
        counterfactualWalletAddress:
          "0x2222222222222222222222222222222222222222",
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
    const infoSpy = vi.spyOn(app.log, "info");
    const debugSpy = vi.spyOn(app.log, "debug");

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
        policy: createRuntimePolicy(),
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
        counterfactualWalletAddress:
          "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact: createRegularValidatorInitArtifact(),
      },
    });

    const readyWallet = ownerArtifactsResponse.json() as {
      walletContext: {
        walletAddress: string;
      };
      backendAddress: string;
    };
    const body = {
      typedData: {
        domain: {
          name: "USDC",
          version: "2",
          chainId: 84532,
          verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        },
        primaryType: "Permit",
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        message: {
          owner: readyWallet.walletContext.walletAddress,
          spender: "0x3333333333333333333333333333333333333333",
          value: "1",
          nonce: "0",
          deadline: "100",
        },
      },
      signaturePayload: {
        kind: "kernel_wrapped_typed_data" as const,
        typedData: {
          domain: {
            name: "Kernel",
            version: "0.3.1",
            chainId: 84532,
            verifyingContract: readyWallet.walletContext.walletAddress,
          },
          types: {
            Kernel: [{ name: "hash", type: "bytes32" }],
          },
          primaryType: "Kernel",
          message: {
            hash: hashTypedData({
              domain: {
                name: "USDC",
                version: "2",
                chainId: 84532,
                verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              },
              primaryType: "Permit",
              types: {
                Permit: [
                  { name: "owner", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "nonce", type: "uint256" },
                  { name: "deadline", type: "uint256" },
                ],
              },
              message: {
                owner: readyWallet.walletContext.walletAddress,
                spender: "0x3333333333333333333333333333333333333333",
                value: "1",
                nonce: "0",
                deadline: "100",
              },
            } as never),
          },
        },
      },
    };
    const authPayload = {
      walletAddress: readyWallet.walletContext.walletAddress,
      backendSignerAddress: readyWallet.backendAddress,
      method: "sign_typed_data_v1" as const,
      bodyHash: hashBackendSignerRequestBody("sign_typed_data_v1", body),
      requestId: "req_replay_guard",
      expiresAt: createFutureIsoDate(5),
    };
    const agentSignature = await agentAccount.signTypedData(
      getBackendSignerAuthorizationTypedData(authPayload),
    );

    const signResponse = await app.inject({
      method: "POST",
      url: `/v1/wallets/${createdWallet.walletId}/backend-sign-typed-data`,
      payload: {
        auth: {
          ...authPayload,
          agentSignature,
        },
        typedData: body.typedData,
        signaturePayload: body.signaturePayload,
      },
    });

    expect(signResponse.statusCode).toBe(200);
    expect(signResponse.json().signature).toMatch(/^0x[a-f0-9]+$/);
    expectLogEvent(infoSpy, "backend_signature_granted", {
      walletId: createdWallet.walletId,
      route: "backend-sign-typed-data",
      method: "sign_typed_data_v1",
    });

    const replayedResponse = await app.inject({
      method: "POST",
      url: `/v1/wallets/${createdWallet.walletId}/backend-sign-typed-data`,
      payload: {
        auth: {
          ...authPayload,
          agentSignature,
        },
        typedData: body.typedData,
        signaturePayload: body.signaturePayload,
      },
    });

    expect(replayedResponse.statusCode).toBe(409);
    expect(replayedResponse.json()).toMatchObject({
      error: "request_replayed",
    });
    expectLogEvent(debugSpy, "backend_signer_request_replayed", {
      walletId: createdWallet.walletId,
      route: "backend-sign-typed-data",
      requestId: "req_replay_guard",
    });

    await app.close();
  });

  it("logs policy denials at debug level", async () => {
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
    const debugSpy = vi.spyOn(app.log, "debug");

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets",
      payload: {
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: agentAccount.address,
        policy: {
          usdcPolicy: {
            period: "daily",
            maxAmountMinor: "1000000000",
            allowedOperations: ["transferWithAuthorization"],
          },
        },
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
        counterfactualWalletAddress:
          "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact: createRegularValidatorInitArtifact(),
      },
    });

    const readyWallet = ownerArtifactsResponse.json() as {
      walletContext: {
        walletAddress: string;
      };
      backendAddress: string;
    };
    const body = {
      typedData: {
        domain: {
          name: "USDC",
          version: "2",
          chainId: 84532,
          verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        },
        primaryType: "Permit",
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        message: {
          owner: readyWallet.walletContext.walletAddress,
          spender: "0x3333333333333333333333333333333333333333",
          value: "1",
          nonce: "0",
          deadline: "100",
        },
      },
      signaturePayload: {
        kind: "kernel_wrapped_typed_data" as const,
        typedData: {
          domain: {
            name: "Kernel",
            version: "0.3.1",
            chainId: 84532,
            verifyingContract: readyWallet.walletContext.walletAddress,
          },
          types: {
            Kernel: [{ name: "hash", type: "bytes32" }],
          },
          primaryType: "Kernel",
          message: {
            hash: hashTypedData({
              domain: {
                name: "USDC",
                version: "2",
                chainId: 84532,
                verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              },
              primaryType: "Permit",
              types: {
                Permit: [
                  { name: "owner", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "nonce", type: "uint256" },
                  { name: "deadline", type: "uint256" },
                ],
              },
              message: {
                owner: readyWallet.walletContext.walletAddress,
                spender: "0x3333333333333333333333333333333333333333",
                value: "1",
                nonce: "0",
                deadline: "100",
              },
            } as never),
          },
        },
      },
    };
    const authPayload = {
      walletAddress: readyWallet.walletContext.walletAddress,
      backendSignerAddress: readyWallet.backendAddress,
      method: "sign_typed_data_v1" as const,
      bodyHash: hashBackendSignerRequestBody("sign_typed_data_v1", body),
      requestId: "req_policy_denied",
      expiresAt: createFutureIsoDate(5),
    };
    const agentSignature = await agentAccount.signTypedData(
      getBackendSignerAuthorizationTypedData(authPayload),
    );

    const deniedResponse = await app.inject({
      method: "POST",
      url: `/v1/wallets/${createdWallet.walletId}/backend-sign-typed-data`,
      payload: {
        auth: {
          ...authPayload,
          agentSignature,
        },
        typedData: body.typedData,
        signaturePayload: body.signaturePayload,
      },
    });

    expect(deniedResponse.statusCode).toBe(403);
    expect(deniedResponse.json()).toMatchObject({
      error: "usdc_operation_not_allowed",
    });
    expectLogEvent(debugSpy, "runtime_policy_denied", {
      walletId: createdWallet.walletId,
      route: "backend-sign-typed-data",
      policyError: "usdc_operation_not_allowed",
    });

    await app.close();
  });
});
