import { describe, expect, it, vi } from "vitest";
import { buildDefaultWalletConfig } from "@conduit/shared";
import { createKernelAccount, toKernelPluginManager } from "@zerodev/sdk/accounts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { hashTypedData } from "viem";
import { baseSepolia } from "viem/chains";
import { createBackendRemoteSigner } from "./backend-remote-signer.js";
import {
  createRuntimeWeightedValidator,
  createWeightedKernelRuntime,
} from "./weighted-validator.js";

vi.mock("@zerodev/sdk/accounts", async () => {
  const actual = await vi.importActual<typeof import("@zerodev/sdk/accounts")>(
    "@zerodev/sdk/accounts",
  );

  return {
    ...actual,
    createKernelAccount: vi.fn(),
    toKernelPluginManager: vi.fn(),
  };
});

vi.mock("@zerodev/sdk", async () => {
  const actual = await vi.importActual<typeof import("@zerodev/sdk")>("@zerodev/sdk");

  return {
    ...actual,
    createKernelAccountClient: vi.fn(() => ({
      sendTransaction: vi.fn(),
    })),
  };
});

describe("mode B zerodev helpers", () => {
  it("sends authenticated typed-data sign requests through the remote signer", async () => {
    const agentPrivateKey = generatePrivateKey();
    const agentSigner = privateKeyToAccount(agentPrivateKey);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        signature: "0xdeadbeef",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const remoteSigner = createBackendRemoteSigner({
      backendBaseUrl: "http://127.0.0.1:3000",
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      backendSignerAddress: "0x1111111111111111111111111111111111111111",
      agentSigner,
    });

    const originalTypedData = {
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
        owner: "0x2222222222222222222222222222222222222222",
        spender: "0x3333333333333333333333333333333333333333",
        value: "1",
        nonce: "0",
        deadline: "100",
      },
    } as const;
    remoteSigner.beginTypedDataSigning(originalTypedData as never);

    const signature = await remoteSigner.signTypedData({
      domain: {
        name: "Kernel",
        version: "0.3.1",
        chainId: 84532,
        verifyingContract: "0x2222222222222222222222222222222222222222",
      },
      primaryType: "Kernel",
      types: {
        Kernel: [{ name: "hash", type: "bytes32" }],
      },
      message: {
        hash: hashTypedData(originalTypedData as never),
      },
    } as never);

    expect(signature).toBe("0xdeadbeef");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/wallets/wal_123/backend-sign-typed-data",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      auth: {
        walletAddress: string;
        backendSignerAddress: string;
        method: string;
        requestId: string;
        expiresAt: string;
        agentSignature: string;
      };
      typedData: {
        primaryType: string;
      };
      signaturePayload: {
        kind: string;
        typedData: {
          primaryType: string;
        };
      };
    };

    expect(requestBody.typedData.primaryType).toBe("Permit");
    expect(requestBody.signaturePayload.kind).toBe("kernel_wrapped_typed_data");
    expect(requestBody.signaturePayload.typedData.primaryType).toBe("Kernel");
    expect(requestBody.auth.walletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(requestBody.auth.backendSignerAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(requestBody.auth.method).toBe("sign_typed_data_v1");
    expect(requestBody.auth.requestId).toMatch(/^req_/);
    expect(requestBody.auth.agentSignature).toMatch(/^0x[a-f0-9]+$/);
  });

  it("rejects runtime creation when the agent private key does not match walletConfig", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http("http://127.0.0.1:8545"),
    });

    await expect(
      createRuntimeWeightedValidator(client, {
        walletId: "wal_123",
        walletAddress: "0x2222222222222222222222222222222222222222",
        walletConfig,
        backendBaseUrl: "http://127.0.0.1:3000",
        agentPrivateKey:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("hydrates runtime with a static sudo validator when a regular enable artifact exists", async () => {
    const agentPrivateKey = generatePrivateKey();
    const agentSigner = privateKeyToAccount(agentPrivateKey);
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: agentSigner.address,
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http("http://127.0.0.1:8545"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: "0x14a34",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );
    const runtimeWeightedValidator = await createRuntimeWeightedValidator(client, {
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      walletConfig,
      backendBaseUrl: "http://127.0.0.1:3000",
      agentPrivateKey,
    });
    const enableData = await runtimeWeightedValidator.weightedValidator.getEnableData(
      "0x2222222222222222222222222222222222222222",
    );

    vi.mocked(toKernelPluginManager).mockResolvedValue({
      getIdentifier: vi.fn(),
    } as never);
    vi.mocked(createKernelAccount).mockResolvedValue({
      address: "0x2222222222222222222222222222222222222222",
    } as never);

    await createWeightedKernelRuntime({
      chain: baseSepolia,
      walletId: "wal_123",
      walletAddress: "0x2222222222222222222222222222222222222222",
      walletConfig,
      ownerPublicArtifacts: {
        credentialId: "credential-id",
        publicKey:
          "0x" +
          "11".repeat(32) +
          "22".repeat(32) +
          "33".repeat(32),
      },
      regularValidatorInitArtifact: {
        validatorAddress: runtimeWeightedValidator.weightedValidator.address,
        enableData,
        pluginEnableSignature: "0x5678",
      },
      backendBaseUrl: "http://127.0.0.1:3000",
      agentPrivateKey,
      rpcUrl: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:3001",
    });

    expect(vi.mocked(toKernelPluginManager)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pluginEnableSignature: "0x5678",
        regular: expect.objectContaining({
          address: runtimeWeightedValidator.weightedValidator.address,
        }),
        sudo: expect.objectContaining({
          address: walletConfig.sudoValidator.address,
        }),
      }),
    );
    expect(vi.mocked(createKernelAccount)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        plugins: expect.objectContaining({
          getIdentifier: expect.any(Function),
        }),
      }),
    );
  });
});
