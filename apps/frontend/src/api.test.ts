import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_WALLET_MODE,
  buildDefaultWalletConfig,
} from "@conduit/shared";
import { browserApi } from "./api.js";

describe("frontend api mode B", () => {
  it("publishes the regular validator init artifact with owner artifacts", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        walletMode: PROJECT_WALLET_MODE,
        walletId: "wal_test",
        status: "owner_bound",
        walletConfig,
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
          status: "insufficient",
          minimumRequiredWei: "500000000000000",
          balanceWei: "0",
          checkedAt: "2026-03-29T10:00:00.000Z",
        },
        deployment: {
          status: "undeployed",
        },
        createdAt: "2026-03-29T10:00:00.000Z",
        updatedAt: "2026-03-29T10:00:00.000Z",
        expiresAt: "2026-03-30T10:00:00.000Z",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await browserApi.publishOwnerArtifacts({
      walletId: "wal_test",
      token: "token_123",
      backendUrl: "http://127.0.0.1:3000",
      owner: {
        credentialId: "credential-id",
        publicKey: "0x1234",
      },
      counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
      regularValidatorInitArtifact: {
        validatorAddress: "0x3333333333333333333333333333333333333333",
        enableData: "0x1234",
        pluginEnableSignature: "0x5678",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/provisioning/wal_test/owner-artifacts?t=token_123",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      regularValidatorInitArtifact: {
        validatorAddress: string;
        enableData: string;
        pluginEnableSignature: string;
      };
    };

    expect(body.regularValidatorInitArtifact).toEqual({
      validatorAddress: "0x3333333333333333333333333333333333333333",
      enableData: "0x1234",
      pluginEnableSignature: "0x5678",
    });
  });

  it("refreshes funding without sending an empty json content-type", async () => {
    const walletConfig = buildDefaultWalletConfig({
      chainId: 84532,
      agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
      backendAddress: "0x1111111111111111111111111111111111111111",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        walletMode: PROJECT_WALLET_MODE,
        walletId: "wal_test",
        status: "owner_bound",
        walletConfig,
        agentAddress: walletConfig.regularValidator.signers[0]?.address,
        backendAddress: walletConfig.regularValidator.signers[1]?.address,
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        funding: {
          status: "insufficient",
          minimumRequiredWei: "500000000000000",
          balanceWei: "0",
          checkedAt: "2026-03-29T10:00:00.000Z",
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
        createdAt: "2026-03-29T10:00:00.000Z",
        updatedAt: "2026-03-29T10:00:00.000Z",
        expiresAt: "2026-03-30T10:00:00.000Z",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await browserApi.refreshFunding({
      walletId: "wal_test",
      backendUrl: "http://127.0.0.1:3000",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/wallets/wal_test/refresh-funding",
      expect.objectContaining({
        method: "POST",
        headers: undefined,
      }),
    );
  });
});
