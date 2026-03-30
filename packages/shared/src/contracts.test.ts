import { describe, expect, it } from "vitest";
import {
  PROJECT_PASSKEY_VALIDATOR_ADDRESS,
  PROJECT_WALLET_MODE,
  backendSignMessageRequestSchema,
  buildDefaultWalletConfig,
  createWalletRequestInputSchema,
  getBackendSignerAuthorizationTypedData,
  getCanonicalWeightedSignerOrder,
  hashBackendSignerPayload,
  localWalletRequestSchema,
} from "./contracts.js";

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
    });

    expect(parsed.walletMode).toBe(PROJECT_WALLET_MODE);
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

  it("hashes backend signer payloads deterministically and exposes the auth typed data", () => {
    const payload = {
      message: {
        kind: "raw" as const,
        raw: "0x1234",
      },
    };

    const bodyHash = hashBackendSignerPayload("sign_message", payload);
    const authTypedData = getBackendSignerAuthorizationTypedData({
      walletAddress: "0x00000000000000000000000000000000000000aa",
      backendSignerAddress: "0x00000000000000000000000000000000000000bb",
      method: "sign_message",
      bodyHash,
      requestId: "req_123",
      expiresAt: "2026-03-29T10:00:00.000Z",
    });

    expect(bodyHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(authTypedData.primaryType).toBe("BackendSignerAuthorization");
    expect(authTypedData.types.BackendSignerAuthorization).toHaveLength(6);
    expect(
      backendSignMessageRequestSchema.parse({
        auth: {
          ...authTypedData.message,
          agentSignature: "0x1234",
        },
        payload,
      }),
    ).toBeTruthy();
  });

  it("accepts empty calldata hex strings for plain value transfers", () => {
    expect(() =>
      backendSignMessageRequestSchema.parse({
        auth: {
          walletAddress: "0x00000000000000000000000000000000000000aa",
          backendSignerAddress: "0x00000000000000000000000000000000000000bb",
          method: "sign_message",
          bodyHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          requestId: "req_123",
          expiresAt: "2026-03-29T10:00:00.000Z",
          agentSignature: "0x1234",
        },
        payload: {
          message: {
            kind: "raw",
            raw: "0x",
          },
        },
      }),
    ).not.toThrow();
  });
});
