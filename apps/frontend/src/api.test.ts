import { describe, expect, it, vi } from "vitest";
import { browserApi } from "./api.js";

describe("frontend api", () => {
  it("refreshes funding without sending an empty json content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        walletId: "wal_test",
        status: "owner_bound",
        scope: {
          chainId: 84532,
          contractPermissions: [
            {
              targetContract: "0x1111111111111111111111111111111111111111",
              allowedMethods: ["0xa9059cbb"],
            },
          ],
        },
        sessionPublicKey: "0x1234",
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        funding: {
          status: "insufficient",
          minimumRequiredWei: "500000000000000",
          balanceWei: "0",
          checkedAt: "2026-03-26T10:00:00.000Z",
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
        createdAt: "2026-03-26T10:00:00.000Z",
        updatedAt: "2026-03-26T10:00:00.000Z",
        expiresAt: "2026-03-27T10:00:00.000Z",
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
