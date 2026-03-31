import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_WALLET_MODE,
  buildDefaultWalletConfig,
  getSupportedChainById,
  x402PaymentPayloadSchema,
} from "@conduit/shared";
import {
  hydrateReadyWalletRequest,
  callReadyWalletTransaction,
  ensureReadyWalletDeployed,
  signReadyWalletTypedData,
} from "./kernel.js";
import { readLocalWalletRequest, saveLocalWalletRequest } from "./local-store.js";
import {
  buildOfficialUsdcTransferWithAuthorizationTypedData,
  executeAwait,
  executeCall,
  executeCreate,
  executeX402Fetch,
  executeSignTypedData,
  executeStatus,
  executeX402Sign,
} from "./commands.js";

vi.mock("./kernel.js", () => ({
  hydrateReadyWalletRequest: vi.fn(),
  callReadyWalletTransaction: vi.fn(),
  ensureReadyWalletDeployed: vi.fn(),
  signReadyWalletTypedData: vi.fn(),
}));

function createRuntimePolicy() {
  return {
    contractAllowlist: [
      {
        contractAddress: "0x4444444444444444444444444444444444444444",
        allowedSelectors: ["0xa9059cbb"],
      },
    ],
  };
}

describe("cli commands mode B", () => {
  let tempStoreDirectory = "";

  beforeEach(async () => {
    tempStoreDirectory = await mkdtemp(join(tmpdir(), "conduit-wallet-cli-"));
    process.env.CONDUIT_LOCAL_STORE_DIR = tempStoreDirectory;
  });

  afterEach(() => {
    delete process.env.CONDUIT_LOCAL_STORE_DIR;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (tempStoreDirectory) {
      await rm(tempStoreDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("creates a mode B wallet request and persists local runtime state", async () => {
    const expectedPolicy = {
      contractAllowlist: [
        {
          contractAddress: "0x2222222222222222222222222222222222222222",
          allowedSelectors: ["0xa9059cbb", "0x095ea7b3"],
        },
      ],
      usdcPolicy: {
        period: "daily",
        maxAmountMinor: "125000000",
        allowedOperations: ["transfer", "approve", "permit"],
      },
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        chainId: number;
        walletMode: string;
        agentAddress: string;
        policy: typeof expectedPolicy;
      };
      const walletConfig = buildDefaultWalletConfig({
        chainId: requestBody.chainId,
        agentAddress: requestBody.agentAddress,
        backendAddress: "0x1111111111111111111111111111111111111111",
      });

      return {
        ok: true,
        json: async () => ({
          walletMode: PROJECT_WALLET_MODE,
          walletId: "wal_123",
          status: "created",
          agentAddress: requestBody.agentAddress,
          backendAddress: "0x1111111111111111111111111111111111111111",
          walletConfig,
          policy: requestBody.policy,
          deployment: {
            status: "undeployed",
          },
          provisioningUrl:
            "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
          expiresAt: "2026-03-30T12:00:00.000Z",
          nextSteps: {
            recommendedPollIntervalMs: 5000,
            walletAddressStatus: "owner_bound",
            humanActionUrl:
              "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
            humanAction:
              "Ask the human to open the provisioning URL and create the passkey owner for the Conduit Wallet.",
            walletAddressCommand:
              "conduit-wallet status wal_123 --backend-url http://127.0.0.1:3000",
            statusCommand:
              "conduit-wallet status wal_123 --backend-url http://127.0.0.1:3000",
            awaitCommand:
              "conduit-wallet await wal_123 --backend-url http://127.0.0.1:3000",
            guidance: [
              "Ask the human to open the provisioning URL and create the Conduit Wallet passkey owner.",
              "Wait for the wallet address to appear once the owner is bound.",
              "Fund the wallet on the target chain.",
              "Continue waiting until the request reaches ready.",
            ],
          },
        }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCreate({
      chainId: "84532",
      backendUrl: "http://127.0.0.1:3000",
      allowCall: [
        "0x2222222222222222222222222222222222222222:transfer(address,uint256),0x095ea7b3",
      ],
      usdcPeriod: "daily",
      usdcMax: "125",
      usdcAllow: "transfer,approve,permit",
    });

    expect(result.walletId).toBe("wal_123");
    expect(result.agentAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.localStatePath.endsWith("wal_123.json")).toBe(true);
    expect(result.walletConfig.regularValidator.threshold).toBe(2);

    const persistedRequest = await readLocalWalletRequest("wal_123");
    expect(persistedRequest.walletMode).toBe(PROJECT_WALLET_MODE);
    expect(persistedRequest.agentAddress).toBe(result.agentAddress);
    expect(persistedRequest.backendAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(persistedRequest.deployment.status).toBe("undeployed");
    expect(persistedRequest.policy).toEqual(expectedPolicy);

    const [createUrl, createInit] = fetchMock.mock.calls[0] ?? [];
    expect(createUrl).toBe("http://127.0.0.1:3000/v1/wallets");
    expect(JSON.parse(String((createInit as RequestInit | undefined)?.body))).toMatchObject({
      walletMode: PROJECT_WALLET_MODE,
      chainId: 84532,
      agentAddress: result.agentAddress,
      policy: expectedPolicy,
    });
  });

  it("rejects create when the USDC policy is only partially configured", async () => {
    await expect(
      executeCreate({
        chainId: "84532",
        backendUrl: "http://127.0.0.1:3000",
        usdcPeriod: "daily",
        usdcMax: "10",
      }),
    ).rejects.toThrow(/usdc.*all three/i);
  });

  it("rejects create when official USDC is placed in the generic allowlist", async () => {
    const supportedChain = getSupportedChainById(84532);

    expect(supportedChain).toBeTruthy();

    await expect(
      executeCreate({
        chainId: "84532",
        backendUrl: "http://127.0.0.1:3000",
        allowCall: [`${supportedChain!.officialUsdcAddress}:0xa9059cbb`],
      }),
    ).rejects.toThrow(/official usdc/i);
  });

  it("reads wallet status from the backend API", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletMode: PROJECT_WALLET_MODE,
          walletId: "wal_123",
          status: "created",
          walletConfig,
          agentAddress: walletConfig.regularValidator.signers[0]?.address,
          backendAddress: walletConfig.regularValidator.signers[1]?.address,
          policy: createRuntimePolicy(),
          funding: {
            status: "unverified",
            minimumRequiredWei: "500000000000000",
          },
          deployment: {
            status: "undeployed",
          },
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:00:00.000Z",
          expiresAt: "2026-03-30T12:00:00.000Z",
        }),
      }),
    );

    const result = await executeStatus({
      walletId: "wal_123",
      backendUrl: "http://127.0.0.1:3000",
    });

    expect(result.walletId).toBe("wal_123");
    expect(result.status).toBe("created");
    expect(result.walletMode).toBe(PROJECT_WALLET_MODE);
  });

  it("waits until the backend returns a ready weighted wallet and persists the wallet address", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    await saveLocalWalletRequest({
      walletMode: PROJECT_WALLET_MODE,
      walletId: "wal_123",
      backendBaseUrl: "http://127.0.0.1:3000",
      provisioningUrl:
        "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      chainId: 84532,
      walletConfig,
      policy: createRuntimePolicy(),
      agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
      agentPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
      createdAt: "2026-03-29T12:00:00.000Z",
      lastKnownStatus: "created",
      deployment: {
        status: "undeployed",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            walletMode: PROJECT_WALLET_MODE,
            walletId: "wal_123",
            status: "ready",
            walletConfig,
            policy: createRuntimePolicy(),
            agentAddress: walletConfig.regularValidator.signers[0]?.address,
            backendAddress: walletConfig.regularValidator.signers[1]?.address,
            counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
            ownerPublicArtifacts: {
              credentialId: "credential-id",
              publicKey: "0x1234",
            },
            funding: {
              status: "verified",
              minimumRequiredWei: "500000000000000",
              balanceWei: "700000000000000",
              checkedAt: "2026-03-29T12:05:00.000Z",
            },
            deployment: {
              status: "undeployed",
            },
            walletContext: {
              walletAddress: "0x2222222222222222222222222222222222222222",
              chainId: 84532,
              kernelVersion: "3.1",
              entryPointVersion: "0.7",
              owner: {
                credentialId: "credential-id",
                publicKey: "0x1234",
              },
              agentAddress: walletConfig.regularValidator.signers[0]?.address,
              backendAddress: walletConfig.regularValidator.signers[1]?.address,
              weightedValidator: walletConfig.regularValidator,
            },
            createdAt: "2026-03-29T12:00:00.000Z",
            updatedAt: "2026-03-29T12:05:00.000Z",
            expiresAt: "2026-03-30T12:00:00.000Z",
          }),
        }),
    );
    vi.mocked(hydrateReadyWalletRequest).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
    });

    const result = await executeAwait({
      walletId: "wal_123",
      intervalMs: 1,
      backendUrl: "http://127.0.0.1:3000",
    });

    const persistedRequest = await readLocalWalletRequest("wal_123");
    expect(vi.mocked(hydrateReadyWalletRequest)).toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "ready",
      localStatePath: expect.stringContaining("wal_123.json"),
    });
    expect(persistedRequest.walletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(persistedRequest.lastKnownStatus).toBe("ready");
    expect(persistedRequest.deployment.status).toBe("undeployed");
  });

  it("executes a transaction from a ready local wallet", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    await saveLocalWalletRequest({
      walletMode: PROJECT_WALLET_MODE,
      walletId: "wal_123",
      backendBaseUrl: "http://127.0.0.1:3000",
      provisioningUrl:
        "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      chainId: 84532,
      walletConfig,
      policy: createRuntimePolicy(),
      agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
      agentPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
      walletAddress: "0x2222222222222222222222222222222222222222",
      createdAt: "2026-03-29T12:00:00.000Z",
      lastKnownStatus: "ready",
      deployment: {
        status: "undeployed",
      },
    });
    vi.mocked(callReadyWalletTransaction).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      transactionHash: "0xtransactionhash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletMode: PROJECT_WALLET_MODE,
          walletId: "wal_123",
          status: "ready",
          walletConfig,
          policy: createRuntimePolicy(),
          agentAddress: walletConfig.regularValidator.signers[0]?.address,
          backendAddress: walletConfig.regularValidator.signers[1]?.address,
          ownerPublicArtifacts: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          regularValidatorInitArtifact: {
            validatorAddress: "0x3333333333333333333333333333333333333333",
            enableData: "0x1234",
            pluginEnableSignature: "0x5678",
          },
          counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
          funding: {
            status: "verified",
            minimumRequiredWei: "500000000000000",
            balanceWei: "700000000000000",
            checkedAt: "2026-03-29T12:05:00.000Z",
          },
          deployment: {
            status: "deployed",
          },
          walletContext: {
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 84532,
            kernelVersion: "3.1",
            entryPointVersion: "0.7",
            owner: {
              credentialId: "credential-id",
              publicKey: "0x1234",
            },
            agentAddress: walletConfig.regularValidator.signers[0]?.address,
            backendAddress: walletConfig.regularValidator.signers[1]?.address,
            weightedValidator: walletConfig.regularValidator,
          },
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:05:00.000Z",
          expiresAt: "2026-03-30T12:00:00.000Z",
        }),
      }),
    );

    const result = await executeCall({
      walletId: "wal_123",
      to: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      valueWei: "0",
    });

    expect(vi.mocked(callReadyWalletTransaction)).toHaveBeenCalled();
    expect(result).toEqual({
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      targetContract: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      valueWei: "0",
      transactionHash: "0xtransactionhash",
    });
    const persistedRequest = await readLocalWalletRequest("wal_123");
    expect(persistedRequest.deployment.status).toBe("deployed");
  });

  it("signs generic typed data and covers the USDC transferWithAuthorization shape", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    await saveLocalWalletRequest({
      walletMode: PROJECT_WALLET_MODE,
      walletId: "wal_123",
      backendBaseUrl: "http://127.0.0.1:3000",
      provisioningUrl:
        "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      chainId: 84532,
      walletConfig,
      policy: createRuntimePolicy(),
      agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
      agentPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
      walletAddress: "0x2222222222222222222222222222222222222222",
      createdAt: "2026-03-29T12:00:00.000Z",
      lastKnownStatus: "ready",
      deployment: {
        status: "undeployed",
      },
    });
    vi.mocked(ensureReadyWalletDeployed).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      deployed: true,
      deployedByThisCall: true,
      transactionHash: "0xdeploymenthash",
    });
    vi.mocked(signReadyWalletTypedData).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      signature: "0xsignedtypeddata",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletMode: PROJECT_WALLET_MODE,
          walletId: "wal_123",
          status: "ready",
          walletConfig,
          policy: createRuntimePolicy(),
          agentAddress: walletConfig.regularValidator.signers[0]?.address,
          backendAddress: walletConfig.regularValidator.signers[1]?.address,
          ownerPublicArtifacts: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          regularValidatorInitArtifact: {
            validatorAddress: "0x3333333333333333333333333333333333333333",
            enableData: "0x1234",
            pluginEnableSignature: "0x5678",
          },
          counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
          funding: {
            status: "verified",
            minimumRequiredWei: "500000000000000",
            balanceWei: "700000000000000",
            checkedAt: "2026-03-29T12:05:00.000Z",
          },
          deployment: {
            status: "deployed",
          },
          walletContext: {
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 84532,
            kernelVersion: "3.1",
            entryPointVersion: "0.7",
            owner: {
              credentialId: "credential-id",
              publicKey: "0x1234",
            },
            agentAddress: walletConfig.regularValidator.signers[0]?.address,
            backendAddress: walletConfig.regularValidator.signers[1]?.address,
            weightedValidator: walletConfig.regularValidator,
          },
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:05:00.000Z",
          expiresAt: "2026-03-30T12:00:00.000Z",
        }),
      }),
    );

    const typedData = buildOfficialUsdcTransferWithAuthorizationTypedData({
      chainId: 84532,
      from: "0x2222222222222222222222222222222222222222",
      to: "0x1111111111111111111111111111111111111111",
      amountUsdc: "1.25",
      validAfter: "0",
      validBefore: "1893456000",
      nonce:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const result = await executeSignTypedData({
      walletId: "wal_123",
      typedDataJson: JSON.stringify(typedData),
    });

    expect(vi.mocked(signReadyWalletTypedData)).toHaveBeenCalledWith({
      localRequest: expect.objectContaining({
        walletId: "wal_123",
        deployment: {
          status: "deployed",
        },
      }),
      typedData: {
        domain: {
          name: "USDC",
          version: "2",
          chainId: 84532,
          verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        },
        primaryType: "TransferWithAuthorization",
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        message: {
          from: "0x2222222222222222222222222222222222222222",
          to: "0x1111111111111111111111111111111111111111",
          value: "1250000",
          validAfter: "0",
          validBefore: "1893456000",
          nonce:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    });
    expect(result).toEqual({
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      typedData,
      signature: "0xsignedtypeddata",
    });
    const persistedRequest = await readLocalWalletRequest("wal_123");
    expect(persistedRequest.deployment.status).toBe("deployed");
  });

  it("resyncs local owner_bound state before signing typed data when the backend is already ready", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    await saveLocalWalletRequest({
      walletMode: PROJECT_WALLET_MODE,
      walletId: "wal_123",
      backendBaseUrl: "http://127.0.0.1:3000",
      provisioningUrl:
        "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      chainId: 84532,
      walletConfig,
      policy: createRuntimePolicy(),
      agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
      agentPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
      walletAddress: "0x2222222222222222222222222222222222222222",
      ownerPublicArtifacts: {
        credentialId: "credential-id",
        publicKey: "0x1234",
      },
      regularValidatorInitArtifact: {
        validatorAddress: "0x3333333333333333333333333333333333333333",
        enableData: "0x1234",
        pluginEnableSignature: "0x5678",
      },
      createdAt: "2026-03-29T12:00:00.000Z",
      lastKnownStatus: "owner_bound",
      deployment: {
        status: "deployed",
      },
    });
    vi.mocked(ensureReadyWalletDeployed).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      deployed: true,
      deployedByThisCall: false,
    });
    vi.mocked(signReadyWalletTypedData).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      signature: "0xsignedtypeddata",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletMode: PROJECT_WALLET_MODE,
          walletId: "wal_123",
          status: "ready",
          walletConfig,
          policy: createRuntimePolicy(),
          agentAddress: walletConfig.regularValidator.signers[0]?.address,
          backendAddress: walletConfig.regularValidator.signers[1]?.address,
          ownerPublicArtifacts: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          regularValidatorInitArtifact: {
            validatorAddress: "0x3333333333333333333333333333333333333333",
            enableData: "0x1234",
            pluginEnableSignature: "0x5678",
          },
          counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
          funding: {
            status: "verified",
            minimumRequiredWei: "500000000000000",
            balanceWei: "700000000000000",
            checkedAt: "2026-03-29T12:05:00.000Z",
          },
          deployment: {
            status: "deployed",
          },
          walletContext: {
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 84532,
            kernelVersion: "3.1",
            entryPointVersion: "0.7",
            owner: {
              credentialId: "credential-id",
              publicKey: "0x1234",
            },
            agentAddress: walletConfig.regularValidator.signers[0]?.address,
            backendAddress: walletConfig.regularValidator.signers[1]?.address,
            weightedValidator: walletConfig.regularValidator,
          },
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:05:00.000Z",
          expiresAt: "2026-03-30T12:00:00.000Z",
        }),
      }),
    );

    const typedData = buildOfficialUsdcTransferWithAuthorizationTypedData({
      chainId: 84532,
      from: "0x2222222222222222222222222222222222222222",
      to: "0x1111111111111111111111111111111111111111",
      amountUsdc: "1.25",
      validAfter: "0",
      validBefore: "1893456000",
      nonce:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const result = await executeSignTypedData({
      walletId: "wal_123",
      typedDataJson: JSON.stringify(typedData),
    });

    expect(vi.mocked(ensureReadyWalletDeployed)).toHaveBeenCalledWith({
      localRequest: expect.objectContaining({
        walletId: "wal_123",
        lastKnownStatus: "ready",
      }),
    });
    expect(vi.mocked(signReadyWalletTypedData)).toHaveBeenCalledWith({
      localRequest: expect.objectContaining({
        walletId: "wal_123",
        lastKnownStatus: "ready",
      }),
      typedData: expect.objectContaining({
        primaryType: "TransferWithAuthorization",
      }),
    });
    const persistedRequest = await readLocalWalletRequest("wal_123");
    expect(persistedRequest.lastKnownStatus).toBe("ready");
    expect(result).toEqual({
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      typedData,
      signature: "0xsignedtypeddata",
    });
  });

  it("builds a spec-aligned x402 PAYMENT-SIGNATURE header through the deployed smart wallet signer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T12:00:00.000Z"));

    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    await saveLocalWalletRequest({
      walletMode: PROJECT_WALLET_MODE,
      walletId: "wal_123",
      backendBaseUrl: "http://127.0.0.1:3000",
      provisioningUrl:
        "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      chainId: 84532,
      walletConfig,
      policy: createRuntimePolicy(),
      agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
      agentPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
      walletAddress: "0x2222222222222222222222222222222222222222",
      createdAt: "2026-03-29T12:00:00.000Z",
      lastKnownStatus: "ready",
      deployment: {
        status: "undeployed",
      },
    });
    vi.mocked(ensureReadyWalletDeployed).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      deployed: true,
      deployedByThisCall: true,
      transactionHash: "0xdeploymenthash",
    });
    vi.mocked(signReadyWalletTypedData).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      signature: `0x${"ab".repeat(96)}`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletMode: PROJECT_WALLET_MODE,
          walletId: "wal_123",
          status: "ready",
          walletConfig,
          policy: createRuntimePolicy(),
          agentAddress: walletConfig.regularValidator.signers[0]?.address,
          backendAddress: walletConfig.regularValidator.signers[1]?.address,
          ownerPublicArtifacts: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          regularValidatorInitArtifact: {
            validatorAddress: "0x3333333333333333333333333333333333333333",
            enableData: "0x1234",
            pluginEnableSignature: "0x5678",
          },
          counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
          funding: {
            status: "verified",
            minimumRequiredWei: "500000000000000",
            balanceWei: "700000000000000",
            checkedAt: "2026-03-29T12:05:00.000Z",
          },
          deployment: {
            status: "deployed",
          },
          walletContext: {
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 84532,
            kernelVersion: "3.1",
            entryPointVersion: "0.7",
            owner: {
              credentialId: "credential-id",
              publicKey: "0x1234",
            },
            agentAddress: walletConfig.regularValidator.signers[0]?.address,
            backendAddress: walletConfig.regularValidator.signers[1]?.address,
            weightedValidator: walletConfig.regularValidator,
          },
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:05:00.000Z",
          expiresAt: "2026-03-30T12:00:00.000Z",
        }),
      }),
    );

    const paymentRequiredHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: "PAYMENT-SIGNATURE header is required",
        resource: {
          url: "http://127.0.0.1:4010/premium-data",
          description: "Premium test payload",
          mimeType: "application/json",
        },
        accepts: [
          {
            scheme: "exact",
            network: "eip155:84532",
            amount: "250000",
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            payTo: "0x3333333333333333333333333333333333333333",
            maxTimeoutSeconds: 60,
            extra: {
              assetTransferMethod: "eip3009",
              name: "USDC",
              version: "2",
            },
          },
        ],
      }),
      "utf8",
    ).toString("base64");

    const result = await executeX402Sign({
      walletId: "wal_123",
      paymentRequiredHeader,
    });
    const decodedPayload = x402PaymentPayloadSchema.parse(
      JSON.parse(Buffer.from(result.paymentSignatureHeader, "base64").toString("utf8")),
    );

    expect(result.walletId).toBe("wal_123");
    expect(result.walletAddress).toBe("0x2222222222222222222222222222222222222222");
    expect(result.payerAddress).toBe("0x2222222222222222222222222222222222222222");
    expect(decodedPayload.accepted.amount).toBe("250000");
    expect(decodedPayload.accepted.payTo).toBe("0x3333333333333333333333333333333333333333");
    expect(decodedPayload.payload.authorization.from).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(decodedPayload.payload.authorization.validAfter).toBe("1774871995");
    expect(decodedPayload.payload.authorization.validBefore).toBe("1774872060");
    expect(vi.mocked(ensureReadyWalletDeployed)).toHaveBeenCalledWith({
      localRequest: expect.objectContaining({
        walletId: "wal_123",
      }),
    });
    expect(vi.mocked(signReadyWalletTypedData)).toHaveBeenCalledWith({
      localRequest: expect.objectContaining({
        walletId: "wal_123",
        walletAddress: "0x2222222222222222222222222222222222222222",
        deployment: {
          status: "deployed",
        },
      }),
      typedData: expect.objectContaining({
        primaryType: "TransferWithAuthorization",
        message: expect.objectContaining({
          from: "0x2222222222222222222222222222222222222222",
          to: "0x3333333333333333333333333333333333333333",
          value: "250000",
        }),
      }),
    });
    expect(decodedPayload.payload.signature).toBe(`0x${"ab".repeat(96)}`);
  });

  it("fetches an unprotected resource without attempting x402 payment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, resource: "public" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const x402Signer = vi.fn();

    const result = await executeX402Fetch(
      {
        walletId: "wal_123",
        url: "http://127.0.0.1:4010/public",
      },
      {
        fetchImpl: fetchMock,
        x402Signer: x402Signer as never,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(x402Signer).not.toHaveBeenCalled();
    expect(result).toEqual({
      walletId: "wal_123",
      url: "http://127.0.0.1:4010/public",
      status: 200,
      ok: true,
      x402Paid: false,
      contentType: "application/json",
      body: {
        ok: true,
        resource: "public",
      },
    });
  });

  it("fetches a protected resource and retries with PAYMENT-SIGNATURE", async () => {
    const paymentRequired = {
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: {
        url: "http://127.0.0.1:4010/premium",
        description: "Premium payload",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          amount: "250000",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          payTo: "0x3333333333333333333333333333333333333333",
          maxTimeoutSeconds: 60,
          extra: {
            assetTransferMethod: "eip3009",
            name: "USDC",
            version: "2",
          },
        },
      ],
    };
    const settlementResponse = {
      success: true,
      transaction: `0x${"11".repeat(32)}`,
      network: "eip155:84532",
      payer: "0x2222222222222222222222222222222222222222",
      amount: "250000",
    };
    const paymentRequiredHeader = Buffer.from(
      JSON.stringify(paymentRequired),
      "utf8",
    ).toString("base64");
    const paymentResponseHeader = Buffer.from(
      JSON.stringify(settlementResponse),
      "utf8",
    ).toString("base64");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "PAYMENT-SIGNATURE header is required",
          }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "payment-required": paymentRequiredHeader,
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            resource: "premium",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "payment-response": paymentResponseHeader,
            },
          },
        ),
      );
    const x402Signer = vi.fn().mockResolvedValue({
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      payerAddress: "0x2222222222222222222222222222222222222222",
      paymentRequired,
      paymentPayload: {
        x402Version: 2,
      },
      paymentSignatureHeader: "signed-header",
    });

    const result = await executeX402Fetch(
      {
        walletId: "wal_123",
        url: "http://127.0.0.1:4010/premium",
      },
      {
        fetchImpl: fetchMock,
        x402Signer: x402Signer as never,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:4010/premium",
      {
        method: "GET",
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4010/premium",
      {
        method: "GET",
        headers: {
          "PAYMENT-SIGNATURE": "signed-header",
        },
      },
    );
    expect(x402Signer).toHaveBeenCalledWith({
      walletId: "wal_123",
      paymentRequiredHeader,
    });
    expect(result).toEqual({
      walletId: "wal_123",
      url: "http://127.0.0.1:4010/premium",
      status: 200,
      ok: true,
      x402Paid: true,
      walletAddress: "0x2222222222222222222222222222222222222222",
      contentType: "application/json",
      paymentRequired,
      paymentResponse: settlementResponse,
      body: {
        ok: true,
        resource: "premium",
      },
    });
  });
});
