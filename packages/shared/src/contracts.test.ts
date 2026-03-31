import { describe, expect, it } from "vitest";
import {
  PROJECT_PASSKEY_VALIDATOR_ADDRESS,
  PROJECT_WALLET_MODE,
  backendDeployWalletRequestSchema,
  backendSignTypedDataRequestSchema,
  buildDefaultWalletConfig,
  createWalletRequestInputSchema,
  getBackendSignerAuthorizationTypedData,
  getCanonicalWeightedSignerOrder,
  hashBackendSignerRequestBody,
  localWalletRequestSchema,
  walletPolicySchema,
} from "./contracts.js";
import { getSupportedChainById } from "./chains.js";

describe("mode B wallet contracts", () => {
  it("builds the default kernel weighted multisig wallet config", () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x00000000000000000000000000000000000000aa",
      backendAddress: "0x00000000000000000000000000000000000000bb",
    });

    expect(walletConfig.walletMode).toBe(PROJECT_WALLET_MODE);
    expect(walletConfig.sudoValidator).toEqual({
      type: "passkey",
      address: PROJECT_PASSKEY_VALIDATOR_ADDRESS,
    });
    expect(walletConfig.regularValidator.threshold).toBe(2);
    expect(walletConfig.regularValidator.delaySeconds).toBe(0);
    expect(walletConfig.regularValidator.signers).toEqual([
      {
        role: "agent",
        address: "0x00000000000000000000000000000000000000aa",
        weight: 1,
      },
      {
        role: "backend",
        address: "0x00000000000000000000000000000000000000bb",
        weight: 1,
      },
    ]);
  });

  it("sorts weighted signers by canonical descending address order", () => {
    const ordered = getCanonicalWeightedSignerOrder([
      {
        role: "agent",
        address: "0x00000000000000000000000000000000000000aa",
        weight: 1,
      },
      {
        role: "backend",
        address: "0x00000000000000000000000000000000000000ff",
        weight: 1,
      },
    ]);

    expect(ordered.map((signer) => signer.address)).toEqual([
      "0x00000000000000000000000000000000000000ff",
      "0x00000000000000000000000000000000000000aa",
    ]);
  });

  it("validates create-wallet inputs for mode B", () => {
    const parsed = createWalletRequestInputSchema.parse({
      walletMode: PROJECT_WALLET_MODE,
      chainId: 84532,
      agentAddress: "0x00000000000000000000000000000000000000aa",
      policy: {
        contractAllowlist: [
          {
            contractAddress: "0x00000000000000000000000000000000000000cc",
            allowedSelectors: ["0xa9059cbb"],
          },
        ],
      },
    });

    expect(parsed.walletMode).toBe(PROJECT_WALLET_MODE);
  });

  it("accepts a standalone USDC policy", () => {
    const parsed = walletPolicySchema.parse({
      usdcPolicy: {
        period: "daily",
        maxAmountMinor: "1000000",
        allowedOperations: ["transfer", "approve", "permit"],
      },
    });

    expect(parsed.usdcPolicy?.period).toBe("daily");
    expect(parsed.usdcPolicy?.allowedOperations).toEqual([
      "transfer",
      "approve",
      "permit",
    ]);
  });

  it("rejects wallet creation when no policy mechanism is configured", () => {
    expect(() =>
      createWalletRequestInputSchema.parse({
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: "0x00000000000000000000000000000000000000aa",
        policy: {},
      }),
    ).toThrow(/at least one policy mechanism/i);
  });

  it("rejects wallet creation when official USDC appears in the generic allowlist", () => {
    const supportedChain = getSupportedChainById(84532);

    expect(supportedChain).toBeTruthy();

    expect(() =>
      createWalletRequestInputSchema.parse({
        walletMode: PROJECT_WALLET_MODE,
        chainId: 84532,
        agentAddress: "0x00000000000000000000000000000000000000aa",
        policy: {
          contractAllowlist: [
            {
              contractAddress: supportedChain!.officialUsdcAddress,
              allowedSelectors: ["0xa9059cbb"],
            },
          ],
        },
      }),
    ).toThrow(/official usdc/i);
  });

  it("rejects unsupported USDC operation names", () => {
    expect(() =>
      walletPolicySchema.parse({
        usdcPolicy: {
          period: "daily",
          maxAmountMinor: "1000000",
          allowedOperations: ["transferFrom"],
        },
      }),
    ).toThrow(/invalid enum value|invalid option/i);
  });

  it("rejects local wallet state when signer addresses drift from walletConfig", () => {
    expect(() =>
      localWalletRequestSchema.parse({
        walletMode: PROJECT_WALLET_MODE,
        walletId: "wal_123",
        backendBaseUrl: "http://127.0.0.1:3000",
        provisioningUrl: "http://127.0.0.1:5173/?walletId=wal_123",
        chainId: 84532,
        walletConfig: buildDefaultWalletConfig({
          chainId: 84532,
          agentAddress: "0x00000000000000000000000000000000000000aa",
          backendAddress: "0x00000000000000000000000000000000000000bb",
        }),
        policy: {
          contractAllowlist: [
            {
              contractAddress: "0x00000000000000000000000000000000000000cc",
              allowedSelectors: ["0xa9059cbb"],
            },
          ],
        },
        agentAddress: "0x00000000000000000000000000000000000000cc",
        agentPrivateKey:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        backendAddress: "0x00000000000000000000000000000000000000bb",
        createdAt: new Date().toISOString(),
        lastKnownStatus: "created",
        deployment: {
          status: "undeployed",
        },
      }),
    ).toThrow(/agentAddress must match/i);
  });

  it("hashes backend signer request bodies deterministically and exposes the auth typed data", () => {
    const body = {
      typedData: {
        domain: {
          name: "USDC",
          version: "2",
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: "0x00000000000000000000000000000000000000aa",
          spender: "0x00000000000000000000000000000000000000bb",
          value: "10",
          nonce: "0",
          deadline: "1",
        },
      },
      signaturePayload: {
        kind: "kernel_wrapped_typed_data" as const,
        typedData: {
          domain: {
            name: "Kernel",
            version: "0.3.1",
            chainId: 84532,
            verifyingContract: "0x00000000000000000000000000000000000000aa",
          },
          types: {
            Kernel: [{ name: "hash", type: "bytes32" }],
          },
          primaryType: "Kernel",
          message: {
            hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
        },
      },
    };

    const bodyHash = hashBackendSignerRequestBody("sign_typed_data_v1", body);
    const authTypedData = getBackendSignerAuthorizationTypedData({
      walletAddress: "0x00000000000000000000000000000000000000aa",
      backendSignerAddress: "0x00000000000000000000000000000000000000bb",
      method: "sign_typed_data_v1",
      bodyHash,
      requestId: "req_123",
      expiresAt: "2026-03-29T10:00:00.000Z",
    });

    expect(bodyHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(authTypedData.primaryType).toBe("BackendSignerAuthorization");
    expect(authTypedData.types.BackendSignerAuthorization).toHaveLength(6);
    expect(
      backendSignTypedDataRequestSchema.parse({
        auth: {
          ...authTypedData.message,
          agentSignature: "0x1234",
        },
        typedData: body.typedData,
        signaturePayload: body.signaturePayload,
      }),
    ).toBeTruthy();
  });

  it("accepts deploy-wallet requests with empty bytes payloads", () => {
    expect(() =>
      backendDeployWalletRequestSchema.parse({
        auth: {
          walletAddress: "0x00000000000000000000000000000000000000aa",
          backendSignerAddress: "0x00000000000000000000000000000000000000bb",
          method: "deploy_wallet_v1",
          bodyHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          requestId: "req_123",
          expiresAt: "2026-03-29T10:00:00.000Z",
          agentSignature: "0x1234",
        },
        userOperation: {
          sender: "0x00000000000000000000000000000000000000aa",
          nonce: "0",
          initCode: "0x1234",
          callData: "0x",
          accountGasLimits:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          preVerificationGas: "1",
          gasFees:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          paymasterAndData: "0x",
        },
        signaturePayload: {
          kind: "user_operation_hash",
          message: {
            kind: "raw" as const,
            raw: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
        },
      }),
    ).not.toThrow();
  });
});
