import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_WALLET_MODE,
  buildDefaultWalletConfig,
  type ResolveProvisioningResponse,
  type WalletRequest,
} from "@conduit/shared";
import { createHeadlessWebAuthnKey } from "../fixtures/headless-owner.js";
import { publishHeadlessOwnerArtifacts } from "./provision-headless.js";

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

function buildProvisioningResponse(): ResolveProvisioningResponse {
  const walletConfig = buildDefaultWalletConfig({
    chainId: 84532,
    agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
    backendAddress: "0x1111111111111111111111111111111111111111",
  });

  return {
    walletMode: PROJECT_WALLET_MODE,
    walletId: "wal_test",
    status: "created",
    walletConfig,
    policy: createRuntimePolicy(),
    agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
    backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
    counterfactualWalletAddress: null,
    ownerPublicArtifacts: undefined,
    regularValidatorInitArtifact: undefined,
    funding: {
      status: "unverified",
      minimumRequiredWei: "500000000000000",
    },
    deployment: {
      status: "undeployed",
    },
    expiresAt: "2026-03-30T12:00:00.000Z",
  };
}

function buildPublishedWallet(): WalletRequest {
  const provisioning = buildProvisioningResponse();
  const webAuthnKey = createHeadlessWebAuthnKey();

  return {
    ...provisioning,
    status: "owner_bound",
    counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
    ownerPublicArtifacts: {
      credentialId: webAuthnKey.authenticatorId,
      publicKey: "0x1234",
    },
    regularValidatorInitArtifact: {
      validatorAddress: "0x3333333333333333333333333333333333333333",
      enableData: "0x1234",
      pluginEnableSignature: "0x5678",
    },
    createdAt: "2026-03-30T11:00:00.000Z",
    updatedAt: "2026-03-30T11:05:00.000Z",
  };
}

describe("headless provisioning helper", () => {
  it("loads the provisioning request, derives artifacts, and publishes them", async () => {
    const provisioningRequest = buildProvisioningResponse();
    const publishedWallet = buildPublishedWallet();
    const webAuthnKey = createHeadlessWebAuthnKey();
    const artifactBuilder = vi.fn().mockResolvedValue({
      owner: {
        credentialId: webAuthnKey.authenticatorId,
        publicKey: "0x1234",
      },
      counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
      regularValidatorInitArtifact: {
        validatorAddress: "0x3333333333333333333333333333333333333333",
        enableData: "0x1234",
        pluginEnableSignature: "0x5678",
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(provisioningRequest), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(publishedWallet), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    const result = await publishHeadlessOwnerArtifacts(
      {
        walletId: "wal_test",
        token: "token_test",
        backendUrl: "http://127.0.0.1:3000",
      },
      {
        fetchImpl,
        artifactBuilder,
        webAuthnKey,
      },
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3000/v1/provisioning/wal_test?t=token_test",
    );
    expect(artifactBuilder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        walletConfig: provisioningRequest.walletConfig,
        webAuthnKey: expect.objectContaining({
          authenticatorId: webAuthnKey.authenticatorId,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3000/v1/provisioning/wal_test/owner-artifacts?t=token_test",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result.provisioningRequest.walletId).toBe("wal_test");
    expect(result.publishedWallet.status).toBe("owner_bound");
    expect(result.publishedWallet.counterfactualWalletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });
});
