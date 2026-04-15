import { describe, expect, it, vi } from "vitest";
import {
  GUARDRAIL_WALLET_MODE,
  buildDefaultWalletConfig,
  type LocalWalletRequest,
  type WalletRequest,
} from "@guardlabs/guardrail-core";
import { createWeightedKernelRuntime } from "@guardlabs/guardrail-kernel";
import { validateProvisioningArtifacts } from "@guardlabs/guardrail-kernel/validation";
import {
  callReadyWalletTransaction,
  ensureReadyWalletDeployed,
  hydrateReadyWalletRequest,
  signReadyWalletTypedData,
} from "./kernel.js";

vi.mock("@guardlabs/guardrail-kernel", () => ({
  createWeightedKernelRuntime: vi.fn(),
}));

vi.mock("@guardlabs/guardrail-kernel/validation", () => ({
  validateProvisioningArtifacts: vi.fn(() => ({
    ok: true,
  })),
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

function createMockBackendRemoteSigner() {
  return {
    beginUserOperationSigning: vi.fn(),
    beginDeployWalletSigning: vi.fn(),
    beginTypedDataSigning: vi.fn(),
    attachPreparedUserOperation: vi.fn(),
    clearSigningContext: vi.fn(),
  };
}

function buildLocalWalletRequest(
  overrides: Partial<LocalWalletRequest> = {},
): LocalWalletRequest {
  const walletConfig = buildDefaultWalletConfig({
    chainId: 84532,
    agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
    backendAddress: "0x1111111111111111111111111111111111111111",
  });

  return {
    walletMode: GUARDRAIL_WALLET_MODE,
    walletId: "wal_123",
    backendBaseUrl: "http://127.0.0.1:3000",
    provisioningUrl: "http://127.0.0.1:5173/?walletId=wal_123",
    chainId: 84532,
    walletConfig,
    policy: createRuntimePolicy(),
    agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
    agentPrivateKey:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    backendAddress: "0x1111111111111111111111111111111111111111",
    regularValidatorInitArtifact: {
      validatorAddress: "0x3333333333333333333333333333333333333333",
      enableData: "0x1234",
      pluginEnableSignature: "0x5678",
    },
    createdAt: "2026-03-29T12:00:00.000Z",
    lastKnownStatus: "created",
    deployment: {
      status: "undeployed",
    },
    ...overrides,
  };
}

function buildReadyWalletRequest(
  overrides: Partial<WalletRequest> = {},
): WalletRequest {
  const walletConfig = buildDefaultWalletConfig({
    chainId: 84532,
    agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
    backendAddress: "0x1111111111111111111111111111111111111111",
  });

  return {
    walletMode: GUARDRAIL_WALLET_MODE,
    walletId: "wal_123",
    status: "ready",
    walletConfig,
    policy: createRuntimePolicy(),
    agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
    backendAddress: "0x1111111111111111111111111111111111111111",
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
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
      weightedValidator: walletConfig.regularValidator,
    },
    createdAt: "2026-03-29T12:00:00.000Z",
    updatedAt: "2026-03-29T12:05:00.000Z",
    expiresAt: "2026-03-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("kernel runtime mode B", () => {
  it("hydrates a ready weighted wallet runtime from local state", async () => {
    vi.mocked(createWeightedKernelRuntime).mockResolvedValue({
      kernelAccount: {
        address: "0x2222222222222222222222222222222222222222",
      },
      backendRemoteSigner: createMockBackendRemoteSigner(),
      kernelClient: {
        sendTransaction: vi.fn(),
      },
      publicClient: {},
    } as never);

    const result = await hydrateReadyWalletRequest({
      walletRequest: buildReadyWalletRequest(),
      localRequest: buildLocalWalletRequest({
        walletAddress: "0x2222222222222222222222222222222222222222",
      }),
    });

    expect(createWeightedKernelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wal_123",
        walletAddress: "0x2222222222222222222222222222222222222222",
        backendBaseUrl: "http://127.0.0.1:3000",
        ownerPublicArtifacts: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        regularValidatorInitArtifact: {
          validatorAddress: "0x3333333333333333333333333333333333333333",
          enableData: "0x1234",
          pluginEnableSignature: "0x5678",
        },
        rpcUrl: "http://127.0.0.1:3000/v1/chains/84532/rpc",
        bundlerUrl: "http://127.0.0.1:3000/v1/chains/84532/bundler",
      }),
    );
    expect(result.walletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("fails fast when the local backend URL is missing", async () => {
    await expect(
      hydrateReadyWalletRequest({
        walletRequest: buildReadyWalletRequest(),
        localRequest: buildLocalWalletRequest({
          backendBaseUrl: "",
          walletAddress: "0x2222222222222222222222222222222222222222",
        }),
      }),
    ).rejects.toThrow(/backend url/i);
  });

  it("sends a transaction through the weighted runtime client", async () => {
    const sendTransaction = vi.fn(async () => "0xtransactionhash" as const);
    const backendRemoteSigner = createMockBackendRemoteSigner();
    vi.mocked(createWeightedKernelRuntime).mockResolvedValue({
      kernelAccount: {
        address: "0x2222222222222222222222222222222222222222",
      },
      backendRemoteSigner,
      kernelClient: {
        sendTransaction,
      },
      publicClient: {},
    } as never);

    const result = await callReadyWalletTransaction({
      localRequest: buildLocalWalletRequest({
        walletAddress: "0x2222222222222222222222222222222222222222",
        lastKnownStatus: "ready",
      }),
      call: {
        to: "0x1111111111111111111111111111111111111111",
        data: "0xa9059cbb",
        valueWei: "0",
      },
    });

    expect(sendTransaction).toHaveBeenCalledWith({
      to: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      value: 0n,
    });
    expect(backendRemoteSigner.beginUserOperationSigning).toHaveBeenCalledWith({
      kind: "single_call",
      to: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      value: "0",
    });
    expect(backendRemoteSigner.clearSigningContext).toHaveBeenCalled();
    expect(result).toEqual({
      walletAddress: "0x2222222222222222222222222222222222222222",
      transactionHash: "0xtransactionhash",
    });
  });

  it("signs typed data through the weighted runtime account", async () => {
    const signTypedData = vi.fn(async () => "0xsignedtypeddata" as const);
    const backendRemoteSigner = createMockBackendRemoteSigner();
    vi.mocked(createWeightedKernelRuntime).mockResolvedValue({
      kernelAccount: {
        address: "0x2222222222222222222222222222222222222222",
        signTypedData,
      },
      backendRemoteSigner,
      kernelClient: {
        sendTransaction: vi.fn(),
      },
      publicClient: {},
    } as never);

    const result = await signReadyWalletTypedData({
      localRequest: buildLocalWalletRequest({
        walletAddress: "0x2222222222222222222222222222222222222222",
        lastKnownStatus: "ready",
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

    expect(signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryType: "TransferWithAuthorization",
      }),
    );
    expect(backendRemoteSigner.beginTypedDataSigning).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryType: "TransferWithAuthorization",
      }),
    );
    expect(backendRemoteSigner.clearSigningContext).toHaveBeenCalled();
    expect(result).toEqual({
      walletAddress: "0x2222222222222222222222222222222222222222",
      signature: "0xsignedtypeddata",
    });
  });

  it("deploys the wallet on demand before signature-only flows", async () => {
    const getCode = vi
      .fn()
      .mockResolvedValueOnce("0x")
      .mockResolvedValueOnce("0x1234");
    const waitForTransactionReceipt = vi.fn(async () => ({
      transactionHash: "0xdeploymenthash",
    }));
    const sendTransaction = vi.fn(async () => "0xdeploymenthash" as const);
    const backendRemoteSigner = createMockBackendRemoteSigner();
    vi.mocked(createWeightedKernelRuntime).mockResolvedValue({
      kernelAccount: {
        address: "0x2222222222222222222222222222222222222222",
      },
      backendRemoteSigner,
      kernelClient: {
        sendTransaction,
      },
      publicClient: {
        getCode,
        waitForTransactionReceipt,
      },
    } as never);

    const result = await ensureReadyWalletDeployed({
      localRequest: buildLocalWalletRequest({
        walletAddress: "0x2222222222222222222222222222222222222222",
        lastKnownStatus: "ready",
      }),
    });

    expect(sendTransaction).toHaveBeenCalledWith({
      to: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      data: "0x",
      value: 0n,
    });
    expect(backendRemoteSigner.beginDeployWalletSigning).toHaveBeenCalled();
    expect(backendRemoteSigner.clearSigningContext).toHaveBeenCalled();
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: "0xdeploymenthash",
    });
    expect(result).toEqual({
      walletAddress: "0x2222222222222222222222222222222222222222",
      deployed: true,
      deployedByThisCall: true,
      transactionHash: "0xdeploymenthash",
    });
  });

  it("fails fast when stored provisioning artifacts are invalid", async () => {
    vi.mocked(createWeightedKernelRuntime).mockClear();
    vi.mocked(validateProvisioningArtifacts).mockReturnValueOnce({
      ok: false,
      code: "plugin_enable_signature_invalid",
      message:
        "Stored plugin enable signature does not verify against the stored owner passkey public key.",
    });

    await expect(
      ensureReadyWalletDeployed({
        localRequest: buildLocalWalletRequest({
          walletAddress: "0x2222222222222222222222222222222222222222",
          lastKnownStatus: "ready",
          ownerPublicArtifacts: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
        }),
      }),
    ).rejects.toThrow(/stored provisioning artifacts are invalid/i);
    expect(createWeightedKernelRuntime).not.toHaveBeenCalled();
  });
});
