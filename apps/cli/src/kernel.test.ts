import { describe, expect, it, vi } from "vitest";
import type { LocalWalletRequest, WalletRequest } from "@agent-wallet/shared";
import {
  hydrateReadyWalletRequest,
  callReadyWalletTransaction,
} from "./kernel.js";

function buildLocalWalletRequest(
  overrides: Partial<LocalWalletRequest> = {},
): LocalWalletRequest {
  return {
    walletId: "wal_123",
    backendBaseUrl: "http://127.0.0.1:3000",
    provisioningUrl:
      "http://127.0.0.1:5173/?walletId=wal_123&token=token_123&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
    chainId: 84532,
    contractPermissions: [
      {
        targetContract: "0x1111111111111111111111111111111111111111",
        allowedMethods: ["0xa9059cbb"],
      },
    ],
    sessionPublicKey: "0x04bfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabf",
    sessionPrivateKey:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    createdAt: "2026-03-25T12:00:00.000Z",
    lastKnownStatus: "created",
    ...overrides,
  };
}

function buildReadyWalletRequest(
  overrides: Partial<WalletRequest> = {},
): WalletRequest {
  return {
    walletId: "wal_123",
    status: "ready",
    scope: {
      chainId: 84532,
      contractPermissions: [
        {
          targetContract: "0x1111111111111111111111111111111111111111",
          allowedMethods: ["0xa9059cbb"],
        },
      ],
    },
    sessionPublicKey:
      "0x04bfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabf",
    counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
    funding: {
      status: "verified",
      minimumRequiredWei: "500000000000000",
      balanceWei: "700000000000000",
      checkedAt: "2026-03-25T12:05:00.000Z",
    },
    walletContext: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      chainId: 84532,
      kernelVersion: "3.1",
      sessionPublicKey:
        "0x04bfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabf",
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
    createdAt: "2026-03-25T12:00:00.000Z",
    updatedAt: "2026-03-25T12:05:00.000Z",
    expiresAt: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("kernel hydration", () => {
  it("rebuilds a ready permission account from the serialized approval and session key", async () => {
    const createPublicClient = vi.fn(() => ({ transport: "public" }));
    const estimateFeesPerGas = vi.fn(async () => ({
      maxFeePerGas: 7n,
      maxPriorityFeePerGas: 3n,
    }));
    const http = vi.fn((url: string) => ({ url }));
    const privateKeyToAccount = vi.fn(() => ({ address: "0xsession" }));
    const toECDSASigner = vi.fn(async () => ({ signer: "ecdsa" }));
    const deserializePermissionAccount = vi.fn(async () => ({
      address: "0x2222222222222222222222222222222222222222",
    }));
    const createKernelAccountClient = vi.fn(() => ({
      sendTransaction: vi.fn(async () => "0xtransactionhash" as const),
    }));

    const result = await hydrateReadyWalletRequest(
      {
        walletRequest: buildReadyWalletRequest(),
        localRequest: buildLocalWalletRequest(),
      },
      {
        createPublicClient,
        estimateFeesPerGas,
        http,
        privateKeyToAccount,
        toECDSASigner,
        deserializePermissionAccount,
        createKernelAccountClient,
      },
    );

    expect(privateKeyToAccount).toHaveBeenCalledWith(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(toECDSASigner).toHaveBeenCalled();
    expect(deserializePermissionAccount).toHaveBeenCalledWith(
      { transport: "public" },
      expect.anything(),
      "0.3.1",
      "approval_123",
      { signer: "ecdsa" },
    );
    expect(createKernelAccountClient).toHaveBeenCalled();
    const kernelClientConfig = (
      createKernelAccountClient as unknown as {
        mock: {
          calls: Array<
            [
              {
                userOperation?: {
                  estimateFeesPerGas?: (parameters: unknown) => Promise<{
                    maxFeePerGas: bigint;
                    maxPriorityFeePerGas: bigint;
                  }>;
                };
              },
            ]
          >;
        };
      }
    ).mock.calls[0]?.[0];
    expect(kernelClientConfig?.userOperation?.estimateFeesPerGas).toBeTypeOf(
      "function",
    );
    const estimateFeesPerGasFn = kernelClientConfig?.userOperation?.estimateFeesPerGas;
    expect(estimateFeesPerGasFn).toBeTypeOf("function");
    if (!estimateFeesPerGasFn) {
      throw new Error("Expected createKernelAccountClient to receive estimateFeesPerGas.");
    }
    await expect(estimateFeesPerGasFn({})).resolves.toEqual({
      maxFeePerGas: 7n,
      maxPriorityFeePerGas: 3n,
    });
    expect(estimateFeesPerGas).toHaveBeenCalledWith({ transport: "public" });
    expect(http).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/chains/84532/rpc",
    );
    expect(http).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/chains/84532/bundler",
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
        }),
      }),
    ).rejects.toThrow(/backend url/i);
  });

  it("calls a contract from a locally hydrated ready wallet", async () => {
    const createPublicClient = vi.fn(() => ({ transport: "public" }));
    const http = vi.fn((url: string) => ({ url }));
    const privateKeyToAccount = vi.fn(() => ({ address: "0xsession" }));
    const toECDSASigner = vi.fn(async () => ({ signer: "ecdsa" }));
    const deserializePermissionAccount = vi.fn(async () => ({
      address: "0x2222222222222222222222222222222222222222",
    }));
    const sendTransaction = vi.fn(async () => "0xtransactionhash" as const);
    const createKernelAccountClient = vi.fn(() => ({
      sendTransaction,
    }));

    const result = await callReadyWalletTransaction(
      {
        localRequest: buildLocalWalletRequest({
          walletAddress: "0x2222222222222222222222222222222222222222",
          serializedPermissionAccount: "approval_123",
          lastKnownStatus: "ready",
        }),
        call: {
          to: "0x1111111111111111111111111111111111111111",
          data: "0xa9059cbb",
          valueWei: "0",
        },
      },
      {
        createPublicClient,
        http,
        privateKeyToAccount,
        toECDSASigner,
        deserializePermissionAccount,
        createKernelAccountClient,
      },
    );

    expect(sendTransaction).toHaveBeenCalledWith({
      to: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      value: 0n,
    });
    expect(result).toEqual({
      walletAddress: "0x2222222222222222222222222222222222222222",
      transactionHash: "0xtransactionhash",
    });
  });
});
